const mongoose = require('mongoose');
const User = require('../../models/user');
const Product = require('../../models/product');
const Color = require('../../models/Color');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const attachColorMeta = async (cart = []) => {
  const ids = new Set();
  cart.forEach(item => {
    const vColor = item?.variant?.color;
    if (typeof vColor === 'string' && isValidObjectId(vColor)) ids.add(vColor);
    const pColor = item?.product?.color;
    if (typeof pColor === 'string' && isValidObjectId(pColor)) ids.add(pColor);
    const variants = item?.product?.variants || [];
    variants.forEach(v => {
      const c = v?.options?.color;
      if (typeof c === 'string' && isValidObjectId(c)) ids.add(c);
    });
  });

  if (!ids.size) return cart;
  const colors = await Color.find({ _id: { $in: Array.from(ids) } }).select('_id name hex');
  const map = new Map(colors.map(c => [String(c._id), c]));

  cart.forEach(item => {
    if (item?.variant?.color && typeof item.variant.color === 'string') {
      const c = map.get(String(item.variant.color));
      if (c) item.variant.color = c;
    }
    if (item?.product?.color && typeof item.product.color === 'string') {
      const c = map.get(String(item.product.color));
      if (c) item.product.color = c;
    }
    const variants = item?.product?.variants || [];
    variants.forEach(v => {
      if (typeof v?.options?.color === 'string') {
        const c = map.get(String(v.options.color));
        if (c) v.options.color = c;
      }
    });
  });

  return cart;
};

/* ================= GET CART ================= */
exports.getCart = async (req, res) => {
  const user = await User.findById(req.user.id).populate({
    path: 'cart.product',
    populate: [
      { path: 'color' },
      { path: 'variants.options.color' },
      { path: 'category', select: 'name' }
    ]
  });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // ⚡ AUTO-CLEANUP: If any product was hard-deleted, remove it from the cart
  const originalCount = user.cart.length;
  user.cart = user.cart.filter(item => item.product !== null);

  if (user.cart.length !== originalCount) {
    await user.save();
    console.log(`[CART CLEANUP] Removed ${originalCount - user.cart.length} dead items for user ${user._id}`);
  }

  await attachColorMeta(user.cart);
  res.json({ cart: user.cart });
};

/* ================= ADD TO CART ================= */
exports.addToCart = async (req, res) => {
  try {
    const { productId, qty = 1, variant = null } = req.body;
    const variantSku = typeof variant === 'string' ? variant : variant?.sku || null;
    const variantSize = typeof variant === 'object' ? (variant?.size || null) : null;
    const variantColor = typeof variant === 'object' ? (variant?.color || null) : null;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.cart) user.cart = []

    // Pre-cleanup before adding
    user.cart = user.cart.filter(i => i.product != null);

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Compare strictly using strings to avoid duplication
    // We normalize "no variant" to an empty string for comparison
    const idx = user.cart.findIndex(i => {
      const cartProdId = String(i.product);
      const reqProdId = String(productId);

      const cartVariantSku = String(i.variant?.sku || "");
      const reqVariantSku = String(variantSku || "");
      const cartVariantSize = String(i.variant?.size || "");
      const reqVariantSize = String(variantSize || "");
      const cartVariantColor = String(i.variant?.color || "");
      const reqVariantColor = String(variantColor || "");

      if (reqVariantSku) {
        return cartProdId === reqProdId && cartVariantSku === reqVariantSku;
      }
      return cartProdId === reqProdId && cartVariantSize === reqVariantSize && cartVariantColor === reqVariantColor;
    });

    // Resolve stock limit (Variant vs Base)
    let stockLimit = product.stock;
    if (variantSku) {
      const vObj = product.variants.find(v => v.sku === String(variantSku));
      if (vObj) stockLimit = vObj.stock;
    }

    if (idx >= 0) {
      // increment qty safely
      user.cart[idx].qty = Math.min(stockLimit, user.cart[idx].qty + Number(qty));
    } else {
      let variantPayload = {};
      if (variantSku) {
        const vObj = product.variants.find(v => v.sku === String(variantSku));
        variantPayload = {
          sku: String(variantSku),
          size: vObj?.options?.size || variantSize || undefined,
          color: vObj?.options?.color?._id || vObj?.options?.color || variantColor || undefined
        };
      } else if (variantSize || variantColor) {
        variantPayload = {
          size: variantSize || undefined,
          color: variantColor || undefined
        };
      }
      // add new item
      user.cart.push({
        product: productId,
        qty: Math.min(stockLimit, Math.max(1, Number(qty))),
        variant: variantPayload,
        addedAt: new Date()
      });
    }

    await user.save();
    await user.populate({
      path: 'cart.product',
      populate: [
        { path: 'color' },
        { path: 'variants.options.color' },
        { path: 'category', select: 'name' }
      ]
    });

    await attachColorMeta(user.cart);
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
    const variantSku = typeof variant === 'string' ? variant : variant?.sku || null;
    const variantSize = typeof variant === 'object' ? (variant?.size || null) : null;
    const variantColor = typeof variant === 'object' ? (variant?.color || null) : null;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Find cart item strictly
    const idx = user.cart.findIndex(i => {
      const cartProdId = String(i.product);
      const reqProdId = String(productId);
      const cartVariantSku = String(i.variant?.sku || "");
      const reqVariantSku = String(variantSku || "");
      const cartVariantSize = String(i.variant?.size || "");
      const reqVariantSize = String(variantSize || "");
      const cartVariantColor = String(i.variant?.color || "");
      const reqVariantColor = String(variantColor || "");
      if (reqVariantSku) {
        return cartProdId === reqProdId && cartVariantSku === reqVariantSku;
      }
      return cartProdId === reqProdId && cartVariantSize === reqVariantSize && cartVariantColor === reqVariantColor;
    });

    if (idx === -1)
      return res.status(404).json({ message: 'Item not found in cart' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Resolve stock limit
    let stockLimit = product.stock;
    if (variantSku) {
      const vObj = product.variants.find(v => v.sku === String(variantSku));
      if (vObj) stockLimit = vObj.stock;
    }

    user.cart[idx].qty = Math.min(Math.max(1, qty), stockLimit);

    await user.save();
    await user.populate({
      path: 'cart.product',
      populate: [
        { path: 'color' },
        { path: 'variants.options.color' },
        { path: 'category', select: 'name' }
      ]
    });

    await attachColorMeta(user.cart);
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
    const variantSku = typeof variant === 'string' ? variant : variant?.sku || null;
    const variantSize = typeof variant === 'object' ? (variant?.size || null) : null;
    const variantColor = typeof variant === 'object' ? (variant?.color || null) : null;

    // Use a more inclusive pull query to handle both null and empty variant objects
    const variantSkuStr = String(variantSku || "");
    const variantSizeStr = String(variantSize || "");
    const variantColorStr = String(variantColor || "");
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.cart = user.cart.filter(i => {
      const isSameProd = String(i.product) === String(productId);
      const cartVariantSku = String(i.variant?.sku || "");
      const cartVariantSize = String(i.variant?.size || "");
      const cartVariantColor = String(i.variant?.color || "");
      const isSameVariant = variantSkuStr
        ? cartVariantSku === variantSkuStr
        : cartVariantSize === variantSizeStr && cartVariantColor === variantColorStr;
      return !(isSameProd && isSameVariant);
    });

    await user.save();
    await user.populate({
      path: 'cart.product',
      populate: [
        { path: 'color' },
        { path: 'variants.options.color' },
        { path: 'category', select: 'name' }
      ]
    });

    await attachColorMeta(user.cart);
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
/* ================= SYNC GUEST CART ================= */
exports.syncCart = async (req, res) => {
  try {
    const { items = [] } = req.body

    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (!user.cart) user.cart = []

    for (const item of items) {

      const productId = item.product || item.productId
      const qty = Number(item.qty) || 1
      const variantPayload = item.variant || null
      const variantSku = typeof variantPayload === 'string' ? variantPayload : variantPayload?.sku || null
      const variantSize = typeof variantPayload === 'object' ? (variantPayload?.size || null) : null
      const variantColor = typeof variantPayload === 'object' ? (variantPayload?.color || null) : null

      const product = await Product.findById(productId)
      if (!product) continue

      // Check existing item
      const idx = user.cart.findIndex(i => {
        const cartProdId = String(i.product)
        const reqProdId = String(productId)

        const cartVariantSku = String(i.variant?.sku || "")
        const reqVariantSku = String(variantSku || "")
        const cartVariantSize = String(i.variant?.size || "")
        const reqVariantSize = String(variantSize || "")
        const cartVariantColor = String(i.variant?.color || "")
        const reqVariantColor = String(variantColor || "")

        if (reqVariantSku) {
          return cartProdId === reqProdId && cartVariantSku === reqVariantSku
        }
        return cartProdId === reqProdId && cartVariantSize === reqVariantSize && cartVariantColor === reqVariantColor
      })

      // Resolve stock
      let stockLimit = product.stock
      if (variantSku) {
        const vObj = product.variants.find(v => v.sku === String(variantSku))
        if (vObj) stockLimit = vObj.stock
      }

      if (idx >= 0) {
        user.cart[idx].qty = Math.min(
          stockLimit,
          user.cart[idx].qty + qty
        )
      } else {
        let variantPayloadToSave = {}
        if (variantSku) {
          const vObj = product.variants.find(v => v.sku === String(variantSku))
          variantPayloadToSave = {
            sku: String(variantSku),
            size: vObj?.options?.size || variantSize || undefined,
            color: vObj?.options?.color?._id || vObj?.options?.color || variantColor || undefined
          }
        } else if (variantSize || variantColor) {
          variantPayloadToSave = {
            size: variantSize || undefined,
            color: variantColor || undefined
          }
        }
        user.cart.push({
          product: productId,
          qty: Math.min(stockLimit, Math.max(1, qty)),
          variant: variantPayloadToSave,
          addedAt: new Date()
        })
      }
    }

    await user.save()
    await user.populate({
      path: 'cart.product',
      populate: [
        { path: 'color' },
        { path: 'variants.options.color' },
        { path: 'category', select: 'name' }
      ]
    })

    await attachColorMeta(user.cart)
    res.json({ cart: user.cart })

  } catch (error) {
    console.error('Sync cart error:', error)
    res.status(500).json({ message: 'Cart sync failed' })
  }
}

