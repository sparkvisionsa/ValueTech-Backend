const mongoose = require('mongoose');

const DEFAULT_DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mydb';
const SCRAPPING_DB_URI = process.env.MONGO_URL_SCRAPPING;
const SCRAPPING_DB_NAME = process.env.MONGO_DBNAME_SCRAPPING;

let scrappingConnection;

const getScrappingConnection = () => {
    if (!SCRAPPING_DB_URI) {
        return mongoose;
    }

    if (!scrappingConnection) {
        const options = {};
        if (SCRAPPING_DB_NAME) {
            options.dbName = SCRAPPING_DB_NAME;
        }
        scrappingConnection = mongoose.createConnection(SCRAPPING_DB_URI, options);
    }

    return scrappingConnection;
};

const connect = async () => {
    await mongoose.connect(DEFAULT_DB_URI);
    console.log('Connected to MongoDB');

    if (SCRAPPING_DB_URI) {
        const scrappingConn = getScrappingConnection();
        await scrappingConn.asPromise();
        console.log('Connected to MongoDB (scrapping)');
    }
};

module.exports = { connect, mongoose, getScrappingConnection };
