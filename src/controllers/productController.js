const mongoose = require('mongoose')
const { z } = require('zod')
const cloudinary = require('../config/cloudinary') // adjust the path

const Product = require('../../models/product')
const Brand = require('../../models/Brand')
const Category = require('../../models/Category')
const Color = require('../../models/Color')
const { uploadToCloudinary } = require('../middleware/uploadMiddleware')
const { runOrderReservationCleanupOnce } = require('../jobs/orderReservationCleanupJob')

const findDuplicateSkus = (variants = []) => {
  const counts = new Map()
  variants.forEach(v => {
    const sku = String(v?.sku || '').trim()
    if (!sku) return
    counts.set(sku, (counts.get(sku) || 0) + 1)
  })
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([sku]) => sku)
}
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
    discount: Number(v.discount) || 0,
    stock: Number(v.stock) || 0,
    image: v.image?.url && v.image?.public_id ? v.image : null
  }))

const normalizeHex = (hex) => {
  if (!hex) return ''
  let h = String(hex).trim().toLowerCase()
  if (!h.startsWith('#')) h = `#${h}`
  if (h.length === 4) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  }
  return h
}

const familyFromName = (name) => {
  const n = String(name || '').toLowerCase()
  if (!n) return ''
  if (n.includes('black') || n.includes('onyx') || n.includes('midnight')) return 'black'
  if (n.includes('white') || n.includes('ivory') || n.includes('snow') || n.includes('cream')) return 'white'
  if (n.includes('gray') || n.includes('grey') || n.includes('silver') || n.includes('slate') || n.includes('graphite')) return 'gray'
  if (n.includes('red') || n.includes('crimson') || n.includes('ruby') || n.includes('burgundy') || n.includes('maroon')) return 'red'
  if (n.includes('orange') || n.includes('tangerine') || n.includes('amber') || n.includes('coral')) return 'orange'
  if (n.includes('yellow') || n.includes('gold') || n.includes('lemon')) return 'yellow'
  if (n.includes('green') || n.includes('emerald') || n.includes('mint') || n.includes('jade')) return 'green'
  if (n.includes('blue') || n.includes('navy') || n.includes('azure') || n.includes('sapphire')) return 'blue'
  if (n.includes('purple') || n.includes('violet') || n.includes('indigo') || n.includes('plum')) return 'purple'
  if (n.includes('pink') || n.includes('rose') || n.includes('fuchsia')) return 'pink'
  if (n.includes('brown') || n.includes('tan') || n.includes('beige') || n.includes('camel')) return 'brown'
  if (n.includes('teal') || n.includes('cyan') || n.includes('aqua') || n.includes('turquoise')) return 'teal'
  return ''
}

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

const inferFamily = (color) => {
  if (!color) return ''
  const fromName = familyFromName(color.name)
  if (fromName) return fromName
  return familyFromHex(color.hex)
}

const expandColorIdsByFamily = async (colorIds = []) => {
  if (!colorIds.length) return colorIds
  const colors = await Color.find({ _id: { $in: colorIds } }).select('_id family name hex')
  if (!colors.length) return colorIds

  const families = new Set()
  const updates = []

  colors.forEach(c => {
    const family = c.family || inferFamily(c)
    if (family) families.add(family)
    if (!c.family && family) {
      updates.push({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { family } }
        }
      })
    }
  })

  if (updates.length) {
    await Color.bulkWrite(updates, { ordered: false })
  }

  if (families.size === 0) return colorIds
  const familyColors = await Color.find({ family: { $in: Array.from(families) } }).select('_id')
  const expanded = new Set(colorIds.map(String))
  familyColors.forEach(c => expanded.add(String(c._id)))
  return Array.from(expanded).map(toObjectId)
}

const CLOTHING_TYPES = ['clothes', 'shoes', 'bags', 'bag', 'eyeglass']
const CLOTHES_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46']
const BAG_SIZES = ['Small', 'Medium', 'Large']
const EYEGLASS_SIZES = ['One Size']

const FEATURED_CACHE_TTL_MS = 60 * 1000
let featuredCache = { data: [], updatedAt: 0 }
const invalidateFeaturedCache = () => {
  featuredCache = { data: [], updatedAt: 0 }
}

const LIST_CACHE_TTL_MS = 30 * 1000
const listCache = new Map()
const getListCache = (key) => {
  const entry = listCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > LIST_CACHE_TTL_MS) {
    listCache.delete(key)
    return null
  }
  return entry.data
}
const setListCache = (key, data) => {
  listCache.set(key, { data, updatedAt: Date.now() })
}
const invalidateListCache = () => {
  listCache.clear()
}


const canonicalClothingType = (value) => {
  if (!value) return null
  const v = String(value).toLowerCase()
  return v === 'bag' ? 'bags' : v
}

const clothingTypeFilter = (value) => {
  if (!value) return null
  return value === 'bags' ? { $in: ['bags', 'bag'] } : value
}

const getSizeOptionsByClothingType = (isClothingCategory) => {
  if (!isClothingCategory) {
    return {
      clothes: [],
      shoes: [],
      bags: [],
      eyeglass: []
    }
  }

  return {
    clothes: CLOTHES_SIZES,
    shoes: SHOE_SIZES,
    bags: BAG_SIZES,
    eyeglass: EYEGLASS_SIZES
  }
}

const getSizeOptionsForSelection = (isClothingCategory, clothingType) => {
  if (!isClothingCategory) return []
  if (!clothingType) return CLOTHES_SIZES
  if (clothingType === 'shoes') return SHOE_SIZES
  if (clothingType === 'clothes') return CLOTHES_SIZES
  if (clothingType === 'bags' || clothingType === 'bag') return BAG_SIZES
  if (clothingType === 'eyeglass') return EYEGLASS_SIZES
  return []
}

const sanitizeSizes = (sizes = []) => {
  if (!Array.isArray(sizes)) return []
  return [...new Set(
    sizes
      .map(s => String(s || '').trim())
      .filter(Boolean)
  )]
}

const validateSizesByType = (clothingType, sizes = []) => {
  const normalizedType = canonicalClothingType(clothingType)
  if (!normalizedType || !sizes.length) return true
  const allowed = getSizeOptionsForSelection(true, normalizedType)
  if (!allowed.length) return true
  return sizes.every(s => allowed.includes(String(s)))
}

const parseObjectIdList = (value) => {
  if (!value) return []
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(isValidObjectId)
    .map(toObjectId)
}

const resolveCategory = async (categoryParam) => {
  if (!categoryParam || categoryParam === 'all') return null

  if (isValidObjectId(categoryParam)) {
    return Category.findById(categoryParam).select('_id name')
  }

  return Category.findOne({
    name: new RegExp(`^${categoryParam}$`, 'i')
  }).select('_id name')
}





// Build Mongo query from request safely
const buildQueryFromReq = async (req, { admin = false } = {}) => {
  const q = {}
  if (!admin) q.isDeleted = false
  const andConditions = []

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

  // Category (ID or name)
  const categoryParam = req.query.category
  let category = null
  if (categoryParam && categoryParam !== 'all') {
    if (admin && isValidObjectId(categoryParam)) {
      // Admin filters send category id already; avoid extra category lookup per request.
      category = { _id: toObjectId(categoryParam), name: null }
    } else {
      category = await resolveCategory(categoryParam)
    }
  }
  if (categoryParam && categoryParam !== 'all' && !category) {
    andConditions.push({ _id: { $in: [] } })
  }
  if (category) {
    andConditions.push({ category: category._id })
  }

  // Clothing type (allowed only for clothing category)
  const clothingType =
    req.query.clothingType && req.query.clothingType !== 'all'
      ? canonicalClothingType(req.query.clothingType)
      : null
  const isClothingCategory = category?.name?.toLowerCase() === 'clothing'
  if (clothingType) {
    if (!CLOTHING_TYPES.includes(clothingType)) {
      andConditions.push({ _id: { $in: [] } })
    } else if (!admin && !isClothingCategory) {
      andConditions.push({ _id: { $in: [] } })
    } else {
      andConditions.push({ clothingType: clothingTypeFilter(clothingType) })
    }
  }

  // Brand (supports comma-separated IDs)
  if (req.query.brand && req.query.brand !== 'all') {
    const brandIds = parseObjectIdList(req.query.brand)
    if (brandIds.length > 0) {
      andConditions.push({ brand: { $in: brandIds } })
    } else {
      andConditions.push({ _id: { $in: [] } })
    }
  }

  // Color (supports comma-separated IDs)
  if (req.query.color && req.query.color !== 'all') {
    const colorIds = parseObjectIdList(req.query.color)
    if (colorIds.length > 0) {
      const expandedColorIds = await expandColorIdsByFamily(colorIds)
      andConditions.push({
        $or: [
          { color: { $in: expandedColorIds } },
          { 'variants.options.color': { $in: expandedColorIds } }
        ]
      })
    } else {
      andConditions.push({ _id: { $in: [] } })
    }
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
        {
          variants: { $size: 0 },
          price: priceQuery
        },
        {
          'variants.price': priceQuery
        }
      ]
    })
  }

  // Availability
  if (req.query.availability) {
    const statuses = req.query.availability.split(',')
    const availConditions = []

    if (statuses.includes('in_stock')) {
      availConditions.push({
        $or: [
          { variants: { $size: 0 }, stock: { $gt: 0 } },
          { 'variants.stock': { $gt: 0 } }
        ]
      })
    }

    if (statuses.includes('out_of_stock')) {
      availConditions.push({
        $and: [
          { variants: { $size: 0 }, stock: { $lte: 0 } },
          {
            $or: [
              { variants: { $exists: false } },
              { variants: { $size: 0 } },
              { 'variants.stock': { $lte: 0 } }
            ]
          }
        ]
      })
    }

    if (availConditions.length > 0) {
      if (availConditions.length === 1) {
        andConditions.push(availConditions[0])
      } else {
        andConditions.push({ $or: availConditions })
      }
    }
  }

  // On Sale (discounted items)
  const onSaleRaw = String(req.query.onSale || req.query.sale || '').toLowerCase()
  const onSale = ['1', 'true', 'yes'].includes(onSaleRaw)
  if (onSale) {
    andConditions.push({
      $or: [
        { discount: { $gt: 0 } },
        { 'variants.discount': { $gt: 0 } }
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
  _id: objectId().optional(),
  sku: z.string().min(3),
  options: z.object({
    color: objectId().optional(),
    size: z.string().optional()
  }),
  price: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).optional(),
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
  clothingType: z.enum(['clothes', 'shoes', 'bags', 'eyeglass']).optional(),
  sizes: z.array(z.string()).optional(),
  variants: z.array(variantSchema).optional(),
  images: z.array(z.object({
    url: z.string(),
    public_id: z.string(),
    _id: z.string().optional()
  })).optional()
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


exports.getFilterOptions = async (req, res) => {
  try {
    const categories = await Category.find().select('_id name')

    const category = await resolveCategory(req.query.category)
    const isClothingCategory = category?.name?.toLowerCase() === 'clothing'
    const clothingType = req.query.clothingType && req.query.clothingType !== 'all'
      ? canonicalClothingType(req.query.clothingType)
      : null
    const selectedBrandIds = parseObjectIdList(req.query.brand)
    const selectedColorIds = parseObjectIdList(req.query.color)
    const expandedSelectedColorIds = selectedColorIds.length
      ? await expandColorIdsByFamily(selectedColorIds)
      : []

    const baseFilter = { isDeleted: false }
    if (category) baseFilter.category = category._id
    if (clothingType && isClothingCategory && CLOTHING_TYPES.includes(clothingType)) {
      baseFilter.clothingType = clothingTypeFilter(clothingType)
    }

    if (clothingType && (!isClothingCategory || !CLOTHING_TYPES.includes(clothingType))) {
      return res.json({
        categories,
        brands: [],
        clothingTypes: [],
        sizeOptions: [],
        sizeOptionsByClothingType: {
          clothes: [],
          shoes: [],
          bags: [],
          eyeglass: []
        },
        colors: [],
        availability: [
          { label: 'In Stock', value: 'in_stock' },
          { label: 'Out of Stock', value: 'out_of_stock' }
        ],
        message: 'No products found for the selected filters'
      })
    }

    // Brand facet respects category + clothingType + selected color
    const brandScope = { ...baseFilter }
    if (expandedSelectedColorIds.length) {
      brandScope.$or = [
        { color: { $in: expandedSelectedColorIds } },
        { 'variants.options.color': { $in: expandedSelectedColorIds } }
      ]
    }
    const brandIds = await Product.distinct('brand', brandScope)

    // Color facet respects category + clothingType + selected brand
    const colorScope = { ...baseFilter }
    if (selectedBrandIds.length) {
      colorScope.brand = { $in: selectedBrandIds }
    }
    const [colorIdsFromMain, colorIdsFromVariants] = await Promise.all([
      Product.distinct('color', colorScope),
      Product.distinct('variants.options.color', colorScope)
    ])
    const combinedColorIds = [...new Set([...colorIdsFromMain, ...colorIdsFromVariants])].filter(Boolean)

    const [brands, colors] = await Promise.all([
      Brand.find({ _id: { $in: brandIds }, isActive: true }).select('_id name'),
      Color.find({ _id: { $in: combinedColorIds } }).select('_id name hex')
    ])

    const clothingTypes = isClothingCategory ? ['clothes', 'shoes', 'bags', 'eyeglass'] : []
    const sizeOptionsByClothingType = getSizeOptionsByClothingType(isClothingCategory)
    const sizeOptions = getSizeOptionsForSelection(isClothingCategory, clothingType)
    const availability = [
      { label: 'In Stock', value: 'in_stock' },
      { label: 'Out of Stock', value: 'out_of_stock' }
    ]

    const activeProductFilter = { ...baseFilter }
    if (selectedBrandIds.length) activeProductFilter.brand = { $in: selectedBrandIds }
    if (expandedSelectedColorIds.length) {
      activeProductFilter.$or = [
        { color: { $in: expandedSelectedColorIds } },
        { 'variants.options.color': { $in: expandedSelectedColorIds } }
      ]
    }
    const matchedProducts = await Product.countDocuments(activeProductFilter)

    res.json({
      categories,
      brands,
      clothingTypes,
      sizeOptions,
      sizeOptionsByClothingType,
      colors,
      availability,
      message: matchedProducts === 0 ? 'No products found for the selected filters' : undefined
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to fetch filter options' })
  }
}


/* =====================================================
   LIST PRODUCTS (SHOP)
===================================================== */

exports.listProducts = async (req, res) => {
  try {
    try {
      await runOrderReservationCleanupOnce()
      invalidateListCache()
    } catch (cleanupErr) {
      console.warn('[PRODUCT LIST] Reservation cleanup skipped:', cleanupErr.message)
    }
    const cacheKey = req.originalUrl || req.url
    const cached = getListCache(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    const page = Math.max(1, Number(req.query.page || 1))
    const limit = Math.min(100, Number(req.query.limit || 12))
    let sortByQuery = '-createdAt'
    if (req.query.sortBy) {
      switch (req.query.sortBy) {
        case 'price-asc': sortByQuery = 'price'; break;
        case 'price-desc': sortByQuery = '-price'; break;
        case 'newest': sortByQuery = '-createdAt'; break;
        case 'rating': sortByQuery = '-avgRating'; break;
        default: sortByQuery = '-createdAt';
      }
    }

    const query = await buildQueryFromReq(req)
    console.log('SHOP QUERY:', JSON.stringify(query, null, 2))
    const total = await Product.countDocuments(query)
    const totalPages = Math.max(1, Math.ceil(total / limit))

    if (total === 0) {
      const emptyPayload = {
        products: [],
        total: 0,
        page: 1,
        pages: 1,
        message: 'No products found for the selected filters'
      }
      setListCache(cacheKey, emptyPayload)
      return res.json(emptyPayload)
    }

    const products = await Product.find(query)
      .populate('brand category variants.options.color color')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort(sortByQuery)
    const productsWithStock = products.map(prod => {
      const variantStock = prod.variants?.length
        ? prod.variants.reduce((sum, v) => sum + (v.stock || 0), 0)
        : 0;
      const variantReserved = prod.variants?.length
        ? prod.variants.reduce((sum, v) => sum + (v.reserved || 0), 0)
        : 0;
      const availableVariantStock = prod.variants?.length
        ? prod.variants.reduce((sum, v) => sum + Math.max(0, (v.stock || 0) - (v.reserved || 0)), 0)
        : 0;

      const totalStock = (prod.stock || 0) + variantStock;
      const totalReserved = (prod.reserved || 0) + variantReserved;
      const availableStock = Math.max(0, (prod.stock || 0) - (prod.reserved || 0)) + availableVariantStock;

      return {
        ...prod.toObject(),
        totalStock,
        totalReserved,
        availableStock,
        isOutOfStock: availableStock <= 0
      };
    });

    const payload = {
      products: productsWithStock,
      total,
      page,
      pages: totalPages,
      message: null
    };
    setListCache(cacheKey, payload)
    res.json(payload);
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
    invalidateFeaturedCache()
    invalidateListCache()
    invalidateListCache()

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
    const limit = Math.min(24, Math.max(1, Number(req.query.limit || 12)))
    const now = Date.now()

    // Return warm cache quickly under refresh storms.
    if (featuredCache.data.length > 0 && (now - featuredCache.updatedAt) < FEATURED_CACHE_TTL_MS) {
      return res.json({ products: featuredCache.data.slice(0, limit), cached: true })
    }

    let products = await Product.find({
      isDeleted: false,
      featured: true
    })
      .populate('brand category variants.options.color color')
      .sort({ createdAt: -1 })
      .limit(limit)

    if (!products.length) {
      products = await Product.find({ isDeleted: false })
        .populate('brand category variants.options.color color')
        .sort({ createdAt: -1 })
        .limit(limit)
    }

    if (products.length > 0) {
      featuredCache = {
        data: products,
        updatedAt: Date.now()
      }
    }

    return res.json({ products })
  } catch (err) {
    console.error(err)

    if (featuredCache.data.length > 0) {
      return res.json({ products: featuredCache.data.slice(0, 12), stale: true })
    }

    return res.status(500).json({ message: 'Failed to fetch featured products' })
  }
}

/* =====================================================
   SINGLE PRODUCT
===================================================== */

exports.getProduct = async (req, res) => {
  try {
    try {
      await runOrderReservationCleanupOnce()
    } catch (cleanupErr) {
      console.warn('[PRODUCT] Reservation cleanup skipped:', cleanupErr.message)
    }
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

    // Calculate total stock and reservation info
    const variantStock = product.variants?.length
      ? product.variants.reduce((sum, v) => sum + (v.stock || 0), 0)
      : 0
    const variantReserved = product.variants?.length
      ? product.variants.reduce((sum, v) => sum + (v.reserved || 0), 0)
      : 0
    const availableVariantStock = product.variants?.length
      ? product.variants.reduce((sum, v) => sum + Math.max(0, (v.stock || 0) - (v.reserved || 0)), 0)
      : 0

    const totalStock = (product.stock || 0) + variantStock
    const totalReserved = (product.reserved || 0) + variantReserved
    const availableStock = Math.max(0, (product.stock || 0) - (product.reserved || 0)) + availableVariantStock

    res.json({
      product: {
        ...product.toObject(),
        totalStock,
        totalReserved,
        availableStock,
        isOutOfStock: availableStock <= 0
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
    const [total, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        // Keep admin list fast: return only fields needed by the table.
        .select('_id title price stock reserved featured isDeleted images category brand variants createdAt')
        .populate('brand', 'name')
        .populate('category', 'name')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean()
    ])

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
    const parsedSizes =
      typeof rawPayload.sizes === 'string'
        ? JSON.parse(rawPayload.sizes)
        : rawPayload.sizes || []

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
      sizes: sanitizeSizes(parsedSizes),
      variants: parsedVariants,
    })

    if (!data.variants?.length && data.price === undefined) {
      return res.status(400).json({
        message: 'Price is required when no variants exist'
      })
    }

    if (data.clothingType === 'shoes') {
      if (data.variants?.some(v => v.options?.size && !SHOE_SIZES.includes(String(v.options.size)))) {
        return res.status(400).json({ message: 'Invalid shoe size' })
      }
    }

    if (data.clothingType === 'clothes') {
      if (data.variants?.some(v => v.options?.size && !CLOTHES_SIZES.includes(v.options.size))) {
        return res.status(400).json({ message: 'Invalid clothing size' })
      }
    }
    if (data.clothingType === 'bags') {
      if (data.variants?.some(v => v.options?.size && !BAG_SIZES.includes(String(v.options.size)))) {
        return res.status(400).json({ message: 'Invalid bag size' })
      }
    }
    if (data.clothingType === 'eyeglass') {
      if (data.variants?.some(v => v.options?.size && !EYEGLASS_SIZES.includes(String(v.options.size)))) {
        return res.status(400).json({ message: 'Invalid eyeglass size' })
      }
    }
    if (!validateSizesByType(data.clothingType, data.sizes)) {
      return res.status(400).json({ message: 'Invalid main product sizes' })
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
       VALIDATE BRAND ? CATEGORY
    ======================= */
    if (data.brand) {
      const validBrand = await Brand.findOne({
        _id: data.brand,
        category: data.category,
        isActive: true,
      })

      if (!validBrand) {
        return res.status(400).json({
          message: 'Selected brand does not belong to selected category',
        })
      }
    }
    if (data.variants?.length > 0) {
      const duplicateSkus = findDuplicateSkus(data.variants)
      if (duplicateSkus.length > 0) {
        return res.status(400).json({
          message: `Duplicate variant SKU(s) found: ${duplicateSkus.join(', ')}`
        })
      }
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
      sizes: sanitizeSizes(data.sizes),
      tags: data.tags,
      discount: data.discount,
      isDeleted: false,
      featured: data.featured,
      sku: data.sku || '',
      images,
      variants: normalizeVariants(data.variants),
      avgRating: 0,
      reviewsCount: 0,
      createdBy: req.user.id,
    })
    await product.save()
    invalidateFeaturedCache()
    invalidateListCache()

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


    const rawPayload = req.body.payload
      ? JSON.parse(req.body.payload)
      : req.body

    const parsedSizes =
      typeof rawPayload.sizes === 'string'
        ? JSON.parse(rawPayload.sizes)
        : rawPayload.sizes

    const normalizedTags = rawPayload.tags
      ? Array.isArray(rawPayload.tags)
        ? rawPayload.tags
        : String(rawPayload.tags).split(',').map(t => t.trim())
      : rawPayload.tags

    const payload = {
      ...rawPayload,
      sizes: parsedSizes,
      tags: normalizedTags
    }

    const data = updateSchema.parse(payload)

    // ?? Fetch existing product FIRST
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

    const effectiveClothingType = data.clothingType || existingProduct.clothingType
    if (Array.isArray(payload.variants) && effectiveClothingType === 'shoes') {
      if (payload.variants.some(v => v?.options?.size && !SHOE_SIZES.includes(String(v.options.size)))) {
        return res.status(400).json({ message: 'Invalid shoe size' })
      }
    }
    if (Array.isArray(payload.variants) && effectiveClothingType === 'clothes') {
      if (payload.variants.some(v => v?.options?.size && !CLOTHES_SIZES.includes(String(v.options.size)))) {
        return res.status(400).json({ message: 'Invalid clothing size' })
      }
    }
    if (Array.isArray(payload.variants) && (effectiveClothingType === 'bags' || effectiveClothingType === 'bag')) {
      if (payload.variants.some(v => v?.options?.size && !BAG_SIZES.includes(String(v.options.size)))) {
        return res.status(400).json({ message: 'Invalid bag size' })
      }
    }
    if (Array.isArray(payload.variants) && effectiveClothingType === 'eyeglass') {
      if (payload.variants.some(v => v?.options?.size && !EYEGLASS_SIZES.includes(String(v.options.size)))) {
        return res.status(400).json({ message: 'Invalid eyeglass size' })
      }
    }
    if (data.sizes && !validateSizesByType(effectiveClothingType, data.sizes)) {
      return res.status(400).json({ message: 'Invalid main product sizes' })
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
    if (data.sizes !== undefined) {
      update.$set.sizes = sanitizeSizes(data.sizes)
    }

    /* =======================
       MAIN PRODUCT IMAGES
    ======================= */
    // ?? Improved Image Handling: Keep existing ones unless explicitly removed
    let finalMainImages = []

    // 1. Start with images from payload (the ones frontend wants to keep)
    if (Array.isArray(payload.images)) {
      finalMainImages = payload.images.map(img => ({
        url: img.url,
        public_id: img.public_id
      }))
    } else if (!req.files || req.files.length === 0) {
      // If no new files AND no images array in payload, keep all existing (fallback for simple edits)
      finalMainImages = existingProduct.images || []
    }

    // 2. Identify and delete images that were removed
    const payloadPublicIds = new Set(finalMainImages.map(img => img.public_id))
    const imagesToDelete = (existingProduct.images || []).filter(img => !payloadPublicIds.has(img.public_id))

    if (imagesToDelete.length > 0) {
      await Promise.all(
        imagesToDelete.map(async img => {
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

    // 3. Upload new images and append
    if (Array.isArray(req.files) && req.files.length > 0) {
      const mainImagesFiles = req.files.filter(f => !f.fieldname.startsWith('variant_'))

      for (const file of mainImagesFiles) {
        const uploaded = await uploadToCloudinary(file.buffer, 'products')
        finalMainImages.push({
          url: uploaded.secure_url,
          public_id: uploaded.public_id
        })
      }
    }

    update.$set.images = finalMainImages

    /* =======================
       VARIANTS
    ======================= */
    if (Array.isArray(payload.variants)) {
      const duplicateSkus = findDuplicateSkus(payload.variants)
      if (duplicateSkus.length > 0) {
        return res.status(400).json({
          message: `Duplicate variant SKU(s) found: ${duplicateSkus.join(', ')}`
        })
      }
      const existingVariants = existingProduct.variants || []

      const updatedVariants = await Promise.all(
        payload.variants.map(async (variant, idx) => {
          // ? Match by _id or SKU
          const existing = variant._id
            ? existingVariants.find(v => v._id.toString() === variant._id)
            : existingVariants.find(v => v.sku === variant.sku)

          let image = existing?.image || null

          const file = req.files?.find(f => f.fieldname === `variant_${idx}`)

          if (file) {
            if (image?.public_id) {
              try {
                await cloudinary.uploader.destroy(image.public_id)
              } catch (err) {
                console.warn('Failed to delete variant image:', image.public_id, err.message)
              }
            }

            const uploaded = await uploadToCloudinary(file.buffer, 'variants')
            image = {
              url: uploaded.secure_url,
              public_id: uploaded.public_id
            }
          }

          return {
            ...(existing ? { _id: existing._id } : {}),
            sku: variant.sku,
            options: variant.options,
            price: Number(variant.price),
            discount: Number(variant.discount) || 0,
            stock: Number(variant.stock),
            image
          }
        })
      )

      update.$set.variants = normalizeVariants(updatedVariants)
    }

    const product = await Product.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    )

    await product.save()
    invalidateFeaturedCache()
    invalidateListCache()

    res.json({ product })
  } catch (err) {
    console.error('UPDATE PRODUCT ERROR:', err)
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

    const duplicateSkus = findDuplicateSkus(payload.variants)
    if (duplicateSkus.length > 0) {
      return res.status(400).json({
        message: `Duplicate variant SKU(s) found: ${duplicateSkus.join(', ')}`
      })
    }

    const updatedVariants = await Promise.all(
      payload.variants.map(async (variant, idx) => {
        const existing = product.variants.find(v => v.sku === variant.sku)

        let image = existing?.image || { url: '', public_id: '' }

        const field = `variant_${idx}`
        const file = req.files?.find(f => f.fieldname === field)

        if (file) {
          // ?? delete old variant image
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

    await product.save()
    invalidateFeaturedCache()
    invalidateListCache()

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
    invalidateFeaturedCache()
    invalidateListCache()

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
    invalidateFeaturedCache()
    invalidateListCache()
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
    invalidateFeaturedCache()
    invalidateListCache()

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
    if (result.modifiedCount > 0) {
      invalidateFeaturedCache()
      invalidateListCache()
    }

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
    if (result.deletedCount > 0) {
      invalidateFeaturedCache()
      invalidateListCache()
    }

    res.json({ message: `${result.deletedCount} product(s) permanently deleted` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to hard delete products' })
  }
}





