const express = require('express')
const router = express.Router()
const adminCtrl = require('../controllers/userController')
const authCookie = require('../middleware/authCookie')
const requireAdmin = require('../middleware/requireAdmin')
const Color = require('../../models/Color')
const Category = require('../../models/Category')
const mongoose = require('mongoose')

// ✅ Protect all admin routes
router.use(authCookie, requireAdmin)

// Get all users
router.get('/users', adminCtrl.getUsers)

// Update user role / info
router.put('/users/:id', adminCtrl.adminUpdateUser)

// Soft delete user
router.delete('/users/:id', adminCtrl.adminDeleteUser)

const normalizeHex = (value) => {
    if (!value) return ''
    let h = String(value).trim().toLowerCase()
    if (!h.startsWith('#')) h = `#${h}`
    if (h.length === 4) {
        h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
    }
    return /^#[0-9a-f]{6}$/i.test(h) ? h : ''
}
const isHexLike = (value) => /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(value || ''))
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const titleCase = (value) =>
    value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
const familyFromHex = (hex) => {
    const h = normalizeHex(hex)
    if (!h) return ''
    const r = parseInt(h.slice(1, 3), 16)
    const g = parseInt(h.slice(3, 5), 16)
    const b = parseInt(h.slice(5, 7), 16)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 40) return 'black'
    if (min > 220) return 'white'
    if (max - min < 20) return 'gray'
    if (r >= g && r >= b) return g > 120 ? 'orange' : 'red'
    if (g >= r && g >= b) return b > 140 ? 'teal' : 'green'
    if (b >= r && b >= g) return r > 140 ? 'purple' : 'blue'
    return ''
}
const HEX_NAME_MAP = {
    '#000000': 'Midnight Black',
    '#0f172a': 'Midnight',
    '#111111': 'Jet Black',
    '#1f2937': 'Charcoal',
    '#374151': 'Graphite',
    '#6b7280': 'Slate Gray',
    '#9ca3af': 'Steel Gray',
    '#d1d5db': 'Silver',
    '#e5e7eb': 'Cloud',
    '#f5f5f5': 'Soft White',
    '#ffffff': 'Pure White',
    '#ef4444': 'Crimson',
    '#f97316': 'Tangerine',
    '#f59e0b': 'Amber',
    '#facc15': 'Gold',
    '#22c55e': 'Emerald',
    '#14b8a6': 'Teal',
    '#3b82f6': 'Royal Blue',
    '#6366f1': 'Indigo',
    '#8b5cf6': 'Violet',
    '#ec4899': 'Rose',
    '#efeae6': 'Pearl White',
    '#656b83': 'Slate Blue'
}

// Add a new raw color directly from Product Form
router.post('/colors', async (req, res) => {
    try {
        const { name, hex, category } = req.body
        if (!hex || !category) {
            return res.status(400).json({ message: 'Hex and category are required' })
        }

        const normalizedHex = normalizeHex(hex)
        if (!normalizedHex) {
            return res.status(400).json({ message: 'Invalid hex format' })
        }
        const inputName = String(name || '').trim()
        const allowNameMatch = !!(inputName && !(inputName.startsWith('#') || isHexLike(inputName)))
        const resolvedName = allowNameMatch
            ? inputName
            : (HEX_NAME_MAP[normalizedHex] || titleCase(familyFromHex(normalizedHex)) || normalizedHex.toUpperCase())

        let categoryId = category
        if (!mongoose.isValidObjectId(category)) {
            const foundCategory = await Category.findOne({
                name: new RegExp(`^${escapeRegex(category)}$`, 'i')
            }).select('_id')
            if (!foundCategory?._id) {
                return res.status(400).json({ message: 'Invalid category' })
            }
            categoryId = foundCategory._id
        }

        // Check if exact color exists for this category to avoid duplicates
        let color = await Color.findOne({
            hex: normalizedHex,
            category: categoryId
        })

        if (!color && allowNameMatch) {
            color = await Color.findOne({
                name: new RegExp(`^${escapeRegex(resolvedName)}$`, 'i'),
                category: categoryId
            })
        }

        if (!color) {
            color = await Color.create({ name: resolvedName, hex: normalizedHex, category: categoryId })
        }

        res.status(201).json({ color })
    } catch (error) {
        if (error.code === 11000) {
            const normalizedHex = normalizeHex(hex)
            const inputName = String(name || '').trim()
            const allowNameMatch = !!(inputName && !(inputName.startsWith('#') || isHexLike(inputName)))
            const resolvedName = allowNameMatch
                ? inputName
                : (HEX_NAME_MAP[normalizedHex] || titleCase(familyFromHex(normalizedHex)) || normalizedHex.toUpperCase())
            let categoryId = category
            if (!mongoose.isValidObjectId(category)) {
                const foundCategory = await Category.findOne({
                    name: new RegExp(`^${escapeRegex(category)}$`, 'i')
                }).select('_id')
                if (!foundCategory?._id) {
                    return res.status(400).json({ message: 'Invalid category' })
                }
                categoryId = foundCategory._id
            }
            const orConditions = [{ hex: normalizedHex }]
            if (allowNameMatch) {
                orConditions.push({ name: new RegExp(`^${escapeRegex(resolvedName)}$`, 'i') })
            }
            const existing = await Color.findOne({
                category: categoryId,
                $or: orConditions
            })
            if (existing) {
                return res.status(200).json({ color: existing })
            }
            return res.status(400).json({ message: 'This color already exists in this category.' })
        }
        res.status(500).json({ message: 'Failed to create color', error: error.message })
    }
})

module.exports = router
