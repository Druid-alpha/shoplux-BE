const mongoose = require('mongoose')

const reviewSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.ObjectId, ref: 'Product', required: true },
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String },
    body: { type: String },
    isVerified: { type: Boolean, default: false },
    helpful: { type: Number, default: 0 },
    helpfulUsers: [{ type: mongoose.Schema.ObjectId, ref: 'User' }]

},
    { timestamps: true }
)
module.exports = mongoose.model('Review', reviewSchema)