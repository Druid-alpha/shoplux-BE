const Wishlist = require('../models/wishlist')
const mongoose = require('mongoose')

exports.getWishList = async (req, res) => {
  try {
    const wishlist = await Wishlist
      .findOne({ user: req.user.id })
      .populate('products')

    res.json({ wishlist: wishlist?.products || [] })
  } catch (err) {
    console.error('getWishList error:', err)
    res.status(500).json({ message: 'Failed to get wishlist' })
  }
}

exports.toggleWishList = async (req, res) => {
  try {
    const { productId } = req.body

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    let wishlist = await Wishlist.findOne({ user: req.user.id })

    if (!wishlist) {
      wishlist = await Wishlist.create({
        user: req.user.id,
        products: [productId]
      })
      return res.json({ wishlist: wishlist.products })
    }

    const exists = wishlist.products.some(
      p => p.toString() === productId
    )

    wishlist.products = exists
      ? wishlist.products.filter(p => p.toString() !== productId)
      : [...wishlist.products, productId]

    await wishlist.save()

    res.json({ wishlist: wishlist.products })
  } catch (err) {
    console.error('toggleWishList error:', err)
    res.status(500).json({ message: 'Failed to toggle wishlist' })
  }
}
