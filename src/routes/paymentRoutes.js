const express = require('express')
const router = express.Router()
const auth = require('../middleware/authCookie')
const paymentCtrl = require('../controllers/paymentController')

// Initialize Paystack payment
router.post('/paystack/init', auth, paymentCtrl.initPaystackTransaction)

// Verify payment after Paystack redirect (called from frontend /payment/success page)
router.get('/verify/:reference', auth, paymentCtrl.verifyPaystackPayment)

// Admin refund endpoint
router.post('/paystack/refund', auth, paymentCtrl.refundPaystackPayment)

module.exports = router
