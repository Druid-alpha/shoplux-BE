require('dotenv').config()
const mongoose = require('mongoose')
const Product = require('../models/product')

const normalize = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'SKU'

const generateSku = (product) => {
  const title = normalize(product?.title || 'PROD')
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase()
  return `${title}-${rand}`
}

const generateUniqueSku = (product, used) => {
  let sku = ''
  let tries = 0
  do {
    sku = generateSku(product)
    tries += 1
  } while (used.has(sku) && tries < 50)
  used.add(sku)
  return sku
}

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('Missing MONGO_URI or MONGODB_URI in environment')
    process.exit(1)
  }

  await mongoose.connect(uri, { autoIndex: false })

  const products = await Product.find({ 'variants.0': { $exists: true } })
  let updated = 0
  let duplicatesFound = 0

  for (const product of products) {
    const seen = new Set()
    let changed = false
    let hadDuplicate = false
    const nextVariants = product.variants.map(v => {
      const rawSku = String(v?.sku || '').trim()
      if (!rawSku || seen.has(rawSku)) {
        hadDuplicate = true
        const newSku = generateUniqueSku(product, seen)
        changed = true
        return { ...v.toObject(), sku: newSku }
      }
      seen.add(rawSku)
      return v
    })

    if (changed) {
      product.variants = nextVariants
      await product.save()
      updated += 1
      console.log(`[FIXED] ${product._id} - ${product.title}`)
    }
    if (hadDuplicate) duplicatesFound += 1
  }

  console.log(`Done. Updated ${updated} product(s).`)
  console.log(`Duplicate SKU products found: ${duplicatesFound}.`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error('Fix failed:', err)
  process.exit(1)
})
