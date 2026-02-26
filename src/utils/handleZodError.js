// utils/handleZodError.js
const { ZodError } = require('zod')

function handleZodError(error) {
  if (error instanceof ZodError) {
    // Join all field errors into a readable string
    return error.errors.map(e => `${e.path.join('.')} : ${e.message}`).join(', ')
  }
  return null
}

module.exports = handleZodError
