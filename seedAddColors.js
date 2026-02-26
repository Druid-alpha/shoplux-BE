/**
 * SAFE COLOR ADD SCRIPT
 * - Adds new colors without dropping collections
 * - Prevents duplicates
 */

const mongoose = require('mongoose')
require('dotenv').config()

const Category = require('./models/Category')
const Color = require('./models/Color')

async function addColors() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅ MongoDB connected')

    // Find Clothing category
    const clothingCategory = await Category.findOne({ name: 'Clothing' })

    if (!clothingCategory) {
      console.log('❌ Clothing category not found')
      return
    }

    const newColors = [
      { name: 'Yellow', hex: '#ffff00', category: clothingCategory._id },
      { name: 'Brown', hex: '#8b4513', category: clothingCategory._id },
       { name: 'Pink', hex: '#ffc0cb', category: clothingCategory._id },
       { name: 'Orange', hex: '#ffa500', category: clothingCategory._id }

    ]

    for (const color of newColors) {
      const exists = await Color.findOne({
        name: color.name,
        category: color.category
      })

      if (!exists) {
        await Color.create(color)
        console.log(`✅ Added color: ${color.name}`)
      } else {
        console.log(`⚠️ Color already exists: ${color.name}`)
      }
    }

    console.log('🎉 Color update completed')
  } catch (err) {
    console.error('❌ Error adding colors:', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
  }
}

addColors()
