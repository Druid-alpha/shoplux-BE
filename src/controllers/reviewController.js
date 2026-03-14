const Review = require('../../models/review')
const Product = require('../../models/product')
const Order = require('../../models/order')
const User = require('../../models/user')
const mongoose = require('mongoose')
const { z } = require('zod')

const reviewSchema = z.object({
  rating: z.number().min(1).max(5),
  title: z.string().optional(),
  body: z.string().optional(),
})

const escapeRegex = (value) =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

    // ✅ Check if user purchased this product (Verified Purchase)
    const hasOrdered = await Order.findOne({
      user: req.user.id,
      'items.product': productId,
      paymentStatus: 'paid'
    })

    const review = await Review.create({
      product: productId,
      user: req.user.id,
      rating: data.rating,
      title: data.title,
      body: data.body,
      isVerified: !!hasOrdered
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
    const { productId, sort } = req.params

    let sortQuery = { createdAt: -1 } // newest
    if (sort === 'highest') sortQuery = { rating: -1 }
    if (sort === 'lowest') sortQuery = { rating: 1 }

    const reviews = await Review.find({ product: productId })
      .populate('user', 'name avatar')
      .sort(sortQuery)
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

    // Allow owner OR admin role from auth middleware
    if (!review.user.equals(req.user.id) && req.user?.role !== 'admin') {
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

    // Allow owner OR admin role from auth middleware
    if (!review.user.equals(req.user.id) && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' })
    }

    await review.deleteOne()
    await recalcProductRating(review.product)

    res.json({ message: 'Review deleted' })
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete review' })
  }
}

/* ================= HELP VOTE ================= */
exports.toggleHelpful = async (req, res) => {
  try {
    const { reviewId } = req.params
    const userId = req.user.id

    const review = await Review.findById(reviewId)
    if (!review) return res.status(404).json({ message: 'Review not found' })

    const index = review.helpfulUsers.indexOf(userId)
    if (index === -1) {
      review.helpfulUsers.push(userId)
      review.helpful += 1
    } else {
      review.helpfulUsers.splice(index, 1)
      review.helpful -= 1
    }

    await review.save()
    res.json({ helpful: review.helpful, isHelpful: index === -1 })
  } catch (err) {
    res.status(500).json({ message: 'Failed to update helpful vote' })
  }
}

exports.toggleFeaturedReview = async (req, res) => {
  try {
    const { reviewId } = req.params
    const review = await Review.findById(reviewId)
    if (!review) return res.status(404).json({ message: 'Review not found' })

    review.isFeatured = !review.isFeatured
    await review.save()
    res.json({ message: 'Review featured status updated', isFeatured: review.isFeatured })
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle featured status' })
  }
}

/* ================= ADMIN ================= */
exports.listAllReviews = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1))
    const limit = Math.min(100, Number(req.query.limit || 20))

    const query = {}
    const andConditions = []

    const rating = Number(req.query.rating)
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      andConditions.push({ rating })
    }

    const verified = String(req.query.verified || '').toLowerCase()
    if (verified === 'verified' || verified === 'true') {
      andConditions.push({ isVerified: true })
    } else if (verified === 'guest' || verified === 'false') {
      andConditions.push({ isVerified: { $ne: true } })
    }

    const featured = String(req.query.featured || '').toLowerCase()
    if (featured === 'featured' || featured === 'true') {
      andConditions.push({ isFeatured: true })
    } else if (featured === 'not_featured' || featured === 'false') {
      andConditions.push({ isFeatured: { $ne: true } })
    }

    const search = String(req.query.search || '').trim()
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i')
      const [userIds, productIds] = await Promise.all([
        User.find({ $or: [{ name: regex }, { email: regex }] }).select('_id').limit(50),
        Product.find({ title: regex }).select('_id').limit(50),
      ])

      andConditions.push({
        $or: [
          { title: regex },
          { body: regex },
          { user: { $in: userIds.map(u => u._id) } },
          { product: { $in: productIds.map(p => p._id) } },
        ]
      })
    }

    if (andConditions.length > 0) query.$and = andConditions

    const total = await Review.countDocuments(query)
    const reviews = await Review.find(query)
      .populate('user', 'name email avatar')
      .populate('product', 'title images')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)

    res.json({ reviews, total, pages: Math.ceil(total / limit), page })
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch reviews' })
  }
}

exports.getFeaturedReviews = async (req, res) => {
  try {
    // Home should only show admin-featured reviews.
    const reviews = await Review.find({ isFeatured: true })
      .populate('user', 'name avatar')
      .populate('product', 'title')
      .sort({ createdAt: -1 })

    res.json({ reviews })
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch featured reviews' })
  }
}
