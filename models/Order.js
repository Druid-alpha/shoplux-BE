const mongoose = require('mongoose')

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  qty: Number,
  priceAtPurchase: Number,
  variant: { type: Object, default: null } // ✅ store variant as object
})

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [orderItemSchema],
  totalAmount: Number,
  status: { type: String, enum: ['pending','paid','processing','shipped','delivered','failed'], default:'pending' },
  paymentRef: String,
  invoiceUrl: String
}, { timestamps: true })

orderSchema.index({ user: 1, createdAt: -1 })

module.exports = mongoose.model('Order', orderSchema)
