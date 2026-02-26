const router= require('express').Router()
const auth = require('../middleware/authCookie')
const orderCtrl = require('../controllers/orderController')

router.use(auth)
router.get('/my', orderCtrl.getMyOrder)
router.get('/:id', orderCtrl.getOrderId)
router.get('/', orderCtrl.getAllOrders)
router.post('/', orderCtrl.createOrder)
router.patch('/:id/status',orderCtrl.updateOrderStatus)

module.exports=router