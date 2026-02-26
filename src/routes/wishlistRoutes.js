const router = require('express').Router()
const auth = require('../middleware/authCookie')
const wishlistController = require('../controllers/wishlistController')

router.use(auth)

router.get('/', wishlistController.getWishList)
router.post('/toggle', wishlistController.toggleWishList)

module.exports = router
