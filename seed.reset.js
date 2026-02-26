/**
 * ⚠️ DANGEROUS RESET SCRIPT
 * Drops collections intentionally
 */

const mongoose = require('mongoose')
require('dotenv').config()

async function resetDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('⚠️ Connected to MongoDB')

    await mongoose.connection.db.dropCollection('categories')
    await mongoose.connection.db.dropCollection('brands')
    await mongoose.connection.db.dropCollection('colors')

    console.log('🔥 Database reset completed')
  } catch (err) {
    console.error('❌ Reset error:', err.message)
  } finally {
    await mongoose.disconnect()
  }
}

resetDatabase()
