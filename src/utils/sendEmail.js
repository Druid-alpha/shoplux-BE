const nodeMailer = require('nodemailer')

const emailTemplate = (title, content, preheader = '') => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .header { background-color: #000000; padding: 32px 40px; text-align: center; }
    .logo { color: #ffffff; font-size: 28px; font-weight: 900; letter-spacing: -1px; text-decoration: none; font-style: italic; }
    .logo span { color: #888888; }
    .content { padding: 40px; color: #333333; line-height: 1.6; font-size: 16px; }
    .footer { padding: 30px 40px; text-align: center; background-color: #f8fafc; color: #888888; font-size: 13px; border-top: 1px solid #eeeeee; }
    .button { display: inline-block; background-color: #000000; color: #ffffff !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 20px 0; }
    .otp-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; text-align: center; border-radius: 8px; margin: 24px 0; }
    .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #000000; margin: 0; }
    h1 { margin-top: 0; font-size: 24px; font-weight: 700; color: #111111; }
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
        const transporter = nodeMailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        })

        const finalHtml = htmlContent ? emailTemplate(title || subject, htmlContent, preheader) : undefined

        await transporter.sendMail({
            from: `"${process.env.APP_NAME || 'ShopLuxe.'}" <${process.env.SMTP_USER}>`,
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