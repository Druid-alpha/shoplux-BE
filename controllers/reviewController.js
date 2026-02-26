const Review = require('../models/review')
const Product = require('../models/product')
const mongoose = require('mongoose')
const { z } = require('zod')

const reviewSchema = z.object({
  rating: z.number().min(1).max(5),
  title: z.string().optional(),
  body: z.string().optional(),
})

// Recalculate product average rating
const recalcProductRating = async (productId) => {
  const stats = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: '$product',
        avgRating: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ])

  const product = await Product.findById(productId)
  if (!product) return

  if (stats.length) {
    product.avgRating = Number(stats[0].avgRating.toFixed(1))
    product.reviewsCount = stats[0].count
  } else {
    product.avgRating = 0
    product.reviewsCount = 0
  }

  await product.save()
}

/* ================= CREATE ================= */
exports.createReview = async (req, res) => {
  try {
    const { productId } = req.params
    const data = reviewSchema.parse(req.body)

    const product = await Product.findById(productId)
    if (!product) return res.status(404).json({ message: 'Product not found' })

    const existing = await Review.findOne({ product: productId, user: req.user.id })
    if (existing) return res.status(400).json({ message: 'You already reviewed this product' })

    const review = await Review.create({
      product: productId,
      user: req.user.id,
      rating: data.rating,
      title: data.title,
      body: data.body,
    })

    await recalcProductRating(productId)

    res.status(201).json({ review })
  } catch (err) {
    console.error(err)
    res.status(400).json({ message: err.message })
  }
}

/* ================= READ ================= */
exports.getReviewsForProduct = async (req, res) => {
  try {
    const { productId } = req.params
    const reviews = await Review.find({ product: productId })
      .populate('user', 'name avatar')
      .sort({ createdAt: -1 })
    res.json({ reviews })
  } catch (err) {
    res.status(500).json({ message: 'Failed to load reviews' })
  }
}

/* ================= UPDATE ================= */
exports.updateReview = async (req, res) => {
  try {
    const { reviewId } = req.params
    const data = reviewSchema.parse(req.body)

    const review = await Review.findById(reviewId)
    if (!review) return res.status(404).json({ message: 'Review not found' })

    // ✅ Allow owner OR admin
    if (!review.user.equals(req.user.id) && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' })
    }

    review.rating = data.rating
    review.title = data.title
    review.body = data.body

    await review.save()
    await recalcProductRating(review.product)

    res.json({ review })
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
}

/* ================= DELETE ================= */
exports.deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params
    const review = await Review.findById(reviewId)
    if (!review) return res.status(404).json({ message: 'Review not found' })

    // ✅ Allow owner OR admin
    if (!review.user.equals(req.user.id) && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' })
    }

    await review.deleteOne()
    await recalcProductRating(review.product)

    res.json({ message: 'Review deleted' })
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete review' })
  }
}
