const router = require('express').Router()
const auth = require('../middleware/authCookie')
const orderCtrl = require('../controllers/orderController')

router.use(auth)
router.get('/my', orderCtrl.getMyOrder)
router.post('/validate', orderCtrl.validateOrder)
router.post('/:id/invoice', orderCtrl.generateOrderInvoice)
router.get('/:id/invoice/download', orderCtrl.downloadOrderInvoice)
router.get('/:id', orderCtrl.getOrderId)
router.get('/', orderCtrl.getAllOrders)
router.post('/', orderCtrl.createOrder)
router.patch('/:id/status', orderCtrl.updateOrderStatus)
router.delete('/:id', orderCtrl.deleteOrder)

module.exports = router
