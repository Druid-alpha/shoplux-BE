const router = require('express').Router()
const auth = require('../middleware/authCookie')
const requireAdmin = require('../middleware/requireAdmin')
const userController = require('../controllers/userController')
const { upload } = require('../middleware/uploadMiddleware')

// ✅ USER ROUTES (profile updates)
router.get('/me', auth, userController.getProfile)
router.put('/me', auth, userController.updateProfile) // update name only
router.put('/me/avatar', auth, upload.single('avatar'), userController.updateAvatar) // update avatar

// ✅ ADMIN ROUTES
router.get('/', auth, requireAdmin, userController.getUsers)
router.put('/:id', auth, requireAdmin, userController.adminUpdateUser)
router.delete('/:id', auth, requireAdmin, userController.adminDeleteUser)

module.exports = router
