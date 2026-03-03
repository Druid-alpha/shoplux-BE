const router = require('express').Router()
const auth = require('../middleware/authCookie')
const cartController = require('../controllers/cartController')

router.get('/', auth, cartController.getCart)
router.post('/add', auth, cartController.addToCart)
router.put('/update', auth, cartController.updateItem)
router.delete('/remove', auth, cartController.removeItem)
router.delete('/clear', auth, cartController.clearCart)

// 🔥 NEW ROUTE
router.post('/sync', auth, cartController.syncCart)

module.exports = router