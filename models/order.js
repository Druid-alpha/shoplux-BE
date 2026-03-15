const mongoose = require('mongoose')

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  title: String,
  qty: Number,
  priceAtPurchase: Number,
  clothingType: { type: String, default: null }, // 'clothes' | 'shoes' | 'bags' | 'eyeglass' | null
  variant: {
    _id: mongoose.Schema.Types.ObjectId,
    sku: String,
    price: Number,
    discount: Number,
    size: String,
    color: String
  }
})

const shippingAddressSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  address: String,
  city: String,
  state: String,
}, { _id: false })

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [orderItemSchema],
  totalAmount: Number,
  shippingAddress: shippingAddressSchema,
  status: { type: String, enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'failed', 'cancelled'], default: 'pending' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paymentRef: String,
  invoiceUrl: String,
  expiresAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  returnStatus: { type: String, enum: ['none', 'requested', 'approved', 'rejected', 'refunded'], default: 'none' },
  returnRequestedAt: { type: Date, default: null },
  returnReason: { type: String, default: '' },
  returnNote: { type: String, default: '' },
  refundStatus: { type: String, enum: ['none', 'pending', 'processed'], default: 'none' },
  refundAmount: { type: Number, default: 0 },
  refundProcessedAt: { type: Date, default: null }
}, { timestamps: true })

orderSchema.index({ user: 1, createdAt: -1 })
orderSchema.index({ expiresAt: 1 })
orderSchema.index({ returnStatus: 1 })

module.exports = mongoose.model('order', orderSchema)
