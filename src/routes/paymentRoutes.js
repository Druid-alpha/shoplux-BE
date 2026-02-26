const express = require('express')
const router = express.Router()
const auth = require('../middleware/authCookie') // middleware to get req.userId from accessToken
const paymentCtrl = require('../controllers/paymentController')

// Initialize Paystack payment
router.post('/paystack/init', auth, paymentCtrl.initPaystackTransaction)

module.exports = router
