const Order = require('../models/order')
const User = require('../models/user')
const Product = require('../models/product')
const PDFDocument = require('pdfkit')
const fs = require('fs')
const path = require('path')



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

        if (!variant) {
          throw new Error('Variant not found')
        }

        if (variant.stock < cartItem.qty) {
          throw new Error('Insufficient variant stock')
        }

        price = variant.price
        variantData = {
          _id: variant._id,
          name: variant.name,
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
        qty: cartItem.qty,
        priceAtPurchase: price,
        variant: variantData || null
      })
    }

    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      totalAmount: total,
      status: 'pending'
    })

    user.cart = []
    await user.save()

    const invoiceName = `invoice-${order._id}.pdf`
    const invoicePath = path.join(__dirname, '..', 'invoices', invoiceName)
    const doc = new PDFDocument()
    doc.pipe(fs.createWriteStream(invoicePath))
    doc.fontSize(20).text('Invoice', { align: 'center' })
    doc.moveDown()
    doc.fontSize(16).text(`Order ID: ${order._id}`)
    doc.text(`Total: ₦${total}`)
    doc.moveDown()
    orderItems.forEach((item, i) => {
      doc.text(`${i + 1}. ${item.product} × ${item.qty} - ₦${item.priceAtPurchase * item.qty}`)
    })
    doc.end()
    order.invoiceUrl = `/invoices/${invoiceName}`

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
    if (order.user.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' })
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