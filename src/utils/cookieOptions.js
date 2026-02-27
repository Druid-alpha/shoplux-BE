module.exports = (maxAge) => ({
  httpOnly: true,

  // ALWAYS true on Vercel (HTTPS)
  secure: true,

  // REQUIRED for frontend + backend different domains
  sameSite: "none",

  ...(maxAge ? { maxAge } : {})
})