const mongoose = require('mongoose');

const connect = async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mydb';
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');
};

module.exports = { connect, mongoose };
