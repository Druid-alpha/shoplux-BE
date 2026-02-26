require('dotenv').config()
const mongoose = require('mongoose')

const Brand = require('./models/Brand')
const Category = require('./models/Category')

async function fixBrands() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })

    console.log('Connected to MongoDB')

    // 1️⃣ Fetch categories
    const categories = await Category.find()
    const categoryMap = {}
    categories.forEach(cat => {
      categoryMap[cat.name.toLowerCase()] = cat._id
    })

    // 2️⃣ Fetch all brands
    const brands = await Brand.find()
    let fixedCount = 0

    for (const brand of brands) {
      if (!brand.category) {
        // Try to infer category from brand name (optional, else assign default)
        let assignedCategory = null

        const name = brand.name.toLowerCase()
        if (name.includes('grocery')) assignedCategory = categoryMap['grocery']
        else if (name.includes('electro') || name.includes('electronics')) assignedCategory = categoryMap['electronics']
        else if (name.includes('clothing') || name.includes('fashion')) assignedCategory = categoryMap['clothing']

        // fallback: assign first category if nothing matches
        if (!assignedCategory) assignedCategory = categories[0]._id

        brand.category = assignedCategory
        await brand.save()
        fixedCount++
        console.log(`Fixed brand "${brand.name}"`)
      }
    }

    console.log(`✅ Done! Fixed ${fixedCount} brands`)
    process.exit(0)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

fixBrands()
