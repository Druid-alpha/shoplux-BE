const crypto = require('crypto')
const mongoose = require('mongoose')
const Order = require('../../models/order')
const path = require('path')
const fs = require('fs')
const os = require('os')
const Product = require('../../models/product')
const User = require('../../models/user')
const paystack = require('../config/paystack')
const PDFDocument = require('pdfkit')
const cloudinary = require('../config/cloudinary')
const sendEmail = require('../utils/sendEmail')
const { clampReservedToZero, releaseOrderReservations, resolveColorId } = require('../utils/reservation')

const PAYMENT_RESERVATION_EXTENSION_MS = 10 * 60 * 1000

const normalizeRefundAmount = (orderTotal, amount) => {
  if (!amount) return null
  const numeric = Number(amount)
  if (Number.isNaN(numeric) || numeric <= 0) return null
  return Math.min(numeric, Number(orderTotal || 0))
}

exports.refundPaystackPayment = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: Admins only' })
    }

    const { orderId, amount, reason } = req.body || {}
    if (!orderId) {
      return res.status(400).json({ message: 'orderId is required' })
    }

    const order = await Order.findById(orderId).populate('user', 'email name')
    if (!order) return res.status(404).json({ message: 'Order not found' })

    if (!order.paymentRef) {
      return res.status(400).json({ message: 'Order has no payment reference' })
    }

    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ message: 'Order is not paid' })
    }

    const refundAmount = normalizeRefundAmount(order.totalAmount, amount)
    const payload = {
      transaction: order.paymentRef,
      ...(refundAmount ? { amount: Math.round(refundAmount * 100) } : {}),
      ...(reason ? { reason: String(reason).slice(0, 200) } : {})
    }

    const response = await paystack.post('/refund', payload)
    const refundData = response?.data?.data

    order.paymentStatus = 'refunded'
    order.refundStatus = 'processed'
    order.refundAmount = refundAmount || order.totalAmount || 0
    order.refundProcessedAt = new Date()
    if (order.returnStatus && order.returnStatus !== 'none') {
      order.returnStatus = 'refunded'
    }
    if (reason) {
      order.returnNote = String(reason).slice(0, 500)
      order.returnMessages = [
        ...(order.returnMessages || []),
        { by: 'admin', message: order.returnNote, status: 'refunded' }
      ]
    }
    await order.save()

    try {
      if (order.user?.email) {
        await sendEmail({
          to: order.user.email,
          subject: 'Refund processed - ShopLuxe',
          title: 'Refund processed',
          text: `Your refund is complete. Order ID: ${order._id}. Amount: ₦${(order.refundAmount || 0).toLocaleString()}.${
            order.returnNote ? ` Note from support: ${order.returnNote}.` : ''
          }`,
          htmlContent: `
            <h1>Your refund is complete</h1>
            <p>Order ID: <strong>${order._id}</strong></p>
            <p>Amount: ₦${(order.refundAmount || 0).toLocaleString()}</p>
            <p>If you have any questions, reply to this email.</p>
          `,
          preheader: 'Your refund has been processed'
        })
      }
    } catch (emailErr) {
      console.error('[REFUND EMAIL] Failed:', emailErr.message)
    }

    res.json({ order, refund: refundData, message: 'Refund processed' })
  } catch (error) {
    console.error('[REFUND ERROR]', error.response?.data || error.message)
    res.status(500).json({ message: error.response?.data?.message || 'Refund failed' })
  }
}

const findVariantByOptions = async (product, size, color) => {
  if (!product?.variants?.length) return null
  const sizeKey = String(size || '').trim()
  const colorProvided = color !== null && color !== undefined && String(color).trim() !== ''
  const colorId = await resolveColorId(color)
  const hasColoredVariants = product.variants.some(v => v?.options?.color)

  if (!sizeKey && !colorId) return null
  if (colorProvided && !colorId && hasColoredVariants) return null

  return product.variants.find(v => {
    const vSize = String(v?.options?.size || '').trim()
    const vColor = String(v?.options?.color?._id || v?.options?.color || '')
    if (sizeKey && colorId) return vSize === sizeKey && vColor === colorId
    if (colorId) return vColor === colorId
    if (sizeKey && !colorProvided) return vSize === sizeKey
    if (sizeKey && !colorId && !hasColoredVariants) return vSize === sizeKey
    return false
  }) || null
}

/* ================================================================
   INIT — Create Paystack transaction for a pending order
================================================================ */
exports.initPaystackTransaction = async (req, res) => {
  try {
    const { orderId } = req.body
    const userId = req.user.id

    if (!orderId) {
      return res.status(400).json({ message: "Order ID is required" })
    }

    const order = await Order.findById(orderId).populate("user", "email name")

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

    // Release any other pending reservations for this user to avoid stacked holds.
    const otherPending = await Order.find({
      _id: { $ne: order._id },
      user: userId,
      status: 'pending',
      paymentStatus: 'pending'
    }).select('_id items')

    if (otherPending.length) {
      const cleanupSession = await mongoose.startSession()
      cleanupSession.startTransaction()
      try {
        for (const pending of otherPending) {
          await releaseOrderReservations(pending, cleanupSession)
          await Order.updateOne(
            { _id: pending._id },
            { $set: { status: 'cancelled', paymentStatus: 'failed' } },
            { session: cleanupSession }
          )
        }
        await cleanupSession.commitTransaction()
      } catch (cleanupErr) {
        await cleanupSession.abortTransaction()
        console.warn('[PAYSTACK INIT] Pending reservation cleanup failed:', cleanupErr.message)
      } finally {
        cleanupSession.endSession()
      }
    }

    // Reserve stock only when payment is initiated.
    const reserveSession = await mongoose.startSession()
    reserveSession.startTransaction()
    try {
      for (const item of order.items) {
        const product = await Product.findById(item.product).session(reserveSession)
        if (!product) continue

        let reserved = false
        const hasVariant = Array.isArray(product?.variants) && product.variants.length > 0
          && !!(item.variant?._id || item.variant?.sku || item.variant?.size || item.variant?.color)
        const hasExplicitVariant = !!(item.variant?._id || item.variant?.sku)
        const allowBaseFallback = !item.variant?._id && !item.variant?.sku && !item.variant?.size && !item.variant?.color

        if (item.variant?._id) {
          const result = await Product.updateOne(
            {
              _id: product._id,
              "variants._id": item.variant._id,
              "variants.stock": { $gte: item.qty },
              "variants.reserved": { $lte: (product.variants.id(item.variant._id)?.stock || 0) - item.qty }
            },
            { $inc: { "variants.$.reserved": item.qty } },
            { session: reserveSession }
          )
          if (result.modifiedCount > 0) reserved = true
        }

        if (!reserved && item.variant?.sku) {
          const variant = product.variants.find(v => v.sku === item.variant.sku)
          const result = await Product.updateOne(
            {
              _id: product._id,
              "variants.sku": item.variant.sku,
              "variants.stock": { $gte: item.qty },
              "variants.reserved": { $lte: (variant?.stock || 0) - item.qty }
            },
            { $inc: { "variants.$.reserved": item.qty } },
            { session: reserveSession }
          )
          if (result.modifiedCount > 0) reserved = true
        }

        if (!reserved && !hasExplicitVariant && (item.variant?.size || item.variant?.color)) {
          const resolved = await findVariantByOptions(product, item.variant.size, item.variant.color)
          if (resolved?._id) {
            const result = await Product.updateOne(
              {
                _id: product._id,
                "variants._id": resolved._id,
                "variants.stock": { $gte: item.qty },
                "variants.reserved": { $lte: (resolved?.stock || 0) - item.qty }
              },
              { $inc: { "variants.$.reserved": item.qty } },
              { session: reserveSession }
            )
            if (result.modifiedCount > 0) reserved = true
          }
        }

        if (!reserved && hasVariant) {
          if (!allowBaseFallback || Number(product.stock || 0) < item.qty) {
            throw new Error('Variant not found or insufficient stock')
          }
        }

        if (!reserved) {
          const result = await Product.updateOne(
            {
              _id: product._id,
              stock: { $gte: item.qty },
              reserved: { $lte: (product.stock - item.qty) }
            },
            { $inc: { reserved: item.qty } },
            { session: reserveSession }
          )
          if (result.modifiedCount === 0) {
            throw new Error('Insufficient product stock')
          }
        }

        await clampReservedToZero(product._id, reserveSession)
      }

      order.paymentRef = reference
      order.expiresAt = new Date(Date.now() + PAYMENT_RESERVATION_EXTENSION_MS)
      await order.save({ session: reserveSession })

      await reserveSession.commitTransaction()
    } catch (reserveErr) {
      await reserveSession.abortTransaction()
      reserveSession.endSession()
      if (String(reserveErr.message || '').toLowerCase().includes('insufficient')) {
        return res.status(409).json({ message: reserveErr.message })
      }
      return res.status(500).json({ message: reserveErr.message || 'Failed to reserve stock' })
    } finally {
      reserveSession.endSession()
    }

    const response = await paystack.post("/transaction/initialize", {
      email: order.user.email,
      amount: Math.round(order.totalAmount * 100),
      reference,
      callback_url: `${process.env.CLIENT_URL}/payment/success`,
      metadata: {
        orderId: order._id.toString(),
        customerName: order.shippingAddress?.fullName || order.user.name
      }
    })

    res.status(200).json({
      authorizationUrl: response.data.data.authorization_url,
      reference,
      expiresAt: order.expiresAt
    })

  } catch (error) {
    console.error("Paystack init error:", error.response?.data || error.message)
    // Release reservation if paystack init failed after we reserved.
    if (req.body?.orderId) {
      try {
        const order = await Order.findById(req.body.orderId).select('_id items')
        if (order) {
          const cleanupSession = await mongoose.startSession()
          cleanupSession.startTransaction()
          try {
            await releaseOrderReservations(order, cleanupSession)
            await Order.updateOne(
              { _id: order._id },
              { $set: { status: 'cancelled', paymentStatus: 'failed' } },
              { session: cleanupSession }
            )
            await cleanupSession.commitTransaction()
          } catch (releaseErr) {
            await cleanupSession.abortTransaction()
          } finally {
            cleanupSession.endSession()
          }
        }
      } catch {
        // ignore cleanup errors
      }
    }
    res.status(500).json({ message: "Payment initialization failed" })
  }
}


/* ================================================================
   VERIFY — Called after Paystack redirect to confirm payment
   Fallback to webhook if webhook was missed (e.g. dev environment)
================================================================ */
exports.verifyPaystackPayment = async (req, res) => {
  const { reference } = req.params
  const userId = req.user.id

  if (!reference) {
    return res.status(400).json({ message: 'Payment reference is required' })
  }

  try {
    // 1. Verify with Paystack API
    const response = await paystack.get(`/transaction/verify/${reference}`)
    const paystackData = response.data.data

    if (!paystackData || paystackData.status !== 'success') {
      return res.status(400).json({ message: 'Payment not successful on Paystack' })
    }

    // 2. Find the order by paymentRef
    const order = await Order.findOne({ paymentRef: reference }).populate('user', 'email name')

    if (!order) {
      return res.status(404).json({ message: 'Order not found for this payment reference' })
    }

    // Security: ensure the order belongs to this user
    if (String(order.user._id) !== String(userId)) {
      return res.status(403).json({ message: 'Unauthorized' })
    }

    // 3. If already paid (webhook already ran), just return the order
    if (order.paymentStatus === 'paid') {
      return res.status(200).json({ order, message: 'Payment already verified' })
    }

    // 4. Idempotent: reduce stock and mark as paid (fallback from webhook)
    const session = await mongoose.startSession()
    session.startTransaction()

    try {
      for (const item of order.items) {
        const product = await Product.findById(item.product).session(session)
        if (!product) continue

        let variantUpdated = false
        const hasVariant = Array.isArray(product?.variants) && product.variants.length > 0
          && !!(item.variant?._id || item.variant?.sku || item.variant?.size || item.variant?.color)
        const hasExplicitVariant = !!(item.variant?._id || item.variant?.sku)
        const allowBaseFallback = !item.variant?._id && !item.variant?.sku && !item.variant?.size && !item.variant?.color

        if (item.variant?._id) {
          const result = await Product.updateOne(
            {
              _id: product._id,
              "variants._id": item.variant._id,
              "variants.stock": { $gte: item.qty }
            },
            { $inc: { "variants.$.stock": -item.qty, "variants.$.reserved": -item.qty } },
            { session }
          )
          if (result.modifiedCount > 0) variantUpdated = true
        }

        if (!variantUpdated && item.variant?.sku) {
          const result = await Product.updateOne(
            {
              _id: product._id,
              "variants.sku": item.variant.sku,
              "variants.stock": { $gte: item.qty }
            },
            { $inc: { "variants.$.stock": -item.qty, "variants.$.reserved": -item.qty } },
            { session }
          )
          if (result.modifiedCount > 0) variantUpdated = true
        }

        if (!variantUpdated && !hasExplicitVariant && (item.variant?.size || item.variant?.color)) {
          const resolved = await findVariantByOptions(product, item.variant.size, item.variant.color)
          if (resolved?._id) {
            const result = await Product.updateOne(
              {
                _id: product._id,
                "variants._id": resolved._id,
                "variants.stock": { $gte: item.qty }
              },
              { $inc: { "variants.$.stock": -item.qty, "variants.$.reserved": -item.qty } },
              { session }
            )
            if (result.modifiedCount > 0) variantUpdated = true
          }
        }

        if (!variantUpdated && hasVariant) {
          if (!allowBaseFallback || Number(product.stock || 0) < item.qty) {
            throw new Error('Variant not found or insufficient stock')
          }
        }

        if (!variantUpdated) {
          await Product.updateOne(
            { _id: product._id, stock: { $gte: item.qty } },
            { $inc: { stock: -item.qty, reserved: -item.qty } },
            { session }
          )
        }

        await clampReservedToZero(product._id, session)
      }

      order.status = 'paid'
      order.paymentStatus = 'paid'
      await order.save({ session })

      await User.updateOne(
        { _id: order.user._id },
        { $set: { cart: [] } },
        { session }
      )

      await session.commitTransaction()
      session.endSession()

    } catch (stockErr) {
      await session.abortTransaction()
      session.endSession()
      console.error('[VERIFY] Stock reduction failed:', stockErr.message)
      // Still mark as paid even if stock update fails
      order.status = 'paid'
      order.paymentStatus = 'paid'
      await order.save()
    }

    // 5. Generate invoice PDF (best-effort, don't block response)
    generateInvoice(order).catch(err => console.error('[VERIFY PDF]', err.message))

    return res.status(200).json({ order, message: 'Payment verified successfully' })

  } catch (error) {
    console.error("Verify error:", error.response?.data || error.message)
    res.status(500).json({ message: 'Payment verification failed' })
  }
}


/* ================================================================
   WEBHOOK — Paystack event handler
================================================================ */
exports.paystackWebHook = async (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401)

  const event = JSON.parse(req.body.toString())

  if (event.event === 'charge.failed') {
    const order = await Order.findOne({ paymentRef: event.data.reference })
    if (order) {
      const failedSession = await mongoose.startSession()
      failedSession.startTransaction()
      try {
        await releaseOrderReservations(order, failedSession)
        order.paymentStatus = 'failed'
        order.status = 'failed'
        await order.save({ session: failedSession })
        await failedSession.commitTransaction()
      } catch (error) {
        await failedSession.abortTransaction()
        console.error('[WEBHOOK FAILED] Reservation release failed:', error.message)
      } finally {
        failedSession.endSession()
      }
    }
    return res.sendStatus(200)
  }

  if (event.event !== 'charge.success') return res.sendStatus(200)

  const reference = event.data.reference
  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const order = await Order.findOne({
      paymentRef: reference,
      paymentStatus: { $ne: 'paid' }
    }).populate('user').session(session)

    if (!order || order.paymentStatus === 'paid') {
      await session.abortTransaction()
      return res.sendStatus(200)
    }

    // REDUCE STOCK
    for (const item of order.items) {
      const product = await Product.findById(item.product).session(session)
      if (!product) continue

      let variantUpdated = false
      const hasVariant = Array.isArray(product?.variants) && product.variants.length > 0
        && !!(item.variant?._id || item.variant?.sku || item.variant?.size || item.variant?.color)
      const hasExplicitVariant = !!(item.variant?._id || item.variant?.sku)
      const allowBaseFallback = !item.variant?._id && !item.variant?.sku && !item.variant?.size && !item.variant?.color

        if (item.variant?._id) {
          const result = await Product.updateOne(
            {
              _id: product._id,
              "variants._id": item.variant._id,
              "variants.stock": { $gte: item.qty }
            },
            { $inc: { "variants.$.stock": -item.qty, "variants.$.reserved": -item.qty } },
            { session }
          )
          if (result.modifiedCount === 0) throw new Error("Stock conflict (variant sold out)")
          variantUpdated = true
        }

        if (!variantUpdated && item.variant?.sku) {
          const result = await Product.updateOne(
            {
              _id: product._id,
              "variants.sku": item.variant.sku,
              "variants.stock": { $gte: item.qty }
            },
            { $inc: { "variants.$.stock": -item.qty, "variants.$.reserved": -item.qty } },
            { session }
          )
          if (result.modifiedCount === 0) throw new Error("Stock conflict (variant sold out)")
          variantUpdated = true
        }

        if (!variantUpdated && !hasExplicitVariant && (item.variant?.size || item.variant?.color)) {
          const resolved = await findVariantByOptions(product, item.variant.size, item.variant.color)
          if (resolved?._id) {
            const result = await Product.updateOne(
              {
                _id: product._id,
                "variants._id": resolved._id,
                "variants.stock": { $gte: item.qty }
              },
              { $inc: { "variants.$.stock": -item.qty, "variants.$.reserved": -item.qty } },
              { session }
            )
            if (result.modifiedCount === 0) throw new Error("Stock conflict (variant sold out)")
            variantUpdated = true
          }
        }

        if (!variantUpdated && hasVariant) {
          if (!allowBaseFallback || Number(product.stock || 0) < item.qty) {
            throw new Error("Variant not found or insufficient stock")
          }
        }

        if (!variantUpdated) {
          const result = await Product.updateOne(
            { _id: product._id, stock: { $gte: item.qty } },
            { $inc: { stock: -item.qty, reserved: -item.qty } },
            { session }
          )
          if (result.modifiedCount === 0) throw new Error("Stock conflict (product sold out)")
        }

        await clampReservedToZero(product._id, session)
      }

    order.status = 'paid'
    order.paymentStatus = 'paid'
    await order.save({ session })

    await User.updateOne(
      { _id: order.user._id },
      { $set: { cart: [] } },
      { session }
    )

    await session.commitTransaction()
    session.endSession()

    // Generate invoice async after transaction
    generateInvoice(order).catch(err => console.error('Webhook PDF failed:', err.message))

    try {
      await sendEmail({
        to: order.user.email,
        subject: 'Payment Successful - ShopLuxe',
        text: `Your payment for order #${order._id} was successful. Thank you for shopping with ShopLuxe!\n\nShipping to: ${order.shippingAddress?.fullName || 'N/A'}, ${order.shippingAddress?.address || ''}, ${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''}.`
      })
    } catch (e) { console.error('Email failed:', e.message) }

    res.sendStatus(200)

  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    console.error('[WEBHOOK ERROR]', error.message)
    res.sendStatus(500)
  }
}


/* ================================================================
   HELPER — Generate & Upload PDF Invoice to Cloudinary
================================================================ */
async function generateInvoice(order) {
  const invoiceName = `invoice-${order._id}.pdf`
  const tmpPath = path.join(os.tmpdir(), invoiceName)

  const doc = new PDFDocument({ margin: 50 })
  const stream = fs.createWriteStream(tmpPath)
  doc.pipe(stream)

  // Header
  doc.fontSize(22).font('Helvetica-Bold').text('SHOPLUXE', { align: 'center' })
  doc.fontSize(10).font('Helvetica').text('Zone 7, Ota-Efun Osogbo, Osun, Nigeria', { align: 'center' })
  doc.text('support@shopluxe.com', { align: 'center' })
  doc.moveDown(1.5)

  doc.fontSize(18).font('Helvetica-Bold').text('OFFICIAL INVOICE', { align: 'center' })
  doc.moveDown()

  // Order meta
  doc.fontSize(11).font('Helvetica')
  doc.text(`Invoice No: ${order._id}`)
  doc.text(`Date: ${new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { dateStyle: 'full' })}`)
  doc.text(`Payment Status: ${order.paymentStatus?.toUpperCase() || 'PAID'}`)
  doc.moveDown()

  // Shipping address
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

  // Items table header
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
      `   Qty: ${item.qty}  x  ₦${(item.priceAtPurchase || 0).toLocaleString()}  =  ₦${lineTotal.toLocaleString()}`,
      { indent: 10 }
    )
    doc.moveDown(0.3)
  })

  doc.text('------------------------------------------------------------------')
  doc.moveDown()

  // Total
  doc.fontSize(14).font('Helvetica-Bold').text(
    `TOTAL PAID: ₦${(order.totalAmount || 0).toLocaleString()}`,
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

  console.log(`[INVOICE] Generated: ${order.invoiceUrl}`)
  return order.invoiceUrl
}
