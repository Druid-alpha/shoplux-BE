const crypto = require('crypto')
const mongoose = require('mongoose')
const Order = require('../models/order')
const path = require('path')
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

    // 1️⃣ find order + validate ownership
    const order = await Order.findById(orderId).populate("user", "email")

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    if (order.user._id.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized order access" })
    }

    if (order.status !== "pending") {
      return res.status(400).json({ message: "Order already processed" })
    }

    if (!order.user?.email) {
      return res.status(400).json({ message: "User email missing" })
    }

    // 2️⃣ generate reference
    const reference = ` ORD_${order._id}_${Date.now()}`

    // 3️⃣ initialize paystack
    const response = await paystack.post("/transaction/initialize", {
      email: order.user.email,
      amount: Math.round(order.totalAmount * 100), // kobo
      reference,
      callback_url: `${process.env.CLIENT_URL}/payment/success`,
      metadata: {
        orderId: order._id.toString()
      }
    })

    // 4️⃣ persist payment reference
    order.paymentRef = reference
    await order.save()

    res.status(200).json({
      authorizationUrl: response.data.data.authorization_url,
      reference
    })

  } catch (error) {
    console.error(
      "Paystack init error:",
      error.response?.data || error.message
    )

    res.status(500).json({
      message: "Payment initialization failed",
      error: error.response?.data || error.message
    })
  }
}




exports.paystackWebHook = async (req, res) => {
  // ------------------ VERIFY SIGNATURE ------------------
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) {
    return res.sendStatus(401)
  }

  const event = JSON.parse(req.body.toString())
  if (event.event === 'charge.failed') {
    // Find the order by reference
    const order = await Order.findOne({ paymentRef: event.data.reference });
    if (order) {
      order.paymentStatus = 'failed'; // <-- mark failed
      order.status = 'failed';
      await order.save();

      // Optional: send email notification about failed payment
      // sendEmail(order.user.email, "Payment Failed", `Your payment for order ${order._id} failed. Please try again.`);
    }
    return res.sendStatus(200);
  }

  if (event.event !== 'charge.success') return res.sendStatus(200);

  const reference = event.data.reference
  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const order = await Order.findOne({ paymentRef: reference }).session(session)
    if (!order || order.status === 'paid') {
      await session.abortTransaction()
      return res.sendStatus(200)
    }

    // ------------------ CHECK STOCK ------------------
    for (const item of order.items) {
      const product = await Product.findById(item.product).session(session)
      if (!product) throw new Error('Product missing')

      if (item.variant && item.variant._id) {
        const variant = product.variants.find(v => v._id.toString() === item.variant._id.toString())
        if (!variant || variant.stock < item.qty) {
          throw new Error(`Variant stock insufficient for ${variant?.name || 'unknown'}`)
        }
      } else {
        if (product.stock < item.qty) throw new Error(`Stock insufficient for ${product.title}`)
      }
    }

    // ------------------ REDUCE STOCK ------------------
    for (const item of order.items) {
      const product = await Product.findById(item.product).session(session)
      if (item.variant && item.variant._id) {
        const idx = product.variants.findIndex(v => v._id.toString() === item.variant._id.toString())
        if (idx !== -1) product.variants[idx].stock -= item.qty
      } else {
        product.stock -= item.qty
      }
      await product.save({ session })
    }

    // ------------------ UPDATE ORDER ------------------
    order.status = 'paid'
    order.paymentStatus = 'paid'
    await order.save({ session })

    // ------------------ CLEAR USER CART ------------------
    await User.findByIdAndUpdate(order.user, { cart: [] }, { session })

    // ------------------ GENERATE PDF INVOICE ------------------
    try {
      const invoiceName = `invoice-${order._id}.pdf`
      const tmpPath = path.join('/tmp', invoiceName)

      await new Promise((resolve, reject) => {
        const doc = new PDFDocument()
        const stream = fs.createWriteStream(tmpPath)
        doc.pipe(stream)
        doc.fontSize(20).text('Invoice', { align: 'center' })
        doc.moveDown()
        doc.fontSize(16).text(`Order ID: ${order._id}`)
        doc.text(`Total: ₦${order.totalAmount}`)
        doc.moveDown()
        order.items.forEach((item, i) => {
          doc.text(`${i + 1}. ${item.title || item.product} × ${item.qty} - ₦${item.priceAtPurchase * item.qty}`)
        })
        doc.end()
        stream.on('finish', resolve)
        stream.on('error', reject)
      })

      const uploaded = await cloudinary.uploader.upload(tmpPath, {
        folder: 'invoices',
        resource_type: 'raw',
        public_id: `invoice-${order._id}`,
        format: 'pdf'
      })

      order.invoiceUrl = uploaded.secure_url
      await order.save({ session })

      fs.unlink(tmpPath, () => { })
    } catch (pdfErr) {
      console.error('Invoice generation failed:', pdfErr.message)
    }

    // ------------------ COMMIT ------------------
    await session.commitTransaction()
    session.endSession()
    res.sendStatus(200)

    // ------------------ OPTIONAL: SEND EMAIL NOTIFICATION ------------------
     sendEmail(order.user.email, "Payment Successful", `Your order ${order._id} has been paid successfully.`)
    await session.commitTransaction()
    session.endSession()

    // ------------------ OPTIONAL: SEND EMAIL NOTIFICATION ------------------
    await sendEmail(
      order.user.email,
      "Payment Successful",
      `Your payment for order ${order._id} has been successfully received. Thank you for shopping with us!`
    );

    res.sendStatus(200)
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    console.error('Webhook processing failed:', error.message)
    res.sendStatus(500)
  }
}
