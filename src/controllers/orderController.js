const Order = require('../models/order')
const User = require('../models/user')
const Product = require('../models/product')
const PDFDocument = require('pdfkit')
const fs = require('fs')
const path = require('path')
const cloudinary = require('../config/cloudinary')


exports.createOrder = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (!user || !user.cart.length) {
      return res.status(400).json({ message: 'Cart is empty' })
    }

    let total = 0
    const orderItems = []

    for (const cartItem of user.cart) {
      const product = await Product.findById(cartItem.product)
      if (!product) throw new Error('Product not found')

      let price = product.price
      let variantData = null

      if (cartItem.variant && cartItem.variant.sku) {
        const variant = product.variants.find(
          v => v.sku === cartItem.variant.sku
        )

        if (!variant) throw new Error('Variant not found')

        if (variant.stock < cartItem.qty) {
          throw new Error('Insufficient variant stock')
        }

        price = variant.price
        variantData = {
          _id: variant._id,
          sku: variant.sku,
          price: variant.price
        }

      } else {
        if (product.stock < cartItem.qty) {
          throw new Error('Insufficient product stock')
        }
      }

      total += price * cartItem.qty

      orderItems.push({
        product: product._id,
        title: product.title,
        qty: cartItem.qty,
        priceAtPurchase: price,
        variant: variantData || null
      })

      // We do NOT reduce stock here anymore. We reduce it in the webhook after payment.
    }

    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      totalAmount: total,
      status: 'pending'
    })

    user.cart = []
    await user.save()

    // ------------------ GENERATE PDF ------------------
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
      doc.text(`Customer: ${user.name} (${user.email})`)
      doc.moveDown()
      doc.text('-------------------------------------------------------------------------------')

      orderItems.forEach((item, i) => {
        const variantInfo = item.variant?.sku ? ` [${item.variant.sku}]` : ''
        doc.text(`${i + 1}. ${item.title}${variantInfo}`)
        doc.text(`   ${item.qty} x ₦${item.priceAtPurchase.toLocaleString()} = ₦${(item.priceAtPurchase * item.qty).toLocaleString()}`, { indent: 20 })
        doc.moveDown(0.5)
      })

      doc.text('-------------------------------------------------------------------------------')
      doc.moveDown()
      doc.fontSize(16).text(`TOTAL AMOUNT: ₦${total.toLocaleString()}`, { align: 'right' })
      doc.end()

      // CRITICAL: wait for stream close before upload
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve)
        stream.on('error', reject)
      })

      const uploaded = await cloudinary.uploader.upload(tmpPath, {
        folder: 'invoices',
        resource_type: 'auto', // Use auto for better PDF handling
        public_id: `invoice-${order._id}`,
        flags: 'attachment:false' // Ensure it previews in browser
      })

      order.invoiceUrl = uploaded.secure_url
      await order.save()

      fs.unlink(tmpPath, () => { })
    } catch (pdfErr) {
      console.error('Invoice generation failed:', pdfErr.message)
    }

    res.status(201).json({ order, invoiceUrl: order.invoiceUrl, userEmail: user.email })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: error.message })
  }
}

exports.getMyOrder = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 })
    res.json({ orders })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
}

exports.getOrderId = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product')
      .populate('user', 'email name')

    if (!order) return res.status(404).json({ message: 'Order not found' })

    const isAdmin = req.user.role === 'admin'
    const isOwner = String(order.user._id || order.user) === String(req.user.id)

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Access denied' })
    }

    res.json({ order })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
}

exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate('user', 'email name')
      .populate('items.product', 'title price')
      .sort({ createdAt: -1 })

    res.json({ orders })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
}

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, paymentStatus } = req.body
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })

    if (status) order.status = status
    if (paymentStatus) order.paymentStatus = paymentStatus

    await order.save()
    res.json({ order })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
}
