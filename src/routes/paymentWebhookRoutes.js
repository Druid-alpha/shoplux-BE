const express = require('express') // <- THIS WAS MISSING
const router = express.Router()
const paymentCtrl = require('../controllers/paymentController')

// Paystack webhook route
router.post(
  '/paystack/webhook',
  express.raw({ type: 'application/json' }), // raw body required by Paystack
  paymentCtrl.paystackWebHook
)

module.exports = router
