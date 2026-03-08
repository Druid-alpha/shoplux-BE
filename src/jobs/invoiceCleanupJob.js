const Order = require('../../models/order')
const cloudinary = require('../config/cloudinary')

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_INTERVAL_HOURS = 24

function toPositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10)
  return Number.isFinite(num) && num > 0 ? num : fallback
}

function isCleanupEnabled() {
  const raw = String(process.env.INVOICE_CLEANUP_ENABLED || 'true').toLowerCase()
  return !['false', '0', 'off', 'no'].includes(raw)
}

async function runInvoiceCleanupOnce() {
  const retentionDays = toPositiveInt(process.env.INVOICE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS)
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  const staleOrders = await Order.find({
    paymentStatus: 'paid',
    invoiceUrl: { $exists: true, $ne: '' },
    createdAt: { $lt: cutoff }
  }).select('_id')

  if (!staleOrders.length) {
    console.log('[INVOICE CLEANUP] No stale invoices found.')
    return
  }

  const orderIds = staleOrders.map((o) => String(o._id))
  const publicIds = orderIds.map((id) => `invoices/invoice-${id}`)
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

  console.log(`[INVOICE CLEANUP] Cleared ${orderIds.length} stale invoice(s) older than ${retentionDays} day(s).`)
}

function startInvoiceCleanupJob() {
  if (!isCleanupEnabled()) {
    console.log('[INVOICE CLEANUP] Disabled by INVOICE_CLEANUP_ENABLED.')
    return
  }

  const intervalHours = toPositiveInt(process.env.INVOICE_CLEANUP_INTERVAL_HOURS, DEFAULT_INTERVAL_HOURS)
  const intervalMs = intervalHours * 60 * 60 * 1000

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

  console.log(`[INVOICE CLEANUP] Enabled. Retention=${toPositiveInt(process.env.INVOICE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS)} day(s), Interval=${intervalHours} hour(s).`)
}

module.exports = {
  startInvoiceCleanupJob,
  runInvoiceCleanupOnce
}
