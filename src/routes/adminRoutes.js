const express = require('express')
const router = express.Router()
const adminCtrl = require('../controllers/userController')
const authCookie = require('../middleware/authCookie')
const requireAdmin = require('../middleware/requireAdmin')
const Color = require('../../models/Color')

// ✅ Protect all admin routes
router.use(authCookie, requireAdmin)

// Get all users
router.get('/users', adminCtrl.getUsers)

// Update user role / info
router.put('/users/:id', adminCtrl.adminUpdateUser)

// Soft delete user
router.delete('/users/:id', adminCtrl.adminDeleteUser)

// Add a new raw color directly from Product Form
router.post('/colors', async (req, res) => {
    try {
        const { name, hex, category } = req.body
        if (!name || !hex || !category) {
            return res.status(400).json({ message: 'Name, hex, and category are required' })
        }

        // Check if exact color exists for this category to avoid duplicates
        let color = await Color.findOne({
            name: new RegExp(`^${name}$`, 'i'),
            category
        })

        if (!color) {
            color = await Color.create({ name, hex, category })
        }

        res.status(201).json({ color })
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'This color already exists in this category.' })
        }
        res.status(500).json({ message: 'Failed to create color' })
    }
})

module.exports = router
