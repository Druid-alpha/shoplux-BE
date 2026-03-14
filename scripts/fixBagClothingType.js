require('dotenv').config()
const mongoose = require('mongoose')
const Product = require('../models/product')

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('Missing MONGO_URI or MONGODB_URI in environment')
    process.exit(1)
  }

  await mongoose.connect(uri, { autoIndex: false })
  const result = await Product.updateMany(
    { clothingType: 'bag' },
    { $set: { clothingType: 'bags' } }
  )
  console.log(`Updated ${result.modifiedCount || 0} product(s) from bag -> bags.`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error('Fix failed:', err)
  process.exit(1)
})
