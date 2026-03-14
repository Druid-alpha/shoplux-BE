require('dotenv').config()
const mongoose = require('mongoose')
const Order = require('../models/order')
const cloudinary = require('../src/config/cloudinary')

const getVersionFromUrl = (url) => {
  if (!url) return null
  const match = String(url).match(/\/v(\d+)\//)
  return match ? Number(match[1]) : null
}

const buildPublicInvoiceUrl = (orderId, version) => {
  return cloudinary.url(`invoices/invoice-${orderId}`, {
    resource_type: 'raw',
    type: 'upload',
    format: 'pdf',
    secure: true,
    ...(version ? { version } : {})
  })
}

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('Missing MONGO_URI or MONGODB_URI in environment')
    process.exit(1)
  }

  await mongoose.connect(uri, { autoIndex: false })

  const orders = await Order.find({
    invoiceUrl: { $exists: true, $ne: null, $ne: '' }
  })

  let updated = 0

  for (const order of orders) {
    const url = String(order.invoiceUrl || '')
    if (!url) continue
    if (url.includes('/fl_attachment/') || url.includes('/s--')) {
      const version = getVersionFromUrl(url)
      order.invoiceUrl = buildPublicInvoiceUrl(order._id, version)
      await order.save()
      updated += 1
      console.log(`[UPDATED] ${order._id}`)
    }
  }

  console.log(`Done. Normalized ${updated} invoice URL(s).`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error('Normalize failed:', err)
  process.exit(1)
})
