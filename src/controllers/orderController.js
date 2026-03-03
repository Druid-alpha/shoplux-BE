const Order = require('../../models/order')
const User = require('../../models/user')
const Product = require('../../models/product')


exports.createOrder = async (req, res) => {
  try {
    const { shippingAddress } = req.body

    if (!shippingAddress?.fullName || !shippingAddress?.address || !shippingAddress?.city || !shippingAddress?.state || !shippingAddress?.phone) {
      return res.status(400).json({ message: 'Shipping address is required (fullName, phone, address, city, state)' })
    }

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
          v => String(v._id) === String(cartItem.variant._id)
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

      // Stock is reduced after payment confirmation in webhook/verify
    }

    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      totalAmount: total,
      shippingAddress,
      status: 'pending'
    })

    res.status(201).json({
      order,
      message: "Order created. Proceed to payment."
    })

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
    /* ================= ADMIN MANUAL PAYMENT STOCK FIX ================= */
    if (paymentStatus === 'paid' && order.paymentStatus !== 'paid') {

      for (const item of order.items) {

        const product = await Product.findById(item.product)
        if (!product) continue

        if (item.variant?._id) {
          await Product.updateOne(
            { _id: product._id, "variants._id": item.variant._id },
            { $inc: { "variants.$.stock": -item.qty } }
          )
        } else {
          await Product.updateOne(
            {
              _id: product._id,
              stock: { $gte: item.qty }
            },
            {
              $inc: { stock: -item.qty }
            }
          )
        }
      }

      order.status = 'paid'
    }
    await order.save()
    res.json({ order })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
}

exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })

    const isAdmin = req.user.role === 'admin'

    // Only admins can delete orders to prevent accidental customer deletes
    if (!isAdmin) {
      return res.status(403).json({ message: 'Access denied: Admins only' })
    }

    await Order.findByIdAndDelete(req.params.id)
    res.json({ message: 'Order successfully deleted' })

  } catch (error) {
    console.error('Delete order error:', error)
    res.status(500).json({ message: 'Server error deleting order' })
  }
}
