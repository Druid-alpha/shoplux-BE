const nodeMailer = require('nodemailer')

const sendEmail =async({to, subject,text,html})=>{
try {
   const  transporter=  nodeMailer.createTransport({
    service:'gmail',
    auth:{
        user:process.env.SMTP_USER,
        pass:process.env.SMTP_PASS
    }
   })
   await transporter.sendMail({
    from:`"${process.env.APP_NAME || 'APP'}" <${process.env.SMTP_USER}>`,
    to,subject,text,html,
   })
} catch (error) {
    console.error('Email sending failed:',error)
    throw new Error('Email could not be sent')
}
}
module.exports = sendEmail