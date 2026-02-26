const mongoose = require('mongoose')
require('dotenv').config()

const Category = require('./models/Category')
const Brand = require('./models/Brand')
const Color = require('./models/Color')

async function seed() {
  try {
    if (process.env.NODE_ENV === 'production') {
      console.log('❌ Seeding blocked in production')
      return
    }

    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅ MongoDB connected')

    /* ================= CATEGORIES ================= */
    const categoryNames = ['Electronics', 'Clothing', 'Grocery']
    const categoriesMap = {}

    for (const name of categoryNames) {
      let category = await Category.findOne({ name })
      if (!category) {
        category = await Category.create({ name })
        console.log(`➕ Category created: ${name}`)
      }
      categoriesMap[name] = category._id
    }

    /* ================= BRANDS ================= */
    const brandsData = [
      // Electronics
      { name: 'Apple', category: categoriesMap.Electronics },
      { name: 'Samsung', category: categoriesMap.Electronics },
      { name: 'Sony', category: categoriesMap.Electronics },
      { name: 'LG', category: categoriesMap.Electronics },
      { name: 'Tecno', category: categoriesMap.Electronics },

      // Clothing
      { name: 'Gucci', category: categoriesMap.Clothing },
      { name: 'Dior', category: categoriesMap.Clothing },
      { name: 'Louis Vuitton', category: categoriesMap.Clothing },
      { name: 'Bottega Veneta', category: categoriesMap.Clothing },
      { name: 'Chanel', category: categoriesMap.Clothing },

      // Grocery
      { name: 'Golden Penny', category: categoriesMap.Grocery },
      { name: 'Coca-Cola', category: categoriesMap.Grocery },
      { name: 'Dangote', category: categoriesMap.Grocery },
      { name: 'Nestlé', category: categoriesMap.Grocery },
      { name: 'Unilever', category: categoriesMap.Grocery }
    ]

    for (const b of brandsData) {
      const exists = await Brand.findOne({ name: b.name, category: b.category })
      if (!exists) {
        await Brand.create({ ...b, isActive: true })
        console.log(`➕ Brand created: ${b.name}`)
      }
    }

    /* ================= COLORS (Clothing only) ================= */
    const colors = [
      { name: 'Red', hex: '#ff0000' },
      { name: 'Blue', hex: '#0000ff' },
      { name: 'Green', hex: '#00ff00' },
      { name: 'Black', hex: '#000000' },
      { name: 'White', hex: '#ffffff' }
    ]

    for (const c of colors) {
      const exists = await Color.findOne({ name: c.name, category: categoriesMap.Clothing })
      if (!exists) {
        await Color.create({ ...c, category: categoriesMap.Clothing })
        console.log(`➕ Color created: ${c.name}`)
      }
    }

    /* ================= SIZES & TYPES ================= */
    const clothingSizes = ['XS', 'S', 'M', 'L', 'XL']
    const clothingTypes = ['clothes', 'shoes', 'bag', 'eyeglass']
    console.log(`✅ Clothing sizes (informational only): [${clothingSizes.join(', ')}]`)
    console.log(`✅ Clothing types (informational only): [${clothingTypes.join(', ')}]`)

    console.log('🎉 SEEDING COMPLETED SUCCESSFULLY')
  } catch (err) {
    console.error('❌ Seeding error:', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
  }
}

seed()
