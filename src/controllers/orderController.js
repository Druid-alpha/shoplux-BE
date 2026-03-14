const mongoose = require('mongoose')
const Order = require('../../models/order')
const User = require('../../models/user')
const Product = require('../../models/product')
const Color = require('../../models/Color')
const path = require('path')
const fs = require('fs')
const os = require('os')
const PDFDocument = require('pdfkit')
const cloudinary = require('../config/cloudinary')

function buildPublicInvoiceUrl(orderId, version) {
  return cloudinary.url(`invoices/invoice-${orderId}`, {
    resource_type: 'raw',
    type: 'upload',
    format: 'pdf',
    secure: true,
    ...(version ? { version } : {})
  })
}

function buildSignedInvoiceUrl(orderId, version) {
  return cloudinary.url(`invoices/invoice-${orderId}`, {
    resource_type: 'raw',
    type: 'upload',
    format: 'pdf',
    secure: true,
    sign_url: true,
    ...(version ? { version } : {})
  })
}

function getVersionFromUrl(url) {
  if (!url) return null
  const match = String(url).match(/\/v(\d+)\//)
  return match ? Number(match[1]) : null
}

const resolveColorLabel = (() => {
  const cache = new Map()
  return async (raw) => {
    if (!raw) return null
    if (typeof raw === 'object') {
      if (raw.name) return raw.name
      if (raw.hex) return raw.hex
      if (raw._id) raw = raw._id
      else return null
    }
    const key = String(raw)
    if (mongoose.Types.ObjectId.isValid(key)) {
      if (cache.has(key)) return cache.get(key)
      const c = await Color.findById(key).select('name hex').lean()
      const label = c?.name || c?.hex || key
      cache.set(key, label)
      return label
    }
    return key
  }
})()



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
      const baseDiscount = Number(product.discount || 0)
      if (baseDiscount > 0) {
        price = price * (1 - baseDiscount / 100)
      }

      let variantData = null
      const cartVariant = cartItem.variant || {}
      const cartVariantSku = cartVariant.sku || null
      const cartVariantSize = cartVariant.size || null
      const cartVariantColor = cartVariant.color || null
      let resolvedVariant = null
      if (cartVariant && (cartVariant._id || cartVariantSku)) {
        resolvedVariant = product.variants.find(
          v => (cartVariant._id && String(v._id) === String(cartVariant._id)) ||
            (cartVariantSku && v.sku === cartVariantSku)
        )
        if (!resolvedVariant) throw new Error('Variant not found')
      }

      if (resolvedVariant) {
        if (resolvedVariant.stock < cartItem.qty) {
          throw new Error('Insufficient variant stock')
        }

        const variantDiscount = Number(resolvedVariant.discount ?? product.discount ?? 0)
        price = variantDiscount > 0
          ? resolvedVariant.price * (1 - variantDiscount / 100)
          : resolvedVariant.price
        const colorLabel = await resolveColorLabel(resolvedVariant.options?.color || cartVariantColor)
        variantData = {
          _id: resolvedVariant._id,
          sku: resolvedVariant.sku,
          price: resolvedVariant.price,
          discount: variantDiscount,
          size: resolvedVariant.options?.size || cartVariantSize || null,
          color: colorLabel || null
        }
      } else {
        if (product.stock < cartItem.qty) {
          throw new Error('Insufficient product stock')
        }
        if (cartVariantSize || cartVariantColor) {
          const colorLabel = await resolveColorLabel(cartVariantColor)
          variantData = {
            size: cartVariantSize || null,
            color: colorLabel || null
          }
        }
      }

      total += price * cartItem.qty

      orderItems.push({
        product: product._id,
        title: product.title,
        qty: cartItem.qty,
        priceAtPurchase: price,
        clothingType: product.clothingType || null,
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

exports.generateOrderInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'email name')
    if (!order) return res.status(404).json({ message: 'Order not found' })

    const isAdmin = req.user.role === 'admin'
    const isOwner = String(order.user?._id || order.user) === String(req.user.id)
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Access denied' })
    }

    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ message: 'Invoice is available after successful payment' })
    }

    if (order.invoiceUrl) {
      // Normalize older attachment/signed delivery URLs to stable public raw URL.
      if (order.invoiceUrl.includes('/fl_attachment/') || order.invoiceUrl.includes('/s--')) {
        order.invoiceUrl = buildPublicInvoiceUrl(order._id)
        await order.save()
      }
      const version = getVersionFromUrl(order.invoiceUrl)
      const signedUrl = buildSignedInvoiceUrl(order._id, version)
      return res.json({ invoiceUrl: signedUrl, generated: false })
    }

    const invoiceUrl = await generateInvoiceForOrder(order)
    const version = getVersionFromUrl(invoiceUrl)
    const signedUrl = buildSignedInvoiceUrl(order._id, version)
    return res.json({ invoiceUrl: signedUrl, generated: true })
  } catch (error) {
    console.error('Generate invoice error:', error)
    res.status(500).json({ message: 'Failed to generate invoice' })
  }
}

async function generateInvoiceForOrder(order) {
  const invoiceName = `invoice-${order._id}.pdf`
  const tmpPath = path.join(os.tmpdir(), invoiceName)

  const doc = new PDFDocument({ margin: 50 })
  const stream = fs.createWriteStream(tmpPath)
  doc.pipe(stream)

  doc.fontSize(22).font('Helvetica-Bold').text('SHOPLUXE', { align: 'center' })
  doc.fontSize(10).font('Helvetica').text('Zone 7, Ota-Efun Osogbo, Osun, Nigeria', { align: 'center' })
  doc.text('support@shopluxe.com', { align: 'center' })
  doc.moveDown(1.5)
  doc.fontSize(18).font('Helvetica-Bold').text('OFFICIAL INVOICE', { align: 'center' })
  doc.moveDown()

  doc.fontSize(11).font('Helvetica')
  doc.text(`Invoice No: ${order._id}`)
  doc.text(`Date: ${new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { dateStyle: 'full' })}`)
  doc.text(`Payment Status: ${order.paymentStatus?.toUpperCase() || 'PAID'}`)
  doc.moveDown()

  const addr = order.shippingAddress
  if (addr?.fullName) {
    doc.font('Helvetica-Bold').text('Billed To:')
    doc.font('Helvetica')
    doc.text(addr.fullName)
    if (addr.phone) doc.text(`Phone: ${addr.phone}`)
    if (addr.address) doc.text(addr.address)
    if (addr.city || addr.state) doc.text(`${addr.city || ''}${addr.city && addr.state ? ', ' : ''}${addr.state || ''}`)
    doc.text('Nigeria')
    doc.moveDown()
  }

  doc.font('Helvetica-Bold')
  doc.text('ITEMS', { underline: true })
  doc.moveDown(0.5)
  doc.font('Helvetica')
  doc.text('------------------------------------------------------------------')

  const normalizeColorLabel = (raw) => {
    if (!raw) return ''
    if (typeof raw === 'object') {
      if (raw.name) return raw.name
      if (raw.hex) return raw.hex
    }
    return String(raw)
  }

  const sizeLabelForItem = (item) => {
    const type = String(item?.clothingType || '').toLowerCase()
    if (['clothes', 'shoes', 'bags', 'bag', 'eyeglass'].includes(type)) return 'Size'
    return 'Spec'
  }

  order.items.forEach((item, i) => {
    const variantParts = []
    if (item.variant?.sku) variantParts.push(`SKU ${item.variant.sku}`)
    const colorLabel = normalizeColorLabel(item.variant?.color)
    if (colorLabel) variantParts.push(`Color ${colorLabel}`)
    if (item.variant?.size) variantParts.push(`${sizeLabelForItem(item)} ${item.variant.size}`)
    const variantInfo = variantParts.length > 0 ? ` [${variantParts.join(' | ')}]` : ''
    const itemName = item.title || 'Product'
    const lineTotal = (item.priceAtPurchase || 0) * item.qty
    doc.font('Helvetica-Bold').text(`${i + 1}. ${itemName}${variantInfo}`)
    doc.font('Helvetica').text(
      `   Qty: ${item.qty}  x  N${(item.priceAtPurchase || 0).toLocaleString()}  =  N${lineTotal.toLocaleString()}`,
      { indent: 10 }
    )
    doc.moveDown(0.3)
  })

  doc.text('------------------------------------------------------------------')
  doc.moveDown()
  doc.fontSize(14).font('Helvetica-Bold').text(
    `TOTAL PAID: N${(order.totalAmount || 0).toLocaleString()}`,
    { align: 'right' }
  )
  doc.moveDown(2)
  doc.fontSize(9).font('Helvetica').text(
    'Thank you for shopping with ShopLuxe. We appreciate your business!',
    { align: 'center' }
  )

  doc.end()

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })

  const uploaded = await cloudinary.uploader.upload(tmpPath, {
    folder: 'invoices',
    resource_type: 'raw',
    public_id: `invoice-${order._id}`
  })

  // Keep original Cloudinary raw file URL to avoid transformation authorization issues.
  order.invoiceUrl = uploaded.secure_url
  await order.save()

  if (fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => { })

  return order.invoiceUrl
}
