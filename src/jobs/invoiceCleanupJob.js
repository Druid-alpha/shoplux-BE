const Order = require('../../models/order')
const cloudinary = require('../config/cloudinary')

const RECEIPT_RETENTION_DAYS = 3
const CLEANUP_INTERVAL_HOURS = 24

function getPublicIdFromInvoiceUrl(invoiceUrl) {
  if (!invoiceUrl) return null

  try {
    const withoutQuery = invoiceUrl.split('?')[0]
    const uploadMarker = '/upload/'
    const uploadIndex = withoutQuery.indexOf(uploadMarker)
    if (uploadIndex === -1) return null

    let assetPath = withoutQuery.slice(uploadIndex + uploadMarker.length)
    const pathParts = assetPath.split('/')

    // Remove optional version segment like v1736422310
    if (pathParts.length && /^v\d+$/.test(pathParts[0])) {
      pathParts.shift()
    }

    if (!pathParts.length) return null
    const joinedPath = pathParts.join('/')
    return joinedPath.replace(/\.[^/.]+$/, '')
  } catch (error) {
    return null
  }
}

async function runInvoiceCleanupOnce() {
  const cutoff = new Date(Date.now() - RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const staleOrders = await Order.find({
    paymentStatus: 'paid',
    invoiceUrl: { $exists: true, $ne: '' },
    createdAt: { $lt: cutoff }
  }).select('_id invoiceUrl')

  if (!staleOrders.length) {
    console.log('[INVOICE CLEANUP] No stale invoices found.')
    return
  }

  const orderIds = staleOrders.map((o) => String(o._id))
  const publicIds = staleOrders.map((order) => {
    return getPublicIdFromInvoiceUrl(order.invoiceUrl) || `invoices/invoice-${order._id}`
  })
  const chunkSize = 100

  for (let i = 0; i < publicIds.length; i += chunkSize) {
    const chunk = publicIds.slice(i, i + chunkSize)
    try {
      await cloudinary.api.delete_resources(chunk, {
        resource_type: 'raw',
        type: 'upload'
      })
    } catch (error) {
      console.error('[INVOICE CLEANUP] Cloudinary delete chunk failed:', error.message)
    }
  }

  await Order.updateMany(
    { _id: { $in: orderIds } },
    { $unset: { invoiceUrl: 1 } }
  )

  console.log(`[INVOICE CLEANUP] Cleared ${orderIds.length} stale invoice(s) older than ${RECEIPT_RETENTION_DAYS} day(s).`)
}

function startInvoiceCleanupJob() {
  const intervalMs = CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000

  // Run once shortly after startup, then on interval.
  setTimeout(() => {
    runInvoiceCleanupOnce().catch((error) => {
      console.error('[INVOICE CLEANUP] Initial run failed:', error.message)
    })
  }, 15 * 1000)

  setInterval(() => {
    runInvoiceCleanupOnce().catch((error) => {
      console.error('[INVOICE CLEANUP] Scheduled run failed:', error.message)
    })
  }, intervalMs)

  console.log(`[INVOICE CLEANUP] Enabled. Retention=${RECEIPT_RETENTION_DAYS} day(s), Interval=${CLEANUP_INTERVAL_HOURS} hour(s).`)
}

module.exports = {
  startInvoiceCleanupJob,
  runInvoiceCleanupOnce
}
