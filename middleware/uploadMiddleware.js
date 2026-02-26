// server/middleware/uploadMiddleware.js
const multer = require('multer')
const streamifier = require('streamifier')
const cloudinary = require('../config/cloudinary')

const storage = multer.memoryStorage()

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
})

const uploadToCloudinary = (buffer, folder = 'ecom') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => {
        if (err) return reject(err)
        resolve(result)
      }
    )
    streamifier.createReadStream(buffer).pipe(stream)
  })
}

module.exports = {
  upload,
  uploadToCloudinary,
}
