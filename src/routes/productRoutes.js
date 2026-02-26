// server/routes/productRoutes.js
const express = require('express')
const router = express.Router()

const auth = require('../middleware/authCookie')
const requireAdmin = require('../middleware/requireAdmin')
const ProductController = require('../controllers/productController')
const { upload } = require('../middleware/uploadMiddleware')

/* ================= ADMIN ROUTES ================= */
// Restore all soft-deleted products (admin)

router.delete(
  '/admin/hard-delete-all',
  auth,
  requireAdmin,
  ProductController.hardDeleteAllProducts
)
router.patch(
  '/admin/restore-all',
  auth,
  requireAdmin,
  ProductController.restoreAllProducts
)

// Admin list
router.get('/admin', auth, requireAdmin, ProductController.adminListProducts)

// Create product
router.post(
  '/admin',
  auth,
  requireAdmin,
  upload.any(),
  ProductController.createProduct
)

// Update product
router.put(
  '/admin/:id',
  auth,
  requireAdmin,
  upload.any(),
  ProductController.updateProduct
)

// Update variants only
router.put(
  '/admin/:id/variants',
  auth,
  requireAdmin,
  upload.any(),
  ProductController.updateVariants
)
router.patch(
  '/admin/:id/feature',
  auth,
  requireAdmin,
  ProductController.createFeatured
)
// Soft delete
router.delete(
  '/admin/:id',
  auth,
  requireAdmin,
  ProductController.deleteProduct
)

// Hard delete (permanent)
router.delete(
  '/admin/:id/hard',
  auth,
  requireAdmin,
  ProductController.hardDeleteProduct
)

// Restore soft-deleted product
router.patch(
  '/admin/:id/restore',
  auth,
  requireAdmin,
  ProductController.restoreProduct
)
// Hard delete all soft-deleted products (admin)



/* ================= PUBLIC ROUTES ================= */

// Get filter options
router.get('/filters', ProductController.getFilterOptions)

// Featured products
router.get('/featured', ProductController.getFeatured)

// List products
router.get('/', ProductController.listProducts)

// Get single product by ID ⚠️ MUST BE LAST
router.get('/:id', ProductController.getProduct)

module.exports = router
