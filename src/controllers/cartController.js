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
  try {
    const { productId, qty = 1, variant = null } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Compare strictly using strings to avoid duplication
    const idx = user.cart.findIndex(i => {
      const cartProdId = String(i.product);
      const reqProdId = String(productId);

      const cartVariantSku = String(i.variant?.sku || "");
      const reqVariantSku = String(variant || "");

      return cartProdId === reqProdId && cartVariantSku === reqVariantSku;
    });

    // Resolve stock limit (Variant vs Base)
    let stockLimit = product.stock;
    if (variant) {
      const vObj = product.variants.find(v => v.sku === String(variant));
      if (vObj) stockLimit = vObj.stock;
    }

    if (idx >= 0) {
      // increment qty safely
      user.cart[idx].qty = Math.min(stockLimit, user.cart[idx].qty + Number(qty));
    } else {
      // add new item
      user.cart.push({
        product: productId,
        qty: Math.min(stockLimit, Math.max(1, Number(qty))),
        variant: variant ? { sku: String(variant) } : {}
      });
    }

    await user.save();
    await user.populate('cart.product');

    res.json({ cart: user.cart });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/* ================= UPDATE ITEM ================= */
exports.updateItem = async (req, res) => {
  try {
    const { productId, qty, variant = null } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Find cart item strictly
    const idx = user.cart.findIndex(i => {
      const cartProdId = String(i.product);
      const reqProdId = String(productId);
      const cartVariantSku = String(i.variant?.sku || "");
      const reqVariantSku = String(variant || "");
      return cartProdId === reqProdId && cartVariantSku === reqVariantSku;
    });

    if (idx === -1)
      return res.status(404).json({ message: 'Item not found in cart' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Resolve stock limit
    let stockLimit = product.stock;
    if (variant) {
      const vObj = product.variants.find(v => v.sku === String(variant));
      if (vObj) stockLimit = vObj.stock;
    }

    user.cart[idx].qty = Math.min(Math.max(1, qty), stockLimit);

    await user.save();
    await user.populate('cart.product');

    res.json({ cart: user.cart });
  } catch (error) {
    console.error('Update cart item error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/* ================= REMOVE ITEM ================= */
exports.removeItem = async (req, res) => {
  try {
    const { productId, variant = null } = req.body;

    const pullQuery = variant
      ? { product: productId, 'variant.sku': String(variant) }
      : { product: productId, $or: [{ 'variant.sku': null }, { 'variant.sku': '' }] };

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
