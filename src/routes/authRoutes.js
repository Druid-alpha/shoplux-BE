const express = require('express')
const router = express.Router()
const authCtrl = require('../controllers/authController')
const { upload } = require('../middleware/uploadMiddleware')
const rateLimit = require('express-rate-limit')

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many attempts. Please try again later.' }
})

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: { message: 'Too many OTP attempts. Please wait and try again.' }
})

const otpResendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { message: 'Too many OTP resend requests. Please wait and try again.' }
})

const otpResetLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { message: 'Too many reset requests. Please wait and try again.' }
})

router.post(
  '/register',
  authLimiter,
  upload.single('avatar'),
  authCtrl.register
)
router.post('/login', authLimiter, authCtrl.login)
router.post('/refresh', authCtrl.refresh)
router.post('/logout', authCtrl.logOut)
router.get('/me', authCtrl.me)
router.post('/verify-otp', otpVerifyLimiter, authCtrl.verifyOtp)
router.post('/forgot-password', otpResetLimiter, authCtrl.forgotPassword)
router.post('/reset-password/:token', otpResetLimiter, authCtrl.resetpassword)
router.post('/resend-otp', otpResendLimiter, authCtrl.resendOtp)

module.exports = router
