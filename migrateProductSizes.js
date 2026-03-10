const mongoose = require('mongoose')
require('dotenv').config()

const Product = require('./models/product')
const Category = require('./models/Category')

const BASE_SIZE_TAG_PREFIX = '__base_sizes:'
const ALLOWED_SIZES = {
  clothes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  bags: ['Small', 'Medium', 'Large'],
  eyeglass: ['One Size']
}

const canonicalType = (type) => {
  const v = String(type || '').toLowerCase()
  if (v === 'bag') return 'bags'
  return v
}

const parseBaseSizesFromTags = (tags = []) => {
  const marker = (tags || []).find(
    t => typeof t === 'string' && t.startsWith(BASE_SIZE_TAG_PREFIX)
  )
  if (!marker) return []
  return marker
    .slice(BASE_SIZE_TAG_PREFIX.length)
    .split('|')
    .map(s => String(s || '').trim())
    .filter(Boolean)
}

const uniq = (arr = []) => [...new Set(arr)]

const normalizeSizesForType = (clothingType, sizes = []) => {
  const type = canonicalType(clothingType)
  const allowed = ALLOWED_SIZES[type] || []
  if (!allowed.length) return []
  return uniq(
    sizes
      .map(s => String(s || '').trim())
      .filter(s => allowed.includes(s))
  )
}

async function migrateProductSizes() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is missing')
    }
    await mongoose.connect(process.env.MONGO_URI)
    console.log('Connected to MongoDB')

    const clothingCategory = await Category.findOne({ name: /clothing/i }).select('_id')
    if (!clothingCategory) {
      console.log('Clothing category not found, nothing to migrate')
      return
    }

    const products = await Product.find({
      category: clothingCategory._id,
      $or: [
        { sizes: { $exists: false } },
        { sizes: { $size: 0 } }
      ]
    }).select('_id title clothingType sizes tags variants')

    console.log(`Found ${products.length} clothing products with empty/missing sizes`)

    let updatedCount = 0
    for (const product of products) {
      const fromTags = parseBaseSizesFromTags(product.tags || [])
      const fromVariants = (product.variants || [])
        .map(v => v?.options?.size)
        .filter(Boolean)

      const merged = normalizeSizesForType(
        product.clothingType,
        fromTags.length ? fromTags : fromVariants
      )

      if (!merged.length) continue

      product.sizes = merged
      await product.save()
      updatedCount += 1
      console.log(`Updated ${product._id} (${product.title}) -> [${merged.join(', ')}]`)
    }

    console.log(`Done. Updated ${updatedCount} products.`)
  } catch (err) {
    console.error('Migration failed:', err.message)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect().catch(() => {})
    console.log('Disconnected from MongoDB')
  }
}

migrateProductSizes()
