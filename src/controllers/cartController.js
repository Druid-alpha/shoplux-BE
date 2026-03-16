const mongoose = require('mongoose');
const User = require('../../models/user');
const Product = require('../../models/product');
const Color = require('../../models/Color');
const { runOrderReservationCleanupOnce } = require('../jobs/orderReservationCleanupJob')

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const colorKey = (value) => {
  if (!value) return "";
  if (typeof value === "object") {
    return String(value._id || value.name || value.hex || "");
  }
  return String(value);
};

const normalizeVariant = (variant) => {
  if (!variant) return { _id: "", sku: "", size: "", color: "", empty: true };
  if (typeof variant === "string") {
    const sku = String(variant || "");
    return { _id: "", sku, size: "", color: "", empty: !sku };
  }
  if (typeof variant === "object") {
    const rawId = variant._id || variant.id || "";
    const _id = rawId ? String(rawId) : "";
    const sku = String(variant.sku || "");
    const size = String(variant.size || "");
    const color = colorKey(variant.color);
    const empty = !(_id || sku || size || color);
    return { _id, sku, size, color, empty };
  }
  return { _id: "", sku: "", size: "", color: "", empty: true };
};

const resolveColorId = async (raw) => {
  if (!raw) return ''
  if (typeof raw === 'object') {
    if (raw._id && isValidObjectId(raw._id)) return String(raw._id)
    if (raw.id && isValidObjectId(raw.id)) return String(raw.id)
    if (raw.name || raw.hex) raw = raw.name || raw.hex
  }
  const str = String(raw || '').trim()
  if (!str) return ''
  if (isValidObjectId(str)) return str
  const found = await Color.findOne({
    $or: [
      { name: new RegExp(`^${str}$`, 'i') },
      { hex: new RegExp(`^${str}$`, 'i') }
    ]
  }).select('_id').lean()
  return found?._id ? String(found._id) : ''
}

const findVariantsByOptions = async (product, size, color) => {
  if (!product?.variants?.length) return []
  const sizeKey = String(size || '').trim()
  const colorKey = await resolveColorId(color)
  return product.variants.filter(v => {
    const vSize = String(v?.options?.size || '').trim()
    const vColor = String(v?.options?.color?._id || v?.options?.color || '')
    const sizeMatch = sizeKey ? vSize === sizeKey : true
    const colorMatch = colorKey ? vColor === colorKey : true
    return sizeMatch && colorMatch
  })
}

const resolveVariantForInput = async (product, variantInput = {}) => {
  if (!product?.variants?.length) return null
  const input = typeof variantInput === 'object' ? variantInput : {}
  const sku = typeof variantInput === 'string' ? variantInput : (input.sku || null)
  const id = typeof variantInput === 'object' ? input._id || null : null
  const size = typeof variantInput === 'object' ? input.size || null : null
  const color = typeof variantInput === 'object' ? input.color || null : null

  if (id) {
    const match = product.variants.find(v => String(v._id) === String(id))
    return match || null
  }

  if (sku) {
    const matches = product.variants.filter(v => v.sku === String(sku))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1 && (size || color)) {
      const refined = matches.filter(v => {
        const vSize = String(v?.options?.size || '').trim()
        const vColor = String(v?.options?.color?._id || v?.options?.color || '')
        const sizeKey = String(size || '').trim()
        const colorKey = String(color || '')
        const sizeMatch = sizeKey ? vSize === sizeKey : true
        const colorMatch = colorKey ? vColor === colorKey : true
        return sizeMatch && colorMatch
      })
      if (refined.length === 1) return refined[0]
    }
    return null
  }

  if (size || color) {
    const matches = await findVariantsByOptions(product, size, color)
    if (matches.length === 1) return matches[0]
  }
  return null
}

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
  try {
    await runOrderReservationCleanupOnce()
  } catch (cleanupErr) {
    console.warn('[CART] Reservation cleanup skipped:', cleanupErr.message)
  }
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
  // Normalize cart variant payloads to include _id/sku/size/color when possible.
  let cartUpdated = false
  for (const item of user.cart) {
    const product = item?.product
    if (!product || !product.variants?.length) continue
    if (!item.variant) continue
    const resolved = await resolveVariantForInput(product, item.variant)
    if (resolved?._id) {
      const nextVariant = {
        _id: resolved._id,
        sku: resolved.sku || item.variant?.sku || undefined,
        size: resolved.options?.size || item.variant?.size || undefined,
        color: resolved.options?.color?._id || resolved.options?.color || item.variant?.color || undefined
      }
      const changed = JSON.stringify(item.variant) !== JSON.stringify(nextVariant)
      if (changed) {
        item.variant = nextVariant
        cartUpdated = true
      }
    }
  }
  if (cartUpdated) {
    await user.save()
  }
  user.cart.forEach(item => {
    const product = item?.product;
    if (!product) return;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const baseStock = Number(product.stock || 0);
    const baseReserved = Number(product.reserved || 0);
    const variantStock = variants.reduce((sum, v) => sum + Number(v?.stock || 0), 0);
    const variantReserved = variants.reduce((sum, v) => sum + Number(v?.reserved || 0), 0);
    product.totalStock = baseStock + variantStock;
    product.totalReserved = baseReserved + variantReserved;
    product.availableStock = Math.max(0, product.totalStock - product.totalReserved);
  });
  res.json({ cart: user.cart });
};

/* ================= ADD TO CART ================= */
exports.addToCart = async (req, res) => {
  try {
    const { productId, qty = 1, variant = null } = req.body;
    const reqVariant = normalizeVariant(variant);
    let variantId = reqVariant._id || null;
    let variantSku = reqVariant.sku || null;
    const variantSize = reqVariant.size || null;
    const variantColor = reqVariant.color || null;

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

      const cartVariant = normalizeVariant(i.variant);
      if (reqVariant._id) {
        return cartProdId === reqProdId && cartVariant._id === reqVariant._id;
      }
      if (reqVariant.sku) {
        return cartProdId === reqProdId && cartVariant.sku === reqVariant.sku;
      }
      const isReqEmpty = !reqVariant.size && !reqVariant.color;
      const isCartColorOnly = !cartVariant.sku && !cartVariant.size && !!cartVariant.color;
      if (isReqEmpty && isCartColorOnly) return cartProdId === reqProdId;
      return cartProdId === reqProdId && cartVariant.size === reqVariant.size && cartVariant.color === reqVariant.color;
    });

    // Resolve stock limit (Variant vs Base)
    let stockLimit = product.stock;
    let vObj = null;
    if (variantId) {
      vObj = product.variants.find(v => String(v._id) === String(variantId));
    }
    if (!vObj && variantSku) {
      vObj = product.variants.find(v => v.sku === String(variantSku));
    }
    if (!vObj && (variantId || variantSku || variantSize || variantColor) && product.variants?.length) {
      vObj = await resolveVariantForInput(product, {
        ...(variantId ? { _id: variantId } : {}),
        ...(variantSku ? { sku: variantSku } : {}),
        ...(variantSize ? { size: variantSize } : {}),
        ...(variantColor ? { color: variantColor } : {})
      })
      if (vObj) {
        variantId = vObj._id || variantId
        variantSku = vObj.sku || variantSku
      } else {
        return res.status(400).json({ message: 'Variant not found' })
      }
    }
    if (vObj) stockLimit = vObj.stock;

    if (idx >= 0) {
      // increment qty safely
      user.cart[idx].qty = Math.min(stockLimit, user.cart[idx].qty + Number(qty));
    } else {
      let variantPayload = null;
      if (variantSku || variantId) {
        if (!vObj) {
          vObj = variantId
            ? product.variants.find(v => String(v._id) === String(variantId))
            : product.variants.find(v => v.sku === String(variantSku));
        }
        variantPayload = {
          _id: vObj?._id || variantId || undefined,
          sku: vObj?.sku || variantSku || undefined,
          size: vObj?.options?.size || variantSize || undefined,
          color: vObj?.options?.color?._id || vObj?.options?.color || variantColor || undefined
        };
      } else if (variantSize || variantColor) {
        const resolved = vObj || findVariantByOptions(product, variantSize, variantColor)
        if (resolved) {
          variantPayload = {
            _id: resolved._id || undefined,
            sku: resolved.sku || undefined,
            size: resolved.options?.size || variantSize || undefined,
            color: resolved.options?.color?._id || resolved.options?.color || variantColor || undefined
          }
        } else {
          variantPayload = {
            size: variantSize || undefined,
            color: variantColor || undefined
          }
        }
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
    const reqVariant = normalizeVariant(variant);
    let variantId = reqVariant._id || null;
    let variantSku = reqVariant.sku || null;
    const variantSize = reqVariant.size || null;
    const variantColor = reqVariant.color || null;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Find cart item strictly
    const idx = user.cart.findIndex(i => {
      const cartProdId = String(i.product);
      const reqProdId = String(productId);
      const cartVariant = normalizeVariant(i.variant);
      if (reqVariant._id) {
        return cartProdId === reqProdId && cartVariant._id === reqVariant._id;
      }
      if (reqVariant.sku) {
        return cartProdId === reqProdId && cartVariant.sku === reqVariant.sku;
      }
      const isReqEmpty = !reqVariant.size && !reqVariant.color;
      const isCartColorOnly = !cartVariant.sku && !cartVariant.size && !!cartVariant.color;
      if (isReqEmpty && isCartColorOnly) return cartProdId === reqProdId;
      return cartProdId === reqProdId && cartVariant.size === reqVariant.size && cartVariant.color === reqVariant.color;
    });

    if (idx === -1)
      return res.status(404).json({ message: 'Item not found in cart' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Resolve stock limit
    let stockLimit = product.stock;
    let vObj = null;
    if (variantId) {
      vObj = product.variants.find(v => String(v._id) === String(variantId));
    }
    if (!vObj && variantSku) {
      vObj = product.variants.find(v => v.sku === String(variantSku));
    }
    if (!vObj && (variantId || variantSku || variantSize || variantColor) && product.variants?.length) {
      vObj = await resolveVariantForInput(product, {
        ...(variantId ? { _id: variantId } : {}),
        ...(variantSku ? { sku: variantSku } : {}),
        ...(variantSize ? { size: variantSize } : {}),
        ...(variantColor ? { color: variantColor } : {})
      })
      if (vObj) {
        variantId = vObj._id || variantId
        variantSku = vObj.sku || variantSku
      } else {
        return res.status(400).json({ message: 'Variant not found' })
      }
    }
    if (vObj) stockLimit = vObj.stock;

    user.cart[idx].qty = Math.min(Math.max(1, qty), stockLimit);
    if ((variantSize || variantColor) && vObj) {
      user.cart[idx].variant = {
        _id: vObj._id || variantId || undefined,
        sku: vObj.sku || variantSku || undefined,
        size: vObj.options?.size || variantSize || undefined,
        color: vObj.options?.color?._id || vObj.options?.color || variantColor || undefined
      }
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
    console.error('Update cart item error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/* ================= REMOVE ITEM ================= */
exports.removeItem = async (req, res) => {
  try {
    const { productId, variant = null } = req.body;
    const reqVariant = normalizeVariant(variant);
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.cart = user.cart.filter(i => {
      const isSameProd = String(i.product) === String(productId);
      const cartVariant = normalizeVariant(i.variant);
      const isReqEmpty = !reqVariant._id && !reqVariant.sku && !reqVariant.size && !reqVariant.color;
      const isCartColorOnly = !cartVariant.sku && !cartVariant.size && !!cartVariant.color;
      const isSameVariant = reqVariant._id
        ? cartVariant._id === reqVariant._id
        : reqVariant.sku
        ? cartVariant.sku === reqVariant.sku
        : (isReqEmpty && isCartColorOnly)
          ? true
          : (cartVariant.size === reqVariant.size && cartVariant.color === reqVariant.color);
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
      const reqVariant = normalizeVariant(variantPayload)
      let variantId = reqVariant._id || null
      let variantSku = reqVariant.sku || null
      const variantSize = reqVariant.size || null
      const variantColor = reqVariant.color || null

      const product = await Product.findById(productId)
      if (!product) continue

      // Check existing item
      const idx = user.cart.findIndex(i => {
        const cartProdId = String(i.product)
        const reqProdId = String(productId)
        const cartVariant = normalizeVariant(i.variant)
        if (reqVariant._id) {
          return cartProdId === reqProdId && cartVariant._id === reqVariant._id
        }
        if (reqVariant.sku) {
          return cartProdId === reqProdId && cartVariant.sku === reqVariant.sku
        }
        const isReqEmpty = !reqVariant.size && !reqVariant.color
        const isCartColorOnly = !cartVariant.sku && !cartVariant.size && !!cartVariant.color
        if (isReqEmpty && isCartColorOnly) return cartProdId === reqProdId
        return cartProdId === reqProdId && cartVariant.size === reqVariant.size && cartVariant.color === reqVariant.color
      })

      // Resolve stock
      let stockLimit = product.stock
      let vObj = null
      if (variantId) {
        vObj = product.variants.find(v => String(v._id) === String(variantId))
      }
      if (!vObj && variantSku) {
        vObj = product.variants.find(v => v.sku === String(variantSku))
      }
      if (!vObj && (variantId || variantSku || variantSize || variantColor) && product.variants?.length) {
        vObj = await resolveVariantForInput(product, {
          ...(variantId ? { _id: variantId } : {}),
          ...(variantSku ? { sku: variantSku } : {}),
          ...(variantSize ? { size: variantSize } : {}),
          ...(variantColor ? { color: variantColor } : {})
        })
        if (vObj) {
          variantId = vObj._id || variantId
          variantSku = vObj.sku || variantSku
        } else {
          return res.status(400).json({ message: 'Variant not found' })
        }
      }
      if (vObj) stockLimit = vObj.stock

      if (idx >= 0) {
        user.cart[idx].qty = Math.min(
          stockLimit,
          user.cart[idx].qty + qty
        )
      } else {
        let variantPayloadToSave = null
        if (variantSku || variantId) {
          if (!vObj) {
            vObj = variantId
              ? product.variants.find(v => String(v._id) === String(variantId))
              : product.variants.find(v => v.sku === String(variantSku))
          }
          variantPayloadToSave = {
            _id: vObj?._id || variantId || undefined,
            sku: vObj?.sku || variantSku || undefined,
            size: vObj?.options?.size || variantSize || undefined,
            color: vObj?.options?.color?._id || vObj?.options?.color || variantColor || undefined
          }
        } else if (variantSize || variantColor) {
          const resolved = vObj || findVariantByOptions(product, variantSize, variantColor)
          if (resolved) {
            variantPayloadToSave = {
              _id: resolved._id || undefined,
              sku: resolved.sku || undefined,
              size: resolved.options?.size || variantSize || undefined,
              color: resolved.options?.color?._id || resolved.options?.color || variantColor || undefined
            }
          } else {
            variantPayloadToSave = {
              size: variantSize || undefined,
              color: variantColor || undefined
            }
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

