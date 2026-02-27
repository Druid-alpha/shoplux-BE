const User = require('../models/user')
const { z } = require('zod')
const bcrypt = require('bcryptjs')
const sendEmail = require('../utils/sendEmail')
const { verifyRefreshToken, signAccessToken, signRefreshToken } = require('../config/tokenService')
const cookieOption = require('../utils/cookieOptions')
const handleZodError = require('../utils/handleZodError')
const crypto = require('crypto')

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6)
})

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6)
})



exports.register = async (req, res) => {
    try {
        const data = registerSchema.parse(req.body)

        const existing = await User.findOne({ email: data.email })

        if (existing) {
            if (!existing.emailVerified) {
                // User exists but email not verified → tell frontend
                return res
                    .status(400)
                    .json({ success: false, message: 'email not verified' })
            }
            // User exists and verified → normal error
            return res
                .status(400)
                .json({ success: false, message: 'email already exists' })
        }

        // Hash password
        const saltRound = await bcrypt.genSalt(10)
        const hashed = await bcrypt.hash(data.password, saltRound)

        // Create new user
        const user = await User.create({
            name: data.name,
            email: data.email,
            password: hashed,
        })

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString()
        user.otp = otp
        user.otpExpires = Date.now() + 1000 * 60 * 10 // 10 minutes
        await user.save()

        // Send OTP email
        await sendEmail({
            to: user.email,
            subject: 'Verify your email',
            html: `<p>Your verification code: <b>${otp}</b></p>`,
        })

        res
            .status(201)
            .json({ success: true, message: 'Registered, check email for OTP' })
   } catch (error) {

    const zodErrors = handleZodError(error)

    if (zodErrors) {
        return res.status(400).json({
            success: false,
            errors: zodErrors
        })
    }

    res.status(500).json({
        success: false,
        message: 'Server error'
    })
}
}

exports.resendOtp = async (req, res) => {
    try {
        const { email } = req.body
        const user = await User.findOne({ email })

        if (!user) return res.status(404).json({ message: 'User not found' })
        if (user.emailVerified) {
            return res.status(400).json({ message: 'Email already verified' })
        }

        // ⏱ Rate limit (60 seconds)
        if (
            user.lastOtpSentAt &&
            Date.now() - user.lastOtpSentAt.getTime() < 60 * 1000
        ) {
            return res.status(429).json({
                message: 'Please wait before requesting another OTP'
            })
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString()

        user.otp = otp
        user.otpExpires = Date.now() + 1000 * 60 * 10
        user.lastOtpSentAt = new Date()
        user.otpAttempts = 0

        await user.save()

        await sendEmail({
            to: user.email,
            subject: 'Verify your email',
            html: `<p>Your new OTP is <b>${otp}</b></p>`
        })

        res.json({ message: 'OTP resent successfully' })
    } catch (error) {
        res.status(500).json({ message: 'Failed to resend OTP' })
    }
}


exports.verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body
        const user = await User.findOne({ email })

        if (!user) return res.status(404).json({ message: 'User not found' })

        // 🚫 Blocked due to too many attempts
        if (user.otpBlockedUntil && user.otpBlockedUntil > Date.now()) {
            return res.status(429).json({
                message: 'Too many attempts. Try again later.'
            })
        }

        if (!user.otp || user.otp !== otp) {
            user.otpAttempts += 1

            // ⛔ Block after 5 failed attempts
            if (user.otpAttempts >= 5) {
                user.otpBlockedUntil = Date.now() + 1000 * 60 * 15 // 15 mins
            }

            await user.save()
            return res.status(400).json({ message: 'Invalid OTP' })
        }

        if (user.otpExpires < Date.now()) {
            return res.status(400).json({ message: 'OTP expired' })
        }

        // ✅ Success
        user.emailVerified = true
        user.otp = undefined
        user.otpExpires = undefined
        user.otpAttempts = 0
        user.otpBlockedUntil = undefined

        await user.save()
// 🎉 SEND WELCOME EMAIL
await sendEmail({
  to: user.email,
  subject: 'Welcome to ShopLuxe 🎉',
  html: `
    <h2>Welcome, ${user.name} 👋</h2>
    <p>Your email has been successfully verified.</p>
    <p>You can now log in and start shopping amazing products.</p>
    <br />
    <p><b>Happy shopping 🛒</b></p>
  `
})
        res.json({ message: 'Email verified successfully' })
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}


exports.login = async (req, res) => {
    try {
        const data = loginSchema.parse(req.body)
        const user = await User.findOne({ email: data.email })
        if (!user) return res.status(400).json({ message: 'invalid credentials' })
        if (user.isDeleted) return res.status(400).json({ message: 'user is removed' })

        const ok = await bcrypt.compare(data.password, user.password)
        if (!ok) return res.status(400).json({ message: 'invalid credentials' })
        if (!user.emailVerified) return res.status(403).json({ message: ' verify email first' })

        const accessToken = signAccessToken({ id: user._id, role: user.role })
        const refreshToken = signRefreshToken({ id: user._id })
        user.refreshTokens.push({ token: refreshToken })
        await user.save()
        res.cookie('accessToken', accessToken, cookieOption(1 * 60 * 60 * 1000))
        res.cookie('refreshToken', refreshToken, cookieOption(7 * 24 * 60 * 60 * 1000))
        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        })

   } catch (error) {

    const zodErrors = handleZodError(error)

    if (zodErrors) {
        return res.status(400).json({
            success: false,
            errors: zodErrors
        })
    }

    res.status(500).json({
        success: false,
        message: 'Server error'
    })
}
}

exports.refresh = async (req, res) => {
    try {
        const currRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken
        if (!currRefreshToken) return res.status(401).json({ message: 'no refresh token' })
        const decoded = verifyRefreshToken(currRefreshToken)

        const newRefreshToken = signRefreshToken({ id: decoded.id })

        const user = await User.findOneAndUpdate({
            _id: decoded.id,
            'refreshTokens.token': currRefreshToken,
            'refreshTokens.revoked': false
        }, {
            $set: { 'refreshTokens.$.revoked': true },
            $push: { refreshTokens: { token: newRefreshToken, revoked: false, createdAt: new Date() } }
        },
            { new: true }
        )
        if (!user) return res.status(401).json({ message: 'refresh tokens revoked ,reused or invalid ' })
        const newAccessToken = signAccessToken({ id: user._id, role: user.role })
        res.cookie('accessToken', newAccessToken, cookieOption(15 * 60 * 1000))
        res.cookie('refreshToken', newRefreshToken, cookieOption(7 * 24 * 60 * 60 * 1000))
        res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } })
    } catch (error) {
        res.status(401).json({ message: 'invalid or expired token' })
    }
}
exports.logOut = async (req, res) => {
    try {
        const currRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken
        if (currRefreshToken) {
            try {
                const decoded = verifyRefreshToken(currRefreshToken)
                const user = await User.findById(decoded.id)
                if (user) {
                    user.refreshTokens = user.refreshTokens.map(rt => rt.token === currRefreshToken ? { ...rt.toObject(), revoked: true } : rt)
                    await user.save()
                }
            } catch (error) {

            }
            res.clearCookie('accessToken', cookieOption())
            res.clearCookie('refreshToken', cookieOption())

            res.json({ message: 'logged out' })
        }
    } catch (error) {
        res.status(500).json({ message: 'log out failed' })
    }
}
exports.me = async (req, res) => {
    try {
        const token = req.cookies?.accessToken
        if (!token) return res.status(401).json({ message: 'no token' })
        const decoded = require('../config/tokenService').verifyAccessToken(token)
        const user = await User.findById(decoded.id).select('-password -refreshTokens')
        if (!user) return res.status(401).json({ message: 'invalid token user' })
        res.json({ user })
    } catch (error) {
        res.status(401).json({ message: 'invalid token' })
    }
}
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body
        const user = await User.findOne({ email })

        // Do NOT reveal if user exists (security best practice)
        if (!user) {
            return res.json({ message: 'If email exists, reset link sent' })
        }

        const rawToken = crypto.randomBytes(32).toString('hex')

        user.resetToken = crypto
            .createHash('sha256')
            .update(rawToken)
            .digest('hex')

        user.resetTokenExpires = Date.now() + 1000 * 60 * 30 // 30 mins
        await user.save()

        const resetLink = `${process.env.CLIENT_URL}/reset-password/${rawToken}`

        await sendEmail({
            to: user.email,
            subject: 'Reset password',
            html: `<p>Reset your password here:</p>
             <a href="${resetLink}">${resetLink}</a>`
        })

        res.json({ message: 'Password reset email sent' })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: 'Error sending reset email' })
    }
}


exports.resetpassword = async (req, res) => {
    try {
        const { token } = req.params
        const { password } = req.body

        const hashedToken = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex')

        const user = await User.findOne({
            resetToken: hashedToken,
            resetTokenExpires: { $gt: Date.now() }
        })

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired token' })
        }

        user.password = await bcrypt.hash(password, 10)

        // ✅ THIS IS THE PART YOU ASKED ABOUT
        user.resetToken = undefined
        user.resetTokenExpires = undefined

        await user.save()

        res.json({ message: 'Password reset successful' })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: 'Reset failed' })
    }
}