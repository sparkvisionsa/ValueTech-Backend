require('dotenv').config();
const app = require('./app');
const { connect } = require('./infrastructure/connect');

const PORT = process.env.PORT || 3000;

async function main() {
    await connect();

    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

main().catch((err) => {
    console.error('Failed to start', err);
    process.exit(1);
});
