const express = require('express')
const router = express.Router()
const adminCtrl = require('../controllers/userController')
const authCookie = require('../middleware/authCookie')
const requireAdmin = require('../middleware/requireAdmin')
const Color = require('../../models/Color')
const Category = require('../../models/Category')
const Product = require('../../models/product')
const Order = require('../../models/order')
const mongoose = require('mongoose')
const { releaseOrderReservations } = require('../utils/reservation')

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
const rgbToHsl = (r, g, b) => {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const delta = max - min
    let h = 0
    if (delta !== 0) {
        if (max === rn) h = ((gn - bn) / delta) % 6
        else if (max === gn) h = (bn - rn) / delta + 2
        else h = (rn - gn) / delta + 4
        h = Math.round(h * 60)
        if (h < 0) h += 360
    }
    const l = (max + min) / 2
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
    return { h, s, l }
}

const familyFromHex = (hex) => {
    const h = normalizeHex(hex)
    if (!h) return ''
    const r = parseInt(h.slice(1, 3), 16)
    const g = parseInt(h.slice(3, 5), 16)
    const b = parseInt(h.slice(5, 7), 16)
    const { h: hue, s, l } = rgbToHsl(r, g, b)
    if (l <= 0.08) return 'black'
    if (l >= 0.95) return 'white'
    if (s < 0.12) {
        if (l <= 0.2) return 'black'
        if (l >= 0.9) return 'white'
        if (hue >= 30 && hue < 70) return l >= 0.5 ? 'beige' : 'brown'
        if (hue >= 70 && hue < 160) return 'olive'
        if (hue >= 160 && hue < 250) return 'blue gray'
        return 'gray'
    }
    if (hue >= 45 && hue < 70 && l < 0.4) return 'olive'
    if ((hue >= 330 || hue < 15) && l >= 0.6) return 'pink'
    if (hue >= 330 || hue < 15) return 'red'
    if (hue < 45) return 'orange'
    if (hue < 70) return 'yellow'
    if (hue < 165) return 'green'
    if (hue < 200) return 'teal'
    if (hue < 255) return 'blue'
    if (hue < 290) return 'purple'
    if (hue < 330) return 'pink'
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

// Reset reserved stock for a product (admin only)
router.post('/reservations/reset-product', async (req, res) => {
    try {
        const { productId, title } = req.body || {}
        let product = null

        if (productId && mongoose.isValidObjectId(productId)) {
            product = await Product.findById(productId).select('_id title reserved variants')
        } else if (title) {
            product = await Product.findOne({
                title: new RegExp(`^${escapeRegex(title)}$`, 'i')
            }).select('_id title reserved variants')
        }

        if (!product) {
            return res.status(404).json({ message: 'Product not found' })
        }

        await Product.updateOne(
            { _id: product._id },
            {
                $set: {
                    reserved: 0,
                    'variants.$[].reserved': 0
                }
            }
        )

        const refreshed = await Product.findById(product._id).select('_id title reserved variants')
        res.json({ message: 'Reservation reset', product: refreshed })
    } catch (error) {
        console.error('[RESERVATION RESET]', error)
        res.status(500).json({ message: 'Failed to reset reservation', error: error.message })
    }
})

// Reset reserved stock for all products (admin only)
router.post('/reservations/reset-all', async (req, res) => {
    try {
        const result = await Product.updateMany(
            {},
            { $set: { reserved: 0, 'variants.$[].reserved': 0 } }
        )
        res.json({ message: 'All reservations reset', result })
    } catch (error) {
        console.error('[RESERVATION RESET ALL]', error)
        res.status(500).json({ message: 'Failed to reset all reservations', error: error.message })
    }
})

const escapeCsv = (value) => {
    if (value === null || value === undefined) return ''
    const str = String(value).replace(/"/g, '""')
    if (/[",\n]/.test(str)) return `"${str}"`
    return str
}

router.get('/export/products', async (req, res) => {
    try {
        const products = await Product.find({})
            .populate('category', 'name')
            .populate('brand', 'name')
            .select('title price stock discount category brand isDeleted createdAt')
            .lean()

        const header = ['id', 'title', 'price', 'stock', 'discount', 'category', 'brand', 'deleted', 'createdAt']
        const rows = products.map(p => ([
            p._id,
            p.title,
            p.price,
            p.stock,
            p.discount,
            p.category?.name || '',
            p.brand?.name || '',
            p.isDeleted ? 'yes' : 'no',
            p.createdAt
        ]))
        const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n')
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', `attachment; filename="products-${Date.now()}.csv"`)
        res.send(csv)
    } catch (error) {
        console.error('[EXPORT PRODUCTS]', error)
        res.status(500).json({ message: 'Failed to export products' })
    }
})

router.get('/export/orders', async (req, res) => {
    try {
        const orders = await Order.find({})
            .populate('user', 'email name')
            .select('totalAmount status paymentStatus paymentRef returnStatus refundAmount createdAt shippingAddress')
            .lean()

        const header = ['id', 'customer', 'email', 'total', 'status', 'paymentStatus', 'paymentRef', 'returnStatus', 'refundAmount', 'state', 'city', 'createdAt']
        const rows = orders.map(o => ([
            o._id,
            o.user?.name || '',
            o.user?.email || '',
            o.totalAmount,
            o.status,
            o.paymentStatus,
            o.paymentRef,
            o.returnStatus,
            o.refundAmount,
            o.shippingAddress?.state || '',
            o.shippingAddress?.city || '',
            o.createdAt
        ]))
        const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n')
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`)
        res.send(csv)
    } catch (error) {
        console.error('[EXPORT ORDERS]', error)
        res.status(500).json({ message: 'Failed to export orders' })
    }
})

// Bulk delete orders (admin only)
router.post('/orders/delete-bulk', async (req, res) => {
    const session = await mongoose.startSession()
    session.startTransaction()
    try {
        const { orderIds = [] } = req.body || {}
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({ message: 'orderIds array is required' })
        }
        const ids = orderIds
            .filter(id => mongoose.isValidObjectId(id))
            .map(id => new mongoose.Types.ObjectId(id))
        if (ids.length === 0) {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({ message: 'No valid orderIds provided' })
        }

        const orders = await Order.find({ _id: { $in: ids } }).session(session)
        for (const order of orders) {
            if (order.status === 'pending' && order.paymentStatus === 'pending') {
                await releaseOrderReservations(order, session)
            }
        }

        const result = await Order.deleteMany({ _id: { $in: ids } }, { session })
        await session.commitTransaction()
        session.endSession()
        return res.json({ deleted: result.deletedCount || 0 })
    } catch (error) {
        await session.abortTransaction()
        session.endSession()
        console.error('[ADMIN] Bulk delete orders failed:', error)
        return res.status(500).json({ message: 'Failed to delete orders' })
    }
})

// Add a new raw color directly from Product Form
router.post('/colors', async (req, res) => {
    const { name, hex, category } = req.body
    try {
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
            const existingByHex = await Color.findOne({ category: categoryId, hex: normalizedHex })
            if (existingByHex) {
                return res.status(200).json({ color: existingByHex })
            }
            // Legacy name+category uniqueness still present: create with unique readable name.
            const uniqueName = `${resolvedName} ${normalizedHex.toUpperCase()}`.trim()
            const created = await Color.create({
                name: uniqueName,
                hex: normalizedHex,
                category: categoryId
            })
            return res.status(201).json({ color: created })
        }
        res.status(500).json({ message: 'Failed to create color', error: error.message })
    }
})

module.exports = router
