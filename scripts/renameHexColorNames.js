const mongoose = require('mongoose')
const Color = require('../models/Color')

const normalizeHex = (hex) => {
  if (!hex) return ''
  let h = String(hex).trim().toLowerCase()
  if (!h.startsWith('#')) h = `#${h}`
  if (h.length === 4) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  }
  return h
}

const HEX_NAME_MAP = {
  '#000000': 'Midnight Black',
  '#0f172a': 'Midnight',
  '#111111': 'Jet Black',
  '#1f2937': 'Charcoal',
  '#374151': 'Graphite',
  '#6b7280': 'Slate Gray',
  '#9ca3af': 'Steel Gray',
  '#d1d5db': 'Silver',
  '#e5e7eb': 'Cloud',
  '#f5f5f5': 'Soft White',
  '#ffffff': 'Pure White',
  '#ef4444': 'Crimson',
  '#f97316': 'Tangerine',
  '#f59e0b': 'Amber',
  '#facc15': 'Gold',
  '#22c55e': 'Emerald',
  '#14b8a6': 'Teal',
  '#3b82f6': 'Royal Blue',
  '#6366f1': 'Indigo',
  '#8b5cf6': 'Violet',
  '#ec4899': 'Rose',
  '#efeae6': 'Pearl White',
  '#656b83': 'Slate Blue'
}

const isHexLike = (value) => /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(value || ''))

const familyFromHex = (hex) => {
  const h = normalizeHex(hex)
  if (!h) return ''
  const r = parseInt(h.slice(1, 3), 16)
  const g = parseInt(h.slice(3, 5), 16)
  const b = parseInt(h.slice(5, 7), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max < 40) return 'black'
  if (min > 220) return 'white'
  if (max - min < 20) return 'gray'
  if (r >= g && r >= b) {
    if (g > 160) return 'orange'
    if (g > 120) return 'orange'
    return 'red'
  }
  if (g >= r && g >= b) {
    if (b > 140) return 'teal'
    return 'green'
  }
  if (b >= r && b >= g) {
    if (r > 140) return 'purple'
    return 'blue'
  }
  return ''
}

const titleCase = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : ''

const run = async () => {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('MONGO_URI is not set')
    process.exit(1)
  }

  await mongoose.connect(uri)
  const colors = await Color.find({
    $or: [
      { name: { $regex: /^#/ } },
      { name: { $regex: /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/ } }
    ]
  }).select('_id name hex category')

  if (!colors.length) {
    console.log('No hex-named colors to update')
    await mongoose.disconnect()
    return
  }

  const updates = []
  for (const c of colors) {
    const hex = normalizeHex(c.name || c.hex)
    const mapped = HEX_NAME_MAP[hex] || titleCase(familyFromHex(hex))
    if (!mapped) continue
    const suffix = hex ? ` ${hex.slice(1, 5).toUpperCase()}` : ''
    let nextName = mapped
    const exists = await Color.findOne({
      _id: { $ne: c._id },
      category: c.category,
      name: nextName
    }).select('_id')
    if (exists) {
      nextName = `${mapped}${suffix}`.trim()
    }
    updates.push({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { name: nextName } }
      }
    })
  }

  if (updates.length) {
    const res = await Color.bulkWrite(updates, { ordered: false })
    console.log(`Updated ${res.modifiedCount || 0} colors`)
  } else {
    console.log('No hex colors matched in map')
  }

  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
