const router = require('express').Router()
const auth = require('../middleware/authCookie')
const c = require('../controllers/reviewController')

// CREATE
router.post('/:productId', auth, c.createReview)

// READ
router.get('/product/:productId', c.getReviewsForProduct)
router.get('/featured', c.getFeaturedReviews)

// ADMIN
const requireAdmin = require('../middleware/requireAdmin')
router.get('/admin/all', auth, requireAdmin, c.listAllReviews)
router.patch('/admin/:reviewId/feature', auth, requireAdmin, c.toggleFeaturedReview)

// HELPFUL
router.post('/:reviewId/helpful', auth, c.toggleHelpful)

// UPDATE
router.put('/:reviewId', auth, c.updateReview)

// DELETE
router.delete('/:reviewId', auth, c.deleteReview)

module.exports = router
