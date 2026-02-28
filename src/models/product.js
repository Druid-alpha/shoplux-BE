// models/Product.js
const mongoose = require('mongoose')

/* ================= IMAGE SCHEMA ================= */
const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    public_id: { type: String, required: true }
  },
  { _id: true }
)

/* ================= VARIANT SCHEMA ================= */
const variantSchema = new mongoose.Schema(
  {
    sku: { type: String },

    options: {
      color: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Color',
        required: true
      },
      size: { type: String, default: '' }
    },

    price: {
      type: Number,
      required: true,
      min: 0
    },

    stock: {
      type: Number,
      default: 0,
      min: 0
    },

    image: {
      type: imageSchema,
      default: null
    }
  },
  { _id: false }
)

/* ================= PRODUCT SCHEMA ================= */
const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },

    /**
     * 🔒 KEEP THIS
     * Used by:
     * - filters
     * - admin list
     * - old frontend code
     */
    price: {
      type: Number,
      required: true,
      min: 0
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true
    },

    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null
    },

    color: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Color',
      default: null
    },

    sku: { type: String },

    /**
     * 🔒 KEEP MAIN STOCK
     * auto-computed from variants
     */
    stock: {
      type: Number,
      default: 0,
      min: 0
    },

    discount: { type: Number, default: 0 },
    featured: { type: Boolean, default: false },

    images: { type: [imageSchema], default: [] },

    clothingType: {
      type: String,
      enum: ['clothes', 'shoes', 'bag', 'eyeglass'],
      default: null,
      index: true
    },

    /**
     * ✅ REAL PRICES LIVE HERE
     */
    variants: {
      type: [variantSchema],
      default: []
    },

    tags: { type: [String], default: [] },
    avgRating: { type: Number, default: 0 },
    reviewsCount: { type: Number, default: 0 },

    isDeleted: { type: Boolean, default: false },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
)

/* ================= AUTO SYNC (SAFE) ================= */
productSchema.pre('save', function (next) {
  if (Array.isArray(this.variants) && this.variants.length > 0) {
    const prices = this.variants.map(v => v.price).filter(Boolean)
    const stocks = this.variants.map(v => v.stock || 0)

    if (prices.length) {
      this.price = Math.min(...prices)
    }

    this.stock = stocks.reduce((a, b) => a + b, 0)
  }

  next()
})

module.exports = mongoose.model('Product', productSchema)
