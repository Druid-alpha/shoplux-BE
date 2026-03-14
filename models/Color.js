const mongoose = require('mongoose')
const { Schema } = mongoose

const colorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    hex: { type: String, required: true },
    family: { type: String, default: '', index: true },

    // 👇 REQUIRED for Clothing-only colors
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true
    }
  },
  { timestamps: true }
)

// Prevent duplicate colors per category by hex
colorSchema.index({ hex: 1, category: 1 }, { unique: true })

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
  const h = normalizeHex(hex)
  if (!h) return ''
  const r = parseInt(h.slice(1, 3), 16)
  const g = parseInt(h.slice(3, 5), 16)
  const b = parseInt(h.slice(5, 7), 16)
  const { h: hue, s, l } = rgbToHsl(r, g, b)

  if (l <= 0.08) return 'black'
  if (l >= 0.95) return 'white'

  if (s < 0.12) {
    if (l <= 0.2) return 'black'
    if (l >= 0.9) return 'white'
    if (hue >= 30 && hue < 70) return l >= 0.5 ? 'beige' : 'brown'
    if (hue >= 70 && hue < 160) return 'olive'
    if (hue >= 160 && hue < 250) return 'blue gray'
    return 'gray'
  }

  if ((hue >= 330 || hue < 15) && l >= 0.7) return 'pink'
  if (hue >= 330 || hue < 15) return 'red'
  if (hue < 45) return 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 165) return 'green'
  if (hue < 200) return 'teal'
  if (hue < 255) return 'blue'
  if (hue < 290) return 'purple'
  if (hue < 330) return 'pink'
  return ''
}

const titleCase = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : ''

colorSchema.pre('save', function (next) {
  if (this.name && (this.name.startsWith('#') || isHexLike(this.name))) {
    const hex = normalizeHex(this.name)
    const mapped = HEX_NAME_MAP[hex]
    const family = familyFromHex(hex)
    this.name = mapped || titleCase(family) || this.name
  }
  if (!this.family) {
    const fromName = familyFromName(this.name)
    const fromHex = familyFromHex(this.hex)
    this.family = fromName || fromHex || ''
  }
  next()
})

module.exports = mongoose.model('Color', colorSchema)
