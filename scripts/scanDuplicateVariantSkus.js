require('dotenv').config()
const mongoose = require('mongoose')
const Product = require('../models/product')

const findDuplicateSkus = (variants = []) => {
  const counts = new Map()
  variants.forEach(v => {
    const sku = String(v?.sku || '').trim()
    if (!sku) return
    counts.set(sku, (counts.get(sku) || 0) + 1)
  })
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([sku]) => sku)
}

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('Missing MONGO_URI or MONGODB_URI in environment')
    process.exit(1)
  }

  await mongoose.connect(uri, { autoIndex: false })
  const products = await Product.find({ 'variants.0': { $exists: true } })
  const offenders = []

  for (const product of products) {
    const dups = findDuplicateSkus(product.variants || [])
    if (dups.length > 0) {
      offenders.push({
        id: product._id,
        title: product.title,
        skus: dups
      })
    }
  }

  if (offenders.length === 0) {
    console.log('No duplicate variant SKUs found.')
  } else {
    console.log(`Duplicate SKU products found: ${offenders.length}`)
    offenders.forEach(o => {
      console.log(`[DUPLICATE] ${o.id} - ${o.title} => ${o.skus.join(', ')}`)
    })
  }

  await mongoose.disconnect()
}

run().catch(err => {
  console.error('Scan failed:', err)
  process.exit(1)
})
