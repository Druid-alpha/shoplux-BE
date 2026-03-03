const crypto = require('crypto')
const mongoose = require('mongoose')
const Order = require('../models/order')
const path = require('path')
const fs = require('fs')
const Product = require('../models/product')
const User = require('../models/user')
const paystack = require('../config/paystack')
const PDFDocument = require('pdfkit')
const cloudinary = require('../config/cloudinary')
const sendEmail = require('../utils/sendEmail')


exports.initPaystackTransaction = async (req, res) => {
  try {
    const { orderId } = req.body
    const userId = req.user.id

    if (!orderId) {
      return res.status(400).json({ message: "Order ID is required" })
    }

    const order = await Order.findById(orderId).populate("user", "email")

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    if (String(order.user._id) !== String(userId)) {
      return res.status(403).json({ message: "Unauthorized order access" })
    }

    if (order.status !== "pending") {
      return res.status(400).json({ message: "Order already processed" })
    }

    const reference = `ORD_${order._id}_${Date.now()}`

    const response = await paystack.post("/transaction/initialize", {
      email: order.user.email,
      amount: Math.round(order.totalAmount * 100),
      reference,
      callback_url: `${process.env.CLIENT_URL}/payment/success`,
      metadata: { orderId: order._id.toString() }
    })

    order.paymentRef = reference
    await order.save()

    res.status(200).json({
      authorizationUrl: response.data.data.authorization_url,
      reference
    })

  } catch (error) {
    console.error("Paystack init error:", error.response?.data || error.message)
    res.status(500).json({ message: "Payment initialization failed" })
  }
}

exports.paystackWebHook = async (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401)

  const event = JSON.parse(req.body.toString())

  if (event.event === 'charge.failed') {
    const order = await Order.findOne({ paymentRef: event.data.reference });
    if (order) {
      order.paymentStatus = 'failed';
      order.status = 'failed';
      await order.save();
    }
    return res.sendStatus(200);
  }

  if (event.event !== 'charge.success') return res.sendStatus(200);

  const reference = event.data.reference
  const session = await mongoose.startSession()
  session.startTransaction()

  try {
   const order = await Order.findOne({
  paymentRef: reference,
  paymentStatus: { $ne: 'paid' } // prevent double processing
}).populate('user').session(session)
   if (!order || order.paymentStatus === 'paid') {
      await session.abortTransaction()
      return res.sendStatus(200)
    }

    // REDUCE STOCK
    /* ================= SAFE STOCK REDUCTION ================= */
console.log(`[STOCK] Starting reduction for Order ${order._id}`)

for (const item of order.items) {

  const product = await Product.findById(item.product).session(session)
  if (!product) continue

  let variantUpdated = false

  /* VARIANT ATOMIC REDUCTION */
  if (item.variant?._id) {

    const result = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": item.variant._id,
        "variants.stock": { $gte: item.qty }
      },
      {
        $inc: { "variants.$.stock": -item.qty }
      },
      { session }
    )

    if (result.modifiedCount === 0) {
      throw new Error("Stock conflict (variant sold out)")
    }

    variantUpdated = true
  }

  /* MAIN STOCK REDUCTION */
  if (!variantUpdated) {

    const result = await Product.updateOne(
      {
        _id: product._id,
        stock: { $gte: item.qty }
      },
      {
        $inc: { stock: -item.qty }
      },
      { session }
    )

    if (result.modifiedCount === 0) {
      throw new Error("Stock conflict (product sold out)")
    }
  }

  /* ================= FIX: RESYNC TOTAL STOCK ================= */
  const updatedProduct = await Product.findById(product._id).session(session)

  if (updatedProduct?.variants?.length) {
    updatedProduct.stock = updatedProduct.variants.reduce(
      (sum, v) => sum + (v.stock || 0),
      0
    )
    await updatedProduct.save({ session })
  }
}
    order.status = 'paid'
    order.paymentStatus = 'paid'
    await order.save({ session })

  await User.updateOne(
  { _id: order.user._id },
  { $set: { cart: [] } },
  { session }
)
    // GENERATE PDF
    try {
      const invoiceName = `invoice-${order._id}.pdf`
      const tmpPath = path.join('/tmp', invoiceName)

      const doc = new PDFDocument({ margin: 50 })
      const stream = fs.createWriteStream(tmpPath)
      doc.pipe(stream)

      doc.fontSize(25).text('OFFICIAL INVOICE', { align: 'center' })
      doc.moveDown()
      doc.fontSize(12).text(`Order ID: ${order._id}`)
      doc.text(`Date: ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}`)
      doc.text(`Customer: ${order.user.name || 'Valued Customer'}`)
      doc.moveDown()
      doc.text('-------------------------------------------------------------------------------')

      order.items.forEach((item, i) => {
        const variantInfo = item.variant?.sku ? ` [${item.variant.sku}]` : ''
       doc.text(`${i + 1}. ${item.title || 'Product'}${variantInfo}`)
        doc.text(`   ${item.qty} x ₦${item.priceAtPurchase.toLocaleString()} = ₦${(item.priceAtPurchase * item.qty).toLocaleString()}`, { indent: 20 })
        doc.moveDown(0.5)
      })

      doc.text('-------------------------------------------------------------------------------')
      doc.moveDown()
      doc.fontSize(16).text(`TOTAL PAID: ₦${order.totalAmount.toLocaleString()}`, { align: 'right' })
      doc.end()

      await new Promise((resolve, reject) => {
        stream.on('finish', resolve)
        stream.on('error', reject)
      })

      console.log(`[INVOICE] Uploading to Cloudinary for Order ${order._id}`)
          const uploaded = await cloudinary.uploader.upload(tmpPath, {
  folder: 'invoices',
  resource_type: 'raw',
  public_id: `invoice-${order._id}`
})

order.invoiceUrl = uploaded.secure_url + '?fl_attachment=true'
      console.log(`[INVOICE] Success: ${order.invoiceUrl}`)
      await order.save({ session })
      if (fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => { })
    } catch (pdfErr) {
      console.error('Webhook PDF failed:', pdfErr.message)
    }

    await session.commitTransaction()
    session.endSession()

    try {
      await sendEmail(
        order.user.email,
        "Payment Successful - ShopLuxe",
        `Your payment for order ${order._id} was successful. Thank you for shopping with ShopLuxe!`
      );
    } catch (e) { console.error('Email failed:', e.message) }

    res.sendStatus(200)
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    res.sendStatus(500)
  }
}
