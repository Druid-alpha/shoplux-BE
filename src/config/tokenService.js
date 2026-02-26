const jwt =require('jsonwebtoken')
const signAccessToken=(payload)=>{
    return jwt.sign(payload,process.env.ACCESS_TOKEN_SECRET,{expiresIn:process.env.JWT_ACCESS_EXPIRES})
}
const signRefreshToken=(payload)=>{
    return jwt.sign(payload,process.env.REFRESH_TOKEN_SECRET,{expiresIn:process.env.JWT_REFRESH_EXPIRES})
}
const verifyAccessToken=(token)=>{
    return jwt.verify(token,process.env.ACCESS_TOKEN_SECRET)  
}
const verifyRefreshToken=(token)=>{
    return jwt.verify(token,process.env.REFRESH_TOKEN_SECRET)
}
 module.exports={signAccessToken,signRefreshToken, verifyAccessToken, verifyRefreshToken}