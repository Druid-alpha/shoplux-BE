const User = require('../models/user')
const { z } = require('zod')
const { uploadToCloudinary } = require('../middleware/uploadMiddleware')

/* -----------------------------
   USER PROFILE CONTROLLERS
------------------------------*/

// Get logged-in user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -refreshTokens')
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ user })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
}

// Update logged-in user profile (name only)
exports.updateProfile = async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(2)
    })
    const data = schema.parse(req.body)

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name: data.name },
      { new: true, runValidators: true }
    ).select('-password -refreshTokens')

    res.json({ message: 'Profile updated', user })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'Server error' })
  }
}

// Update logged-in user avatar
exports.updateAvatar = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer)
      return res.status(400).json({ message: 'No file uploaded' })

    const result = await uploadToCloudinary(req.file.buffer, 'avatars')

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: result.secure_url },
      { new: true }
    ).select('-password -refreshTokens')

    res.json({ message: 'Avatar updated', user })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Failed to upload avatar' })
  }
}

/* -----------------------------
   ADMIN CONTROLLERS
------------------------------*/

// Get all users (admin only)
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ isDeleted: { $ne: true } }).select('-password -refreshTokens')
    res.json({ users })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
}

// Update user (admin only)
exports.adminUpdateUser = async (req, res) => {
  try {
    const { name, email, role } = req.body

    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' })
    }

    const updates = {}
    if (name) updates.name = name
    if (email) updates.email = email
    if (role) updates.role = role

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password -refreshTokens')

    if (!user) return res.status(404).json({ message: 'User not found' })

    res.json({ message: 'User updated successfully', user })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Update failed' })
  }
}

// Soft-delete user (admin only)
exports.adminDeleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true },
      { new: true }
    ).select('-password -refreshTokens')

    if (!user) return res.status(404).json({ message: 'User not found' })

    res.json({ message: 'User deleted', user })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Delete failed' })
  }
}
