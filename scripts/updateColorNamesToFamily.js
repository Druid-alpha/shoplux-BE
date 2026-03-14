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

const hexToRgb = (hex) => {
  const h = normalizeHex(hex)
  if (!h || h.length !== 7) return null
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16)
  }
}

const rgbToHsl = (r, g, b) => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}

const familyFromHex = (hex) => {
  const rgb = hexToRgb(hex)
  if (!rgb) return ''
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)

  if (l <= 0.08) return 'black'
  if (l >= 0.95) return 'white'
  if (s < 0.12) {
    if (l <= 0.2) return 'black'
    if (l >= 0.9) return 'white'
    if (h >= 30 && h < 70) return l >= 0.5 ? 'beige' : 'brown'
    if (h >= 70 && h < 160) return 'olive'
    if (h >= 160 && h < 250) return 'blue gray'
    return 'gray'
  }

  if (h >= 45 && h < 70 && l < 0.4) return 'olive'
  if ((h >= 330 || h < 15) && l >= 0.6) return 'pink'
  if (h >= 330 || h < 15) return 'red'
  if (h < 45) return 'orange'
  if (h < 70) return 'yellow'
  if (h < 165) return 'green'
  if (h < 200) return 'teal'
  if (h < 255) return 'blue'
  if (h < 290) return 'purple'
  if (h < 330) return 'pink'
  return 'custom color'
}

const titleCase = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : ''

const main = async () => {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('Missing MONGO_URI')
    process.exit(1)
  }

  await mongoose.connect(uri, { dbName: '' })

  const colors = await Color.find({}).select('_id name hex family').lean()
  const updates = []
  const changed = []

  colors.forEach(c => {
    const family = familyFromHex(c.hex)
    if (!family) return
    const desiredName = titleCase(family)
    const desiredFamily = family
    const needsName = c.name !== desiredName
    const needsFamily = c.family !== desiredFamily
    if (needsName || needsFamily) {
      updates.push({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { name: desiredName, family: desiredFamily } }
        }
      })
      changed.push({
        _id: String(c._id),
        fromName: c.name,
        toName: desiredName,
        fromFamily: c.family,
        toFamily: desiredFamily,
        hex: normalizeHex(c.hex || '')
      })
    }
  })

  if (!updates.length) {
    console.log('No updates needed.')
    await mongoose.disconnect()
    return
  }

  const res = await Color.bulkWrite(updates, { ordered: false })
  console.log(`Updated colors: ${res.modifiedCount || 0}`)
  console.log('Sample changes:')
  changed.slice(0, 30).forEach(c => {
    console.log(`${c._id} | ${c.hex} | "${c.fromName}" -> "${c.toName}" | family ${c.fromFamily} -> ${c.toFamily}`)
  })

  await mongoose.disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
