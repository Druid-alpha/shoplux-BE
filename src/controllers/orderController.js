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

      if (cartItem.variant && cartItem.variant._id) {
        const variantId = cartItem.variant._id.toString()

        const variant = product.variants.find(
          v => v._id.toString() === variantId
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

      /* SAVE PRODUCT */
      await product.save()
    }

    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      totalAmount: total,
      status: 'pending'
    })

    user.cart = []
    await user.save()

    // ---------------------------------------------------------
    // Generate PDF invoice → write to /tmp (writable on Vercel)
    // then upload to Cloudinary so the URL persists
    // ---------------------------------------------------------
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
        doc.text(`Total: ₦${total}`)
        doc.moveDown()
        orderItems.forEach((item, i) => {
          doc.text(`${i + 1}. ${item.product} × ${item.qty} - ₦${item.priceAtPurchase * item.qty}`)
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
      await order.save()

      // Clean up tmp file
      fs.unlink(tmpPath, () => { })
    } catch (pdfErr) {
      // Non-fatal – order is created, just log the PDF error
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
    const order = await Order.findById(req.params.id).populate('items.product')
    if (!order) return res.status(404).json({ message: 'Order not found' })

    const isOwner = order.user.toString() === req.user.id.toString()
    const isAdmin = req.user.role === 'admin'

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
    const { status } = req.body
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    order.status = status
    await order.save()
    res.json({ order })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
}
