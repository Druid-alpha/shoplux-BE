const mongoose = require('mongoose')
const path = require('path')

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

  if (s <= 0.08) {
    if ((h >= 330 || h < 20) && l > 0.35) return 'pink'
    if (h >= 20 && h < 60) return l > 0.35 ? 'beige' : 'brown'
    if (h >= 60 && h < 170) return 'olive'
    if (h >= 170 && h < 250) return 'blue gray'
    return 'gray'
  }

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

const familyFromName = (name) => {
  const n = String(name || '').toLowerCase()
  if (!n) return ''
  if (n.includes('black') || n.includes('onyx') || n.includes('midnight')) return 'black'
  if (n.includes('white') || n.includes('ivory') || n.includes('snow') || n.includes('cream')) return 'white'
  if (n.includes('gray') || n.includes('grey') || n.includes('silver') || n.includes('slate') || n.includes('graphite')) return 'gray'
  if (n.includes('red') || n.includes('crimson') || n.includes('ruby') || n.includes('burgundy') || n.includes('maroon')) return 'red'
  if (n.includes('orange') || n.includes('tangerine') || n.includes('amber') || n.includes('coral')) return 'orange'
  if (n.includes('yellow') || n.includes('gold') || n.includes('lemon')) return 'yellow'
  if (n.includes('green') || n.includes('emerald') || n.includes('mint') || n.includes('jade')) return 'green'
  if (n.includes('blue') || n.includes('navy') || n.includes('azure') || n.includes('sapphire')) return 'blue'
  if (n.includes('purple') || n.includes('violet') || n.includes('indigo') || n.includes('plum')) return 'purple'
  if (n.includes('pink') || n.includes('rose') || n.includes('fuchsia')) return 'pink'
  if (n.includes('brown') || n.includes('tan') || n.includes('beige') || n.includes('camel')) return 'brown'
  if (n.includes('teal') || n.includes('cyan') || n.includes('aqua') || n.includes('turquoise')) return 'teal'
  return ''
}

const main = async () => {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('Missing MONGO_URI')
    process.exit(1)
  }

  await mongoose.connect(uri, { dbName: '' })
  const colors = await Color.find({}).select('_id name hex family').lean()

  const mismatches = []
  const missingHex = []
  const missingName = []

  colors.forEach(c => {
    const nameFamily = familyFromName(c.name)
    const hexFamily = familyFromHex(c.hex)
    if (!c.hex) missingHex.push(c)
    if (!c.name) missingName.push(c)
    if (nameFamily && hexFamily && nameFamily !== hexFamily) {
      mismatches.push({
        _id: String(c._id),
        name: c.name,
        hex: normalizeHex(c.hex || ''),
        nameFamily,
        hexFamily
      })
    }
  })

  console.log(`Total colors: ${colors.length}`)
  console.log(`Missing hex: ${missingHex.length}`)
  console.log(`Missing name: ${missingName.length}`)
  console.log(`Name/hex family mismatches: ${mismatches.length}`)
  if (mismatches.length) {
    console.log('\nTop mismatches:')
    mismatches.slice(0, 30).forEach(m => {
      console.log(`${m._id} | name="${m.name}" (${m.nameFamily}) | hex=${m.hex} (${m.hexFamily})`)
    })
  }

  await mongoose.disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
