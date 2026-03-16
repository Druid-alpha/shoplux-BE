const mongoose = require('mongoose')
const Product = require('../../models/product')
const Color = require('../../models/Color')

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value)

const resolveColorId = async (raw) => {
  if (!raw) return null
  if (typeof raw === 'object') {
    if (raw._id && isValidObjectId(raw._id)) return String(raw._id)
    if (raw.id && isValidObjectId(raw.id)) return String(raw.id)
    if (raw.name || raw.hex) raw = raw.name || raw.hex
  }
  const str = String(raw || '').trim()
  if (!str) return null
  if (isValidObjectId(str)) return str
  const found = await Color.findOne({
    $or: [
      { name: new RegExp(`^${str}$`, 'i') },
      { hex: new RegExp(`^${str}$`, 'i') }
    ]
  }).select('_id').lean()
  return found?._id ? String(found._id) : null
}

async function clampReservedToZero(productId, session) {
  await Product.updateOne(
    { _id: productId, reserved: { $lt: 0 } },
    { $set: { reserved: 0 } },
    { session }
  )

  await Product.updateOne(
    { _id: productId, 'variants.reserved': { $lt: 0 } },
    { $set: { 'variants.$[v].reserved': 0 } },
    { arrayFilters: [{ 'v.reserved': { $lt: 0 } }], session }
  )
}

async function releaseOrderReservations(order, session) {
  if (!order?.items?.length) return

  for (const item of order.items) {
    const productId = item.product
    if (!productId) continue

    if (item.variant?._id || item.variant?.sku) {
      const match = item.variant?._id
        ? { 'variants._id': item.variant._id }
        : { 'variants.sku': item.variant.sku }

      const result = await Product.updateOne(
        { _id: productId, ...match },
        { $inc: { 'variants.$.reserved': -item.qty } },
        { session }
      )
      if (result.modifiedCount === 0) {
        await Product.updateOne(
          { _id: productId },
          { $inc: { reserved: -item.qty } },
          { session }
        )
      }
      await clampReservedToZero(productId, session)
    } else {
      const sizeKey = String(item.variant?.size || '').trim()
      const colorId = await resolveColorId(item.variant?.color)
      if (sizeKey || colorId) {
        const product = await Product.findById(productId).select('reserved variants').lean()
        if (product?.variants?.length) {
          const match = product.variants.find(v => {
            const vSize = String(v?.options?.size || '').trim()
            const vColor = String(v?.options?.color || '')
            if (colorId && sizeKey) return vSize === sizeKey && vColor === colorId
            if (colorId) return vColor === colorId
            if (sizeKey) return vSize === sizeKey && !vColor
            return false
          })
          if (match?._id && Number(match?.reserved || 0) >= item.qty) {
            await Product.updateOne(
              { _id: productId, 'variants._id': match._id },
              { $inc: { 'variants.$.reserved': -item.qty } },
              { session }
            )
            await clampReservedToZero(productId, session)
            continue
          }
        }
      }
      await Product.updateOne(
        { _id: productId },
        { $inc: { reserved: -item.qty } },
        { session }
      )
      await clampReservedToZero(productId, session)
    }
  }
}

module.exports = {
  clampReservedToZero,
  releaseOrderReservations
}
