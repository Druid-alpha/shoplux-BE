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
      if (!product) {
        console.warn(`[CREATE ORDER] Product ${cartItem.product} not found, skipping ghost item.`)
        continue
      }

      let price = product.price

      // ✅ Apply Discount logic
      if (product.discount > 0) {
        price = price * (1 - product.discount / 100)
      }

      let variantData = null

      if (cartItem.variant && (cartItem.variant._id || cartItem.variant.sku)) {
        const variant = product.variants.find(
          v => (cartItem.variant._id && String(v._id) === String(cartItem.variant._id)) ||
            (cartItem.variant.sku && v.sku === cartItem.variant.sku)
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
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: Admins only' })
    }

    const { status, paymentStatus } = req.body
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })

    // paymentStatus is controlled by Paystack verify/webhook flows only
    if (typeof paymentStatus !== 'undefined') {
      return res.status(400).json({
        message: 'paymentStatus is managed automatically after payment verification and cannot be changed manually'
      })
    }

    // Admin should only set operational fulfillment states.
    // Payment-related states are managed by payment flows.
    const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered']
    if (!status) {
      return res.status(400).json({ message: 'status is required' })
    }
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: 'Invalid order status value. Allowed: pending, processing, shipped, delivered'
      })
    }

    order.status = status
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
