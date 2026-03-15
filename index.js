require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const helmet = require('helmet')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const cookieParser = require('cookie-parser')
const morgan = require('morgan')

const bcrypt = require('bcryptjs')
const User = require('./models/user')
const Category = require('./models/Category')
const Brand = require('./models/Brand')
const { startInvoiceCleanupJob } = require('./src/jobs/invoiceCleanupJob')
const { startOrderReservationCleanupJob } = require('./src/jobs/orderReservationCleanupJob')

const app = express()
const clientOrigin = process.env.CLIENT_URL

/* ------------------------------------------------
   DATABASE CONNECTION
------------------------------------------------- */

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅ MongoDB connected')

    // create admin only once
    const existingAdmin = await User.findOne({
      email: process.env.ADMIN_EMAIL
    })

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(
        process.env.ADMIN_PASSWORD,
        10
      )

      await User.create({
        name: 'Admin',
        email: process.env.ADMIN_EMAIL,
        password: hashedPassword,
        role: 'admin',
        emailVerified: true
      })

      console.log('✅ Default admin created')
    }

    const defaultCategories = ['Grocery']
    for (const name of defaultCategories) {
      const exists = await Category.findOne({ name: new RegExp(`^${name}$`, 'i') })
      if (!exists) {
        await Category.create({ name })
        console.log(`✅ Default category created: ${name}`)
      }
    }

    const groceryCategory = await Category.findOne({ name: /^grocery$/i })
    if (groceryCategory) {
      const groceryBrands = ['Coca Cola', 'Dangote', 'Unilever', 'Nestle', 'Golden Penny']
      for (const name of groceryBrands) {
        const existingBrand = await Brand.findOne({
          name: new RegExp(`^${name}$`, 'i'),
          category: groceryCategory._id
        })
        if (!existingBrand) {
          await Brand.create({ name, category: groceryCategory._id })
          console.log(`✅ Grocery brand created: ${name}`)
        }
      }
    }
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message)
    process.exit(1)
  }
}

/* ------------------------------------------------
   MIDDLEWARE
------------------------------------------------- */

app.set('trust proxy', 1)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.cloudinary.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "https://js.paystack.co", "https://checkout.paystack.com"],
      frameSrc: ["'self'", "https://checkout.paystack.com"],
      connectSrc: [
        "'self'",
        ...(clientOrigin ? [clientOrigin] : []),
        "https://api.paystack.co",
        "https://*.cloudinary.com"
      ]
    }
  }
}))

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}))

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'))
}

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
}))

/* ------------------------------------------------
   ROUTES
------------------------------------------------- */

app.post(
  '/api/payments/paystack/webhook',
  express.raw({ type: 'application/json' }),
  require('./src/controllers/paymentController').paystackWebHook
)

app.use('/api/auth', require('./src/routes/authRoutes'))
app.use('/api/users', require('./src/routes/userRoutes'))
app.use('/api/products', require('./src/routes/productRoutes'))
app.use('/api/reviews', require('./src/routes/reviewRoutes'))
app.use('/api/cart', require('./src/routes/cartRoutes'))
app.use('/api/orders', require('./src/routes/orderRoutes'))
app.use('/api/wishlist', require('./src/routes/wishlistRoutes'))
app.use('/api/admin', require('./src/routes/adminRoutes'))
app.use('/api/payments', require('./src/routes/paymentRoutes'))

/* ------------------------------------------------
   HEALTH
------------------------------------------------- */

app.get('/', (req, res) => res.json({ ok: true }))

/* ------------------------------------------------
   ERROR HANDLER
------------------------------------------------- */

app.use((req, res) => {
  res.status(404).json({ message: 'Not found' })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({
    message: err.message || 'Server error'
  })
})

/* ------------------------------------------------
   LOCAL DEV SERVER (not used on Vercel)
------------------------------------------------- */

const PORT = process.env.PORT || 5000

connectDB().then(() => {
  startInvoiceCleanupJob()
  startOrderReservationCleanupJob()
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
  })
})
