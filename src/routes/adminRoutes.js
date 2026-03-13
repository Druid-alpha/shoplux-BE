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
        const normalizeHex = (value) => {
            if (!value) return ''
            let h = String(value).trim().toLowerCase()
            if (!h.startsWith('#')) h = `#${h}`
            if (h.length === 4) {
                h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
            }
            return /^#[0-9a-f]{6}$/i.test(h) ? h : ''
        }
        const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const { name, hex, category } = req.body
        if (!hex || !category) {
            return res.status(400).json({ message: 'Hex and category are required' })
        }

        const normalizedHex = normalizeHex(hex)
        if (!normalizedHex) {
            return res.status(400).json({ message: 'Invalid hex format' })
        }
        const resolvedName = String(name || '').trim() || normalizedHex.toUpperCase()

        // Check if exact color exists for this category to avoid duplicates
        let color = await Color.findOne({
            hex: normalizedHex,
            category
        })

        if (!color) {
            color = await Color.findOne({
                name: new RegExp(`^${escapeRegex(resolvedName)}$`, 'i'),
                category
            })
        }

        if (!color) {
            color = await Color.create({ name: resolvedName, hex: normalizedHex, category })
        }

        res.status(201).json({ color })
    } catch (error) {
        if (error.code === 11000) {
            const normalizedHex = normalizeHex(hex)
            const resolvedName = String(name || '').trim() || normalizedHex.toUpperCase()
            const existing = await Color.findOne({
                category,
                $or: [
                    { hex: normalizedHex },
                    { name: new RegExp(`^${escapeRegex(resolvedName)}$`, 'i') }
                ]
            })
            if (existing) {
                return res.status(200).json({ color: existing })
            }
            return res.status(400).json({ message: 'This color already exists in this category.' })
        }
        res.status(500).json({ message: 'Failed to create color' })
    }
})

module.exports = router
