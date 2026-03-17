const nodeMailer = require('nodemailer')

const emailTemplate = (title, content, preheader = '') => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f5f6f8; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #0b0b0b, #1a1a1a); padding: 28px 40px; text-align: center; }
    .logo { color: #ffffff; font-size: 28px; font-weight: 900; letter-spacing: -1px; text-decoration: none; font-style: italic; }
    .logo span { color: #9ca3af; }
    .content { padding: 40px; color: #1f2937; line-height: 1.65; font-size: 16px; }
    .footer { padding: 28px 36px; text-align: center; background-color: #f8fafc; color: #6b7280; font-size: 12px; border-top: 1px solid #eef2f7; }
    .button { display: inline-block; background-color: #111827; color: #ffffff !important; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 700; margin: 18px 0; }
    .otp-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px; text-align: center; border-radius: 10px; margin: 20px 0; }
    .otp-code { font-size: 30px; font-weight: 800; letter-spacing: 6px; color: #0f172a; margin: 0; }
    h1 { margin-top: 0; font-size: 24px; font-weight: 800; color: #111827; }
    .meta { font-size: 13px; color: #6b7280; }
    .muted { color: #6b7280; font-size: 14px; }
    .card { border: 1px solid #eef2f7; border-radius: 12px; padding: 16px; background: #fbfdff; }
    .divider { border-top: 1px solid #eef2f7; margin: 24px 0; }
    .list { padding-left: 18px; margin: 10px 0; }
    .preheader { display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; }
  </style>
</head>
<body>
  ${preheader ? `<span class="preheader">${preheader}</span>` : ''}
  <div class="container">
    <div class="header">
      <a href="${process.env.CLIENT_URL || 'https://shopluxe.com'}" class="logo">ShopLuxe<span>.</span></a>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ShopLuxe. All rights reserved.</p>
      <p>Zone 7, Ota-Efun Osogbo, Osun, Nigeria</p>
    </div>
  </div>
</body>
</html>
`

const sendEmail = async ({ to, subject, text, htmlContent, title, preheader }) => {
    try {
        const smtpUser = process.env.SMTP_USER
        const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '')
        if (!smtpUser || !smtpPass) {
            throw new Error('SMTP credentials are missing')
        }

        const transporter = nodeMailer.createTransport({
            service: 'gmail',
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        })

        const finalHtml = htmlContent ? emailTemplate(title || subject, htmlContent, preheader) : undefined

        await transporter.sendMail({
            from: `"${process.env.APP_NAME || 'ShopLuxe.'}" <${smtpUser}>`,
            to,
            subject,
            text,
            html: finalHtml,
        })
    } catch (error) {
        console.error('Email sending failed:', error)
        throw new Error('Email could not be sent')
    }
}

module.exports = sendEmail
