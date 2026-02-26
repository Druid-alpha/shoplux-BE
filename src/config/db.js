const mongoose=require('mongoose')
module.exports= async()=>{
    try {
        const uri = process.env.MONGO_URI
        if(!uri) throw new Error('MONGO_URI not set in .env')
        await mongoose.connect(uri)
        console.log(`Mongodb is connected`)
    } catch (error) {
        console.error('MongoDb connection',error);
process.exit(1)
    }
}
