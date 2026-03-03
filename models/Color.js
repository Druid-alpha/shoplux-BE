const mongoose = require('mongoose')
const { Schema } = mongoose

const colorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    hex: { type: String, required: true },

    // 👇 REQUIRED for Clothing-only colors
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true
    }
  },
  { timestamps: true }
)

// Prevent duplicate colors per category
colorSchema.index({ name: 1, category: 1 }, { unique: true })

module.exports = mongoose.model('Color', colorSchema)
