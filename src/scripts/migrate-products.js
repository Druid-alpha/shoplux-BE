require('dotenv').config()
const mongoose = require('mongoose')

const Product = require('../models/product')
const Brand = require('../models/Brand')
const Category = require('../models/Category')
const Color = require('../models/Color')

/* =====================================================
   HELPERS
===================================================== */

async function getOrCreate(model, name) {
  if (!name || typeof name !== 'string') return null

  const clean = name.trim()
  if (!clean) return null

  let doc = await model.findOne({ name: clean })
  if (!doc) {
    doc = await model.create({ name: clean })
    console.log(`🆕 Created ${model.modelName}: ${clean}`)
  }
  return doc._id
}

/* =====================================================
   MIGRATION
===================================================== */

async function migrateProducts() {
  const products = await Product.find({})

  console.log(`🔄 Migrating ${products.length} products...\n`)

  for (const product of products) {
    const update = {}

    // BRAND
    if (typeof product.brand === 'string') {
      const brandId = await getOrCreate(Brand, product.brand)
      if (brandId) update.brand = brandId
    }

    // CATEGORY
    if (typeof product.category === 'string') {
      const categoryId = await getOrCreate(Category, product.category)
      if (categoryId) update.category = categoryId
    }

    // VARIANT COLORS
    if (Array.isArray(product.variants)) {
      update.variants = product.variants.map(v => {
        let colorId = v.options?.color

        if (typeof v.options?.color === 'string') {
          colorId = null
        }

        return {
          ...v.toObject(),
          options: {
            ...v.options,
            color: typeof v.options?.color === 'string'
              ? undefined
              : v.options?.color
          }
        }
      })

      for (const v of update.variants) {
        if (typeof v.options?.color === 'string') {
          v.options.color = await getOrCreate(Color, v.options.color)
        }
      }
    }

    if (Object.keys(update).length) {
      await Product.updateOne({ _id: product._id }, { $set: update })
      console.log(`✅ Migrated: ${product.title}`)
    }
  }

  console.log('\n🎉 Migration completed')
}

/* =====================================================
   RUN
===================================================== */

;(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅ MongoDB connected (migration)')

    await migrateProducts()

    await mongoose.disconnect()
    process.exit(0)
  } catch (err) {
    console.error('❌ Migration failed:', err)
    process.exit(1)
  }
})()
