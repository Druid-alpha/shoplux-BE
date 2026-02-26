const express = require('express')
const router = express.Router()
const adminCtrl = require('../controllers/userController')
const authCookie = require('../middleware/authCookie')
const requireAdmin = require('../middleware/requireAdmin')

// ✅ Protect all admin routes
router.use(authCookie, requireAdmin)

// Get all users
router.get('/users', adminCtrl.getUsers)

// Update user role / info
router.put('/users/:id', adminCtrl.adminUpdateUser)

// Soft delete user
router.delete('/users/:id', adminCtrl.adminDeleteUser)

module.exports = router
