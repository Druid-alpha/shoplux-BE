const mongoose = require('mongoose')
const { z } = require('zod')
const cloudinary = require('../config/cloudinary') // adjust the path

const Product = require('../models/product')
const Brand = require('../models/Brand')
const Category = require('../models/Category')
const Color = require('../models/Color')
const { uploadToCloudinary } = require('../middleware/uploadMiddleware')

/* =====================================================
   HELPERS
===================================================== */

// ObjectId validators
const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value)

const toObjectId = (value) =>
  new mongoose.Types.ObjectId(value)

// Zod helper
const objectId = () =>
  z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId')

// Normalize variants for DB
const normalizeVariants = (variants = []) =>
  variants.map(v => ({
    sku: v.sku || '',
    options: {
      color: v.options?.color && isValidObjectId(v.options.color)
        ? toObjectId(v.options.color)
        : null,
      size: v.options?.size || null
    },
    price: Number(v.price) || 0,
    stock: Number(v.stock) || 0,
    image: v.image?.url && v.image?.public_id ? v.image : null
  }))





// Build Mongo query from request safely
const buildQueryFromReq = async (req, { admin = false } = {}) => {


  const q = {}
  if (!admin) q.isDeleted = false
  const andConditions = []

  // 🛑 SURGICAL FIX #2
  // Prevent clothingType from applying outside clothing category
  // CLOTHING TYPE (SAFE – NEVER KILLS RESULTS)



  // Search
  if (req.query.search) {
    const regex = new RegExp(req.query.search, 'i')
    andConditions.push({
      $or: [
        { title: regex },
        { description: regex },
        { sku: regex }
      ]
    })
  }

  // Category
  // -----------------------
  // CATEGORY (ID OR NAME)
  // -----------------------
  if (req.query.category && req.query.category !== 'all') {
    let categoryId = null

    if (isValidObjectId(req.query.category)) {
      categoryId = toObjectId(req.query.category)
    } else {
      const category = await Category.findOne({
        name: new RegExp(`^${req.query.category}$`, 'i')
      }).select('_id')
      if (category) categoryId = category._id
    }

    if (categoryId) {
      andConditions.push({ category: categoryId })
    }
  }

  const clothingType =
    req.query.clothingType && req.query.clothingType !== 'all'
      ? req.query.clothingType
      : null;
  // Clothing Type filter
  // Clothing Type filter (FIXED)
  // ✅ STRICT clothingType filter (FINAL FIX)

  // -----------------------
  // CLOTHING TYPE (SAFE)
  // -----------------------
  // if (req.query.clothingType && req.query.clothingType !== 'all') {
  //   let category = null

  //   if (req.query.category) {
  //     if (isValidObjectId(req.query.category)) {
  //       category = await Category.findById(req.query.category).select('name')
  //     } else {
  //       category = await Category.findOne({
  //         name: new RegExp(`^${req.query.category}$`, 'i')
  //       }).select('name')
  //     }
  //   }

  //   if (category?.name?.toLowerCase() === 'clothing') {
  //     andConditions.push({ clothingType: req.query.clothingType })
  //   }
  // }

  // ✅ FINAL clothingType filter (ID OR NAME SAFE)
  if (
    req.query.clothingType &&
    req.query.clothingType !== 'all' &&
    req.query.category
  ) {
    let category = null

    if (isValidObjectId(req.query.category)) {
      category = await Category.findById(req.query.category).select('name')
    } else {
      category = await Category.findOne({
        name: new RegExp(`^${req.query.category}$`, 'i')
      }).select('name')
    }

    if (category?.name?.toLowerCase() === 'clothing') {
      andConditions.push({ clothingType: req.query.clothingType })
    }
  }



  // Brand
  if (req.query.brand && req.query.brand !== 'all' && isValidObjectId(req.query.brand)) {
    andConditions.push({ brand: toObjectId(req.query.brand) })
  }

  // Color (main or variant)
  if (req.query.color && req.query.color !== 'all' && isValidObjectId(req.query.color)) {
    const colorId = toObjectId(req.query.color)
    andConditions.push({
      $or: [
        { color: colorId },
        { 'variants.options.color': colorId }
      ]
    })
  }


  // Tags
  if (req.query.tags) {
    andConditions.push({ tags: { $in: req.query.tags.split(',').map(t => t.trim()) } })
  }

  // Price Range
  if (req.query.minPrice || req.query.maxPrice) {
    const priceQuery = {}
    if (req.query.minPrice) priceQuery.$gte = Number(req.query.minPrice)
    if (req.query.maxPrice) priceQuery.$lte = Number(req.query.maxPrice)

    andConditions.push({
      $or: [
        // products WITHOUT variants → use base price
        {
          variants: { $size: 0 },
          price: priceQuery
        },
        // products WITH variants → use variant prices ONLY
        {
          'variants.price': priceQuery
        }
      ]
    })
  }


  if (andConditions.length > 0) q.$and = andConditions

  return q
}


/* =====================================================
   ZOD SCHEMAS
===================================================== */

const variantSchema = z.object({
  sku: z.string().min(3),
  options: z.object({
    color: objectId().optional(),
    size: z.string().optional()
  }),
  price: z.coerce.number().min(0),
  stock: z.coerce.number().min(0),


  image: z
    .object({
      url: z.string(),
      public_id: z.string()
    })
    .optional()
    .nullable()


})

const createSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  price: z.coerce.number().min(0).optional(),
  sku: z.string().optional(),

  category: objectId(),
  color: objectId().optional(),
  brand: objectId().optional(),
  tags: z.array(z.string()).optional(),
  stock: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
  featured: z.boolean().optional(),
  clothingType: z.enum(['clothes', 'shoes', 'bag', 'eyeglass']).optional(),
  variants: z.array(variantSchema).optional()
})

const updateSchema = createSchema.partial().extend({
  brand: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional()
    .or(z.literal(''))
    .transform(v => (v === '' ? undefined : v)),
  color: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional()
    .or(z.literal(''))
    .transform(v => (v === '' ? undefined : v)),

  category: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional()
    .or(z.literal(''))
    .transform(v => (v === '' ? undefined : v)),
  price: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
})


/* =====================================================
   FILTER OPTIONS (MASTER DATA)
===================================================== */

// GET /api/products/filters?category=...&brand=...
// backend/controllers/productController.js
// backend/controllers/productController.js


// GET /api/products/filters
// GET /api/products/filters
// GET /api/products/filters
// GET /api/products/filters
// GET /api/products/filters

exports.getFilterOptions = async (req, res) => {
  try {
    const categories = await Category.find().select('_id name');

    let brands = [];
    let colors = [];
    let sizes = [];
    let clothingTypes = [];

    // Validate category
    let categoryId = null;
    if (req.query.category && req.query.category !== 'all') {
      if (mongoose.Types.ObjectId.isValid(req.query.category)) {
        categoryId = req.query.category;
      } else {
        const category = await Category.findOne({
          name: new RegExp(`^${req.query.category}$`, 'i'),
        }).select('_id');
        if (category) categoryId = category._id;
      }
    }

    // Normalize clothingType query
    const clothingType =
      req.query.clothingType && req.query.clothingType !== 'all'
        ? req.query.clothingType
        : null;

    // Colors - make them global so they show for all categories
    colors = await Color.find().select('_id name hex');

    if (categoryId) {
      const category = await Category.findById(categoryId);

      if (category?.name.toLowerCase() === 'clothing') {
        // Clothing types
        clothingTypes = ['clothes', 'shoes', 'bag', 'eyeglass'];

        // Filter products to get valid brands
        const productFilter = { category: categoryId, isDeleted: false };
        if (clothingType && clothingTypes.includes(clothingType)) {
          productFilter.clothingType = clothingType;
        }

        const brandIds = await Product.distinct('brand', productFilter);
        brands = await Brand.find({
          _id: { $in: brandIds },
          isActive: true,
        }).select('_id name');

        // Sizes by type
        if (clothingType === 'clothes') sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
        else if (clothingType === 'shoes') sizes = ['38', '39', '40', '41', '42', '43', '44', '45'];
        else sizes = [];
      } else {
        // Non-clothing categories → brands filtered by category OR global
        brands = await Brand.find({
          $or: [{ category: categoryId }, { category: null }],
          isActive: true,
        }).select('_id name');

        clothingTypes = [];
        sizes = [];
      }
    } else {
      // No category selected → show all brands/colors
      brands = await Brand.find({ isActive: true }).select('_id name');
      clothingTypes = [];
      sizes = [];
    }

    res.json({ categories, brands, clothingTypes, colors, sizes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch filter options' });
  }
};


/* =====================================================
   LIST PRODUCTS (SHOP)
===================================================== */

exports.listProducts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1))
    const limit = Math.min(100, Number(req.query.limit || 12))
    const sortBy = req.query.sortBy || '-createdAt'
    const query = await buildQueryFromReq(req)
    console.log('SHOP QUERY:', JSON.stringify(query, null, 2))
    const total = await Product.countDocuments(query)
    const products = await Product.find(query)
      .populate('brand category variants.options.color color')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort(sortBy)
    const productsWithStock = products.map(prod => {
      const totalStock = prod.variants?.length
        ? prod.variants.reduce((sum, v) => sum + (v.stock || 0), 0)
        : prod.stock || 0;

      return {
        ...prod.toObject(),
        totalStock,
        isOutOfStock: totalStock <= 0
      };
    });

    res.json({
      products: productsWithStock,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to list products' })
  }
}
/* =====================================================
   FEATURE / UNFEATURE PRODUCT (ADMIN)
===================================================== */
exports.createFeatured = async (req, res) => {
  try {
    const { id } = req.params
    const { featured } = req.body

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    if (typeof featured !== 'boolean') {
      return res.status(400).json({
        message: 'featured must be boolean'
      })
    }

    const product = await Product.findOne({
      _id: id,
      isDeleted: false
    })

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    product.featured = featured
    await product.save()

    res.json({
      message: featured
        ? 'Product marked as featured'
        : 'Product removed from featured',
      product
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      message: 'Failed to update featured status'
    })
  }
}
/* =====================================================
   FEATURED PRODUCTS
===================================================== */

exports.getFeatured = async (req, res) => {
  try {
    const products = await Product.find({
      isDeleted: false,
      featured: true
    })
      .populate('brand category variants.options.color color')
      .limit(12)
      .sort({ createdAt: -1 })

    res.json({ products })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to fetch featured products' })
  }
}

/* =====================================================
   SINGLE PRODUCT
===================================================== */

exports.getProduct = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const product = await Product.findOne({
      _id: toObjectId(req.params.id),
      isDeleted: false
    }).populate('brand category variants.options.color color')

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    // Calculate total stock dynamically
    let totalStock = 0;

    if (product.variants?.length > 0) {
      totalStock = product.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
    } else {
      totalStock = product.stock || 0;
    }

    res.json({
      product: {
        ...product.toObject(),
        totalStock,
        isOutOfStock: totalStock <= 0
      }
    });
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to get product' })
  }
}

/* =====================================================
   ADMIN LIST
===================================================== */

exports.adminListProducts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1))
    const limit = Math.min(200, Number(req.query.limit || 50))
    const query = await buildQueryFromReq(req, { admin: true })
    const total = await Product.countDocuments(query)
    const products = await Product.find(query)
      .populate('brand category variants.options.color color createdBy', 'name email')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 })

    res.json({
      products,
      total,
      page,
      pages: Math.ceil(total / limit)

    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to list admin products' })
  }
}

/* =====================================================
   CREATE PRODUCT
===================================================== */

exports.createProduct = async (req, res) => {
  try {
    /* =======================
       PARSE PAYLOAD SAFELY
    ======================= */
    const rawPayload = req.body.payload
      ? JSON.parse(req.body.payload)
      : req.body

    const parsedVariants =
      typeof rawPayload.variants === 'string'
        ? JSON.parse(rawPayload.variants)
        : rawPayload.variants || []

    const data = createSchema.parse({
      ...rawPayload,
      price: Number(rawPayload.price),
      stock:
        rawPayload.stock !== undefined
          ? Number(rawPayload.stock)
          : 0,
      discount:
        rawPayload.discount !== undefined
          ? Number(rawPayload.discount)
          : 0,
      featured:
        rawPayload.featured === true ||
        rawPayload.featured === 'true',
      tags: rawPayload.tags
        ? Array.isArray(rawPayload.tags)
          ? rawPayload.tags
          : rawPayload.tags.split(',').map(t => t.trim())
        : [],
      variants: parsedVariants,
    })

    if (!data.variants?.length && data.price === undefined) {
      return res.status(400).json({
        message: 'Price is required when no variants exist'
      })
    }

    if (data.clothingType === 'shoes') {
      if (data.variants?.some(v => isNaN(Number(v.options?.size)))) {
        return res.status(400).json({ message: 'Shoe sizes must be numbers' })
      }
    }

    if (data.clothingType === 'clothes') {
      const allowed = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
      if (data.variants?.some(v => v.options?.size && !allowed.includes(v.options.size))) {
        return res.status(400).json({ message: 'Invalid clothing size' })
      }
    }

    if (data.clothingType) {
      const category = await Category.findById(data.category).select('name')
      if (!category || category.name.toLowerCase() !== 'clothing') {
        return res.status(400).json({
          message: 'clothingType is only allowed for clothing category'
        })
      }
    }

    /* =======================
       VALIDATE BRAND ↔ CATEGORY
    ======================= */
    if (data.brand) {
      const validBrand = await Brand.findOne({
        _id: data.brand,
        category: data.category,
        isActive: true,
      })
      //  if (
      //   data.variants?.some(v => v.options?.size) &&
      //   !['clothes', 'shoes'].includes(data.clothingType)
      // ) {
      //   return res.status(400).json({
      //     message: 'Sizes are only allowed for clothes or shoes'
      //   })
      // }



      if (!validBrand) {
        return res.status(400).json({
          message: 'Selected brand does not belong to selected category',
        })
      }
    }
    if (data.variants?.length > 0) {
      data.stock = 0
    }

    if (!data.variants?.length && data.stock === undefined) {
      data.stock = 0
    }
    if (!data.sku) {
      data.sku = `${data.title
        .toUpperCase()
        .replace(/\s+/g, '-')}-${Date.now()}`
    }

    /* =======================
       MAIN PRODUCT IMAGES
    ======================= */
    /* =======================
    MAIN PRODUCT IMAGES
 ======================= */
    const images = []

    if (Array.isArray(req.files)) {
      const mainImages = req.files.filter(
        f => !f.fieldname.startsWith('variant_')
      )

      for (const file of mainImages) {
        const uploaded = await uploadToCloudinary(
          file.buffer,
          'products'
        )

        images.push({
          url: uploaded.secure_url,
          public_id: uploaded.public_id
        })
      }
    }

    /* =======================
       VARIANT IMAGES
    ======================= */

    // =======================
    // VARIANT IMAGES
    // =======================
    const variantFiles = req.files?.filter(f => f.fieldname.startsWith('variant_')) || [];

    const uploadedVariants = await Promise.all(
      parsedVariants.map(async (variant, idx) => {
        const file = variantFiles.find(f => f.fieldname === `variant_${idx}`);
        let image = variant.image || null;

        if (file) {
          const uploaded = await uploadToCloudinary(file.buffer, 'variants');
          image = { url: uploaded.secure_url, public_id: uploaded.public_id };
        }

        return { ...variant, image };
      })
    );

    data.variants = uploadedVariants;

    // then save




    /* =======================
       CREATE PRODUCT
    ======================= */
    const product = await Product.create({
      title: data.title,
      description: data.description,
      price: data.price,
      stock: data.stock,
      category: toObjectId(data.category),
      brand: data.brand ? toObjectId(data.brand) : null,
      color: data.color ? toObjectId(data.color) : null,
      clothingType: data.clothingType || null,
      tags: data.tags,
      discount: data.discount,
      featured: data.featured,
      sku: data.sku || '',
      images,
      variants: normalizeVariants(data.variants),
      avgRating: 0,
      reviewsCount: 0,
      createdBy: req.user.id,
    })
    if (product.variants.length) {
      product.price = Math.min(...product.variants.map(v => v.price))
      await product.save()
    }

    res.status(201).json({ product })
  } catch (err) {
    console.error(err)
    res.status(400).json({
      message: err.message || 'Product creation failed',
    })
  }
}



/* =====================================================
   UPDATE PRODUCT
===================================================== */



exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }


    const payload = req.body.payload
      ? JSON.parse(req.body.payload)
      : req.body

    const data = updateSchema.parse(payload)

    // 🔹 Fetch existing product FIRST
    const existingProduct = await Product.findById(id)
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found' })
    }

    const update = { $set: {} }

    const fields = [
      'title',
      'description',
      'price',
      'stock',
      'discount',
      'featured',
      'sku',
      'tags'
    ]

    fields.forEach(f => {
      if (data[f] !== undefined) update.$set[f] = data[f]
    })
    if (
      data.price !== undefined &&
      (!existingProduct.variants || existingProduct.variants.length === 0)
    ) {
      update.$set.price = data.price
    }

    if (data.clothingType || data.category) {
      const categoryId = data.category || existingProduct.category
      const category = await Category.findById(categoryId).select('name')

      if (
        data.clothingType &&
        (!category || category.name.toLowerCase() !== 'clothing')
      ) {
        return res.status(400).json({
          message: 'clothingType is only allowed for clothing category'
        })
      }
    }

    if (data.brand && mongoose.isValidObjectId(data.brand)) {
      update.$set.brand = data.brand
    }

    if (data.category && mongoose.isValidObjectId(data.category)) {
      update.$set.category = data.category
    }
    // When updating
    if (data.color && mongoose.isValidObjectId(data.color)) {
      update.$set.color = data.color
    }
    if (data.clothingType) {
      update.$set.clothingType = data.clothingType
    }

    /* =======================
       MAIN PRODUCT IMAGES
    ======================= */
    if (Array.isArray(req.files) && req.files.length > 0) {
      // 🔥 Delete old images
      if (existingProduct.images?.length) {
        await Promise.all(
          existingProduct.images.map(async img => {
            if (img.public_id) {
              try {
                await cloudinary.uploader.destroy(img.public_id)
              } catch (err) {
                console.warn('Failed to delete image from Cloudinary:', img.public_id, err.message)
              }
            }
          })
        )
      }



      // 🔥 Upload new images
      const images = []
      const mainImages = req.files.filter(
        f => !f.fieldname.startsWith('variant_')
      )

      for (const file of mainImages) {
        const uploaded = await uploadToCloudinary(
          file.buffer,
          'products'
        )

        images.push({
          url: uploaded.secure_url,
          public_id: uploaded.public_id
        })
      }

      update.$set.images = images
    }

    if (Array.isArray(data.variants)) {
      const existingVariants = existingProduct.variants || []

      const updatedVariants = await Promise.all(
        data.variants.map(async (variant, idx) => {
          const existing = existingVariants.find(v => v.sku === variant.sku);
          let image = existing?.image || null;

          const file = req.files?.find(f => f.fieldname === `variant_${idx}`);
          if (file) {
            if (image?.public_id) await cloudinary.uploader.destroy(image.public_id);
            const uploaded = await uploadToCloudinary(file.buffer, 'variants');
            image = { url: uploaded.secure_url, public_id: uploaded.public_id };
          }

          return { ...variant, image };
        })
      );

      update.$set.variants = normalizeVariants(updatedVariants);
    }




    const product = await Product.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    )
    product.price = product.variants?.length
      ? Math.min(...product.variants.map(v => v.price))
      : product.price;

    await product.save()


    res.json({ product })
  } catch (err) {
    console.error(err)
    res.status(400).json({ message: err.message })
  }
}


/* =====================================================
   UPDATE VARIANTS ONLY
===================================================== */

exports.updateVariants = async (req, res) => {
  try {
    const { id } = req.params

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }


    const payload = req.body.payload
      ? JSON.parse(req.body.payload)
      : req.body

    if (!Array.isArray(payload.variants)) {
      return res.status(400).json({ message: 'Variants array is required' })
    }

    const product = await Product.findById(id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    const updatedVariants = await Promise.all(
      payload.variants.map(async (variant, idx) => {
        const existing = product.variants.find(v => v.sku === variant.sku)

        let image = existing?.image || { url: '', public_id: '' }

        const field = `variant_${idx}`
        const file = req.files?.find(f => f.fieldname === field)

        if (file) {
          // 🔥 delete old variant image
          if (image.public_id) {
            try {
              await cloudinary.uploader.destroy(image.public_id)
            } catch (err) {
              console.warn('Failed to delete variant image from Cloudinary:', image.public_id, err.message)
            }
          }

          const uploaded = await uploadToCloudinary(
            file.buffer,
            'variants'
          )

          image = {
            url: uploaded.secure_url,
            public_id: uploaded.public_id
          }
        }

        return {
          ...variant,
          image
        }
      })
    )

    product.variants = normalizeVariants(updatedVariants)
    product.price = Math.min(...product.variants.map(v => v.price))

    await product.save()

    res.json({ message: 'Variants updated', product })
  } catch (err) {
    console.error(err)
    res.status(400).json({ message: err.message })
  }
}


/* =====================================================
   DELETE PRODUCT (SOFT)
===================================================== */

exports.deleteProduct = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    // Delete main images from Cloudinary
    if (product.images?.length) {
      await Promise.all(
        product.images.map(async (img) => {
          if (img.public_id) {
            try {
              await cloudinary.uploader.destroy(img.public_id)
            } catch (err) {
              console.warn('Failed to delete image from Cloudinary:', err.message)
            }
          }
        })
      )
    }

    // Delete variant images from Cloudinary
    await Promise.all(
      product.variants.map(async v => {
        if (v.image?.public_id) {
          try {
            await cloudinary.uploader.destroy(v.image.public_id)
          } catch (err) {
            console.warn('Failed to delete variant image from Cloudinary:', v.image.public_id, err.message)
          }
        }
      })
    )

    // Soft delete the product
    product.isDeleted = true
    await product.save()

    res.json({ message: 'Product deleted and images cleared from Cloudinary' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to delete product' })
  }
}
/* =====================================================
   HARD DELETE PRODUCT (PERMANENT)
===================================================== */
exports.hardDeleteProduct = async (req, res) => {
  try {
    const { id } = req.params
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const product = await Product.findById(id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    // Delete main images from Cloudinary
    if (product.images?.length) {
      await Promise.all(
        product.images.map(async (img) => {
          if (img.public_id) {
            try {
              await cloudinary.uploader.destroy(img.public_id)
            } catch (err) {
              console.warn('Failed to delete image from Cloudinary:', img.public_id, err.message)
            }
          }
        })
      )
    }

    // Delete variant images
    if (product.variants?.length) {
      await Promise.all(
        product.variants.map(async (v) => {
          if (v.image?.public_id) {
            try {
              await cloudinary.uploader.destroy(v.image.public_id)
            } catch (err) {
              console.warn('Failed to delete variant image from Cloudinary:', v.image.public_id, err.message)
            }
          }
        })
      )
    }

    await product.deleteOne() // hard delete
    res.json({ message: 'Product permanently deleted' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to hard delete product' })
  }
}

/* =====================================================
   RESTORE PRODUCT (UNDO SOFT DELETE)
===================================================== */
exports.restoreProduct = async (req, res) => {
  try {
    const { id } = req.params
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const product = await Product.findById(id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    if (!product.isDeleted) {
      return res.status(400).json({ message: 'Product is not deleted' })
    }

    product.isDeleted = false
    await product.save()

    res.json({ message: 'Product restored successfully', product })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to restore product' })
  }
}
// Restore all soft-deleted products
exports.restoreAllProducts = async (req, res) => {
  try {
    const result = await Product.updateMany(
      { isDeleted: true },
      { $set: { isDeleted: false } }
    )

    res.json({
      message: `${result.modifiedCount} product(s) restored`,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to restore products' })
  }
}
// Hard delete all soft-deleted products
exports.hardDeleteAllProducts = async (req, res) => {
  try {
    const products = await Product.find({ isDeleted: true })

    if (!products.length) {
      return res.json({ message: 'No soft-deleted products to remove' })
    }

    // Delete images from Cloudinary
    await Promise.all(
      products.map(async (product) => {
        if (product.images?.length) {
          await Promise.all(
            product.images.map(async (img) => {
              if (img.public_id) {
                try {
                  await cloudinary.uploader.destroy(img.public_id)
                } catch (err) {
                  console.warn('Failed to delete image:', img.public_id, err.message)
                }
              }
            })
          )
        }

        // Delete variant images
        await Promise.all(
          product.variants.map(async (v) => {
            if (v.image?.public_id) {
              try {
                await cloudinary.uploader.destroy(v.image.public_id)
              } catch (err) {
                console.warn('Failed to delete variant image:', v.image.public_id, err.message)
              }
            }
          })
        )
      })
    )

    // Remove products from DB
    const result = await Product.deleteMany({ isDeleted: true })

    res.json({ message: `${result.deletedCount} product(s) permanently deleted` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to hard delete products' })
  }
}
