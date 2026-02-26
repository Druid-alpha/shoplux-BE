// updateClothingType.js
const mongoose = require('mongoose')
const Product = require('./models/Product')
const Category = require('./models/Category')
require('dotenv').config()

async function updateClothingTypes() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅ Connected to MongoDB')

    const clothingCategory = await Category.findOne({ name: /clothing/i })
    if (!clothingCategory) {
      console.log('❌ Clothing category not found')
      return
    }

    // Find products in clothing category
    const products = await Product.find({ category: clothingCategory._id })

    console.log(`Found ${products.length} products in clothing category`)

    const bagKeywords = ['bag', 'backpack', 'marquee']
    const shoesKeywords = ['flip flop', 'shoes', 'slippers', 'kick', 'snickers', 'snicker']
    const eyeglassKeywords = ['eyeglass']

    let updatedCount = 0

    for (const product of products) {
      const title = product.title.toLowerCase()
      let type = 'clothes' // default

      if (bagKeywords.some(k => title.includes(k))) type = 'bag'
      else if (shoesKeywords.some(k => title.includes(k))) type = 'shoes'
      else if (eyeglassKeywords.some(k => title.includes(k))) type = 'eyeglass'

      if (product.clothingType !== type) {
        product.clothingType = type
        await product.save()
        updatedCount++
        console.log(`✅ Updated ${product.title} -> ${type}`)
      }
    }

    console.log(`🎉 Finished. Updated ${updatedCount} products.`)
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
  } catch (err) {
    console.error('❌ Error updating clothing types:', err)
  }
}

updateClothingTypes()
