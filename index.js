require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const helmet = require('helmet')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const cookieParser = require('cookie-parser')
const morgan = require('morgan')
const path = require('path')

const bcrypt = require('bcryptjs')
const User = require('./models/user')

const app = express()

/* ------------------------------------------------
   DATABASE CONNECTION (SERVERLESS SAFE)
------------------------------------------------- */

let isConnected = false

async function connectDB() {
  if (isConnected) return

  const db = await mongoose.connect(process.env.MONGO_URI)

  isConnected = db.connections[0].readyState
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
}

/* ------------------------------------------------
   MIDDLEWARE
------------------------------------------------- */

app.use(express.json({ limit: '10mb' }))
app.use('/invoices', express.static(path.join(__dirname, 'invoices')))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(helmet())

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
  require('./controllers/paymentController').paystackWebHook
)

app.use('/api/auth', require('./routes/authRoutes'))
app.use('/api/users', require('./routes/userRoutes'))
app.use('/api/products', require('./routes/productRoutes'))
app.use('/api/reviews', require('./routes/reviewRoutes'))
app.use('/api/cart', require('./routes/cartRoutes'))
app.use('/api/orders', require('./routes/orderRoutes'))
app.use('/api/wishlist', require('./routes/wishlistRoutes'))
app.use('/api/admin', require('./routes/adminRoutes'))
app.use('/api/payments', require('./routes/paymentRoutes'))

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
  res.status(500).json({ message: 'Server error' })
})

/* ------------------------------------------------
   EXPORT FOR VERCEL
------------------------------------------------- */

module.exports = async (req, res) => {
  await connectDB()
  return app(req, res)
}