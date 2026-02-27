// utils/handleZodError.js
const { ZodError } = require('zod')

function handleZodError(error) {
  if (error instanceof ZodError) {
    const formatted = {}

    error.issues.forEach(issue => {
      formatted[issue.path[0]] = issue.message
    })

    return formatted
  }
  return null
}

module.exports = handleZodError