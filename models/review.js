const mongoose = require('mongoose')

const reviewSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.ObjectId, ref: 'Product', required: true },
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String },
    body: { type: String },

},
    { timestamps: true }
)
module.exports=mongoose.model('Review',reviewSchema)