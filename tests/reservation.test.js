const test = require('node:test')
const assert = require('node:assert/strict')
const { clampReservedToZero, releaseOrderReservations } = require('../src/utils/reservation')

test('reservation utils export functions', () => {
  assert.equal(typeof clampReservedToZero, 'function')
  assert.equal(typeof releaseOrderReservations, 'function')
})
