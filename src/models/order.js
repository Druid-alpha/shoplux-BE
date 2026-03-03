const mongoose = require('mongoose')

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  title: String,
  qty: Number,
  priceAtPurchase: Number,
  variant: {
    _id: mongoose.Schema.Types.ObjectId,
    sku: String,
    price: Number
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
  invoiceUrl: String
}, { timestamps: true })

orderSchema.index({ user: 1, createdAt: -1 })

module.exports = mongoose.model('order', orderSchema)
