const Product = require('../../models/product')

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

      await Product.updateOne(
        { _id: productId, ...match },
        { $inc: { 'variants.$.reserved': -item.qty } },
        { session }
      )
      await clampReservedToZero(productId, session)
    } else {
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
