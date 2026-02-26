const isProd = process.env.NODE_ENV === 'production'

/**
 * Unified cookie options
 * Must be IDENTICAL for set & clear
 */
module.exports = (maxAge) => ({
  httpOnly: true,

  // only true in production (https)
  secure: isProd,

  // cross-site in prod, same-site in dev
  sameSite: isProd ? 'none' : 'lax',

  // optional expiration
  ...(maxAge ? { maxAge } : {}),

  // DO NOT set domain in dev
  ...(isProd && process.env.COOKIE_DOMAIN
    ? { domain: process.env.COOKIE_DOMAIN }
    : {})
})
