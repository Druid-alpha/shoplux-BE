const mongoose = require('mongoose')

const refreshTokenSchema = new mongoose.Schema({
  token: String,
  createdAt: { type: Date, default: Date.now },
  revoked: { type: Boolean, default: false }
})

// Fix: variant is now an Object to store selectedVariant properly
const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  qty: { type: Number, default: 1 },
  variant: { type: Object, default: {} }
})
cartItemSchema.index({ product: 1, 'variant.color': 1, 'variant.size': 1 })

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, minlength: 2 },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  emailVerified: { type: Boolean, default: false },
  otp: String,
  otpAttempts: { type: Number, default: 0 },
  otpBlockedUntil: Date,
  lastOtpSentAt: Date,
  otpExpires: Date,
  resetToken: String,
  resetTokenExpires: Date,
  avatar: { type: String, default: '' },
  refreshTokens: [refreshTokenSchema],
  cart: [cartItemSchema],
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true })

module.exports = mongoose.model('User', userSchema)


