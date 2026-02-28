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
    const order = await Order.findOne({ paymentRef: reference }).populate('user').session(session)
    if (!order || order.status === 'paid') {
      await session.abortTransaction()
      return res.sendStatus(200)
    }

    // REDUCE STOCK
    for (const item of order.items) {
      const product = await Product.findById(item.product).session(session)
      if (item.variant && item.variant.sku) {
        const idx = product.variants.findIndex(v => v.sku === item.variant.sku)
        if (idx !== -1) product.variants[idx].stock -= item.qty
      } else {
        product.stock -= item.qty
      }
      await product.save({ session })
    }

    order.status = 'paid'
    order.paymentStatus = 'paid'
    await order.save({ session })

    await User.findByIdAndUpdate(order.user, { cart: [] }, { session })

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

      const uploaded = await cloudinary.uploader.upload(tmpPath, {
        folder: 'invoices',
        resource_type: 'auto',
        public_id: `invoice-${order._id}`,
        flags: 'attachment:false'
      })

      order.invoiceUrl = uploaded.secure_url
      await order.save({ session })
      fs.unlink(tmpPath, () => { })
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
