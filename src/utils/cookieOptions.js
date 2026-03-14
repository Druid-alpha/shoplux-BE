module.exports = (maxAge) => ({
  httpOnly: true,

  // Always true on HTTPS (Vercel)
  secure: true,

  // Required for frontend + backend different domains (mobile Safari/Chrome)
  sameSite: "none",

  // Ensure cookie is available for all routes
  path: "/",

  // Optional explicit domain (set COOKIE_DOMAIN in env if needed)
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),

  ...(maxAge ? { maxAge } : {})
})
