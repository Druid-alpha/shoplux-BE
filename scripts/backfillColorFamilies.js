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

const inferFamily = (color) => {
  if (!color) return ''
  const fromName = familyFromName(color.name)
  if (fromName) return fromName
  return familyFromHex(color.hex)
}

const run = async () => {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('MONGO_URI is not set')
    process.exit(1)
  }

  await mongoose.connect(uri)
  const colors = await Color.find({ $or: [{ family: { $exists: false } }, { family: '' }, { family: null }] })
    .select('_id name hex family')

  if (!colors.length) {
    console.log('No colors to update')
    await mongoose.disconnect()
    return
  }

  const updates = []
  colors.forEach(c => {
    const family = inferFamily(c)
    if (family) {
      updates.push({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { family } }
        }
      })
    }
  })

  if (updates.length) {
    const res = await Color.bulkWrite(updates, { ordered: false })
    console.log(`Updated ${res.modifiedCount || 0} colors`)
  } else {
    console.log('No colors matched for update')
  }

  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
