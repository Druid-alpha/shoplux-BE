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

// Prevent duplicate colors per category
colorSchema.index({ name: 1, category: 1 }, { unique: true })

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
