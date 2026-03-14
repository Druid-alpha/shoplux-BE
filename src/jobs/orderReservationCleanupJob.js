const mongoose = require('mongoose')
const Order = require('../../models/order')
const { releaseOrderReservations } = require('../utils/reservation')

const CLEANUP_INTERVAL_MINUTES = 10

async function runOrderReservationCleanupOnce() {
  const now = new Date()

  const expiredOrders = await Order.find({
    status: 'pending',
    paymentStatus: 'pending',
    expiresAt: { $lt: now },
    $or: [{ paymentRef: { $exists: false } }, { paymentRef: null }, { paymentRef: '' }]
  }).select('_id items')

  if (!expiredOrders.length) {
    console.log('[ORDER RESERVATION] No expired reservations to release.')
    return
  }

  for (const order of expiredOrders) {
    const session = await mongoose.startSession()
    session.startTransaction()
    try {
      await releaseOrderReservations(order, session)
      await Order.updateOne(
        { _id: order._id },
        { $set: { status: 'cancelled', paymentStatus: 'failed' } },
        { session }
      )
      await session.commitTransaction()
    } catch (error) {
      await session.abortTransaction()
      console.error('[ORDER RESERVATION] Release failed:', error.message)
    } finally {
      session.endSession()
    }
  }

  console.log(`[ORDER RESERVATION] Released ${expiredOrders.length} expired reservation(s).`)
}

function startOrderReservationCleanupJob() {
  const intervalMs = CLEANUP_INTERVAL_MINUTES * 60 * 1000

  setTimeout(() => {
    runOrderReservationCleanupOnce().catch((error) => {
      console.error('[ORDER RESERVATION] Initial run failed:', error.message)
    })
  }, 20 * 1000)

  setInterval(() => {
    runOrderReservationCleanupOnce().catch((error) => {
      console.error('[ORDER RESERVATION] Scheduled run failed:', error.message)
    })
  }, intervalMs)

  console.log(`[ORDER RESERVATION] Enabled. Interval=${CLEANUP_INTERVAL_MINUTES} minute(s).`)
}

module.exports = {
  startOrderReservationCleanupJob,
  runOrderReservationCleanupOnce
}
