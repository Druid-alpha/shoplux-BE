const crypto = require('crypto')
const mongoose = require('mongoose')
const Order = require('../models/order')
const Product = require('../models/product')
const User = require('../models/user')
const paystack = require('../config/paystack')




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
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) {
    return res.sendStatus(401)
  }

  const event = JSON.parse(req.body.toString())

  if (event.event !== 'charge.success') {
    return res.sendStatus(200)
  }

  const ref = event.data.reference
  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const order = await Order.findOne({ paymentRef: ref }).session(session)
    if (!order || order.status === 'paid') {
      await session.abortTransaction()
      return res.sendStatus(200)
    }

    for (const item of order.items) {
      const product = await Product.findById(item.product).session(session)
      if (!product) throw new Error('Product missing')

      if (item.variant && typeof item.variant === 'object' && item.variant.sku) {
        const v = product.variants.find(val => val.sku === item.variant.sku)
        if (!v || v.stock < item.qty) {
          throw new Error('Variant stock insufficient')
        }
      } else if (item.variant && typeof item.variant === 'string') {
        const v = product.variants.find(val => val.sku === item.variant)
        if (!v || v.stock < item.qty) {
          throw new Error('Legacy variant stock insufficient')
        }
      } else if (product.stock < item.qty) {
        throw new Error('Stock insufficient')
      }
    }

    for (const item of order.items) {
      if (item.variant && typeof item.variant === 'object' && item.variant.sku) {
        await Product.updateOne(
          { _id: item.product, 'variants.sku': item.variant.sku },
          { $inc: { 'variants.$.stock': -item.qty } },
          { session }
        )
      } else if (item.variant && typeof item.variant === 'string') {
        await Product.updateOne(
          { _id: item.product, 'variants.sku': item.variant },
          { $inc: { 'variants.$.stock': -item.qty } },
          { session }
        )
      } else {
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: -item.qty } },
          { session }
        )
      }
    }

    order.status = 'paid'
    await order.save({ session })
    await User.findByIdAndUpdate(order.user, { cart: [] }, { session })

    await session.commitTransaction()
    session.endSession()
    res.sendStatus(200)
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    console.error('Webhook error:', error.message)
    res.sendStatus(500)
  }
}
