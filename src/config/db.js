const mongoose=require('mongoose')
module.exports= async()=>{
    try {
        const uri = process.env.MONGO_URI
        if(!uri) throw new Error('MONGO_URI not set in .env')
        await mongoose.connect(uri)
        console.log(`Mongodb is connected`)
        try {
            const colors = mongoose.connection.db.collection('colors')
            const indexes = await colors.indexes()
            const hasOldIndex = indexes.some(i => i.name === 'name_1_category_1')
            if (hasOldIndex) {
                await colors.dropIndex('name_1_category_1')
                console.log('✅ Dropped legacy index: name_1_category_1')
            }
        } catch (err) {
            console.warn('⚠️ Index cleanup skipped:', err.message)
        }
    } catch (error) {
        console.error('MongoDb connection',error);
process.exit(1)
    }
}
