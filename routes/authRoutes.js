const express = require('express')
const router = express.Router()
const authCtrl = require('../controllers/authController') // ✅ FIXED
const { upload } = require('../middleware/uploadMiddleware')

router.post(
  '/register',
  upload.single('avatar'), // ✅ ADD THIS LINE
  authCtrl.register
)
router.post('/register', authCtrl.register)
router.post('/login', authCtrl.login)
router.post('/refresh', authCtrl.refresh)
router.post('/logout', authCtrl.logOut)
router.get('/me', authCtrl.me)
router.post('/verify-otp', authCtrl.verifyOtp)
router.post('/forgot-password', authCtrl.forgotPassword)
router.post('/reset-password/:token', authCtrl.resetpassword)
router.post('/resend-otp', authCtrl.resendOtp)

module.exports = router
