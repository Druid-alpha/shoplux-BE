const jwt = require('jsonwebtoken')
const User = require('../models/user')

module.exports = async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken
    if (!token) {
      return res.status(401).json({ message: 'No access token' })
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)

    // Fetch user from DB to get latest role
    const user = await User.findById(decoded.id).select('id role')
    if (!user) return res.status(401).json({ message: 'User not found' })

    req.user = {
      id: user._id,
      role: user.role.toLowerCase() // ⚡ always lowercase for consistency
    }

    next()
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}
