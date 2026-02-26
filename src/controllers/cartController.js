const mongoose = require('mongoose');
const User = require('../models/user');
const Product = require('../models/product');

/* ================= GET CART ================= */
exports.getCart = async (req, res) => {
  const user = await User.findById(req.user.id).populate('cart.product');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ cart: user.cart });
};

/* ================= ADD TO CART ================= */
exports.addToCart = async (req, res) => {
  const { productId, qty = 1, variant = null } = req.body;

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ message: 'Product not found' });

  // Compare using SKU
  const idx = user.cart.findIndex(i => {
    const cartVariantSku = i.variant?.sku ?? null;
    const reqVariantSku = variant ?? null;
    return i.product.toString() === productId && cartVariantSku === reqVariantSku;
  });

  if (idx >= 0) {
    // increment qty safely
    user.cart[idx].qty = Math.min(product.stock, user.cart[idx].qty + Number(qty));
  } else {
    // add new item
    user.cart.push({
      product: productId,
      qty: Math.max(1, Number(qty)),
      variant: variant ? { sku: variant } : null
    });
  }

  await user.save();
  await user.populate('cart.product');

  res.json({ cart: user.cart });
};

/* ================= UPDATE ITEM ================= */
exports.updateItem = async (req, res) => {
  const { productId, qty, variant = null } = req.body;

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Find cart item by productId + variant SKU
  const idx = user.cart.findIndex(i => {
    const cartVariantSku = i.variant?.sku ?? null;
    const reqVariantSku = variant ?? null;
    return i.product.toString() === productId && cartVariantSku === reqVariantSku;
  });

  if (idx === -1)
    return res.status(404).json({ message: 'Item not found in cart' });

  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ message: 'Product not found' });

  user.cart[idx].qty = Math.min(Math.max(1, qty), product.stock);

  await user.save();
  await user.populate('cart.product');

  res.json({ cart: user.cart });
};

/* ================= REMOVE ITEM ================= */
exports.removeItem = async (req, res) => {
  try {
    const { productId, variant = null } = req.body;

    const pullQuery = variant ? { product: productId, 'variant.sku': variant } : { product: productId };

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { cart: pullQuery } },
      { new: true }
    ).populate('cart.product');

    res.json({ cart: user.cart });
  } catch (error) {
    console.error('🔥 SERVER ERROR:', error);
    res.status(500).json({ message: 'Remove cart item failed' });
  }
};

/* ================= CLEAR CART ================= */
exports.clearCart = async (req, res) => {
  const user = await User.findById(req.user.id);
  user.cart = [];
  await user.save();
  res.json({ cart: [] });
};
