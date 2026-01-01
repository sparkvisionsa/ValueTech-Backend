const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const routes = require('./presentation/routes/index.routes');
const adsRoutes = require("./presentation/routes/ads.route");

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({
    limit: '100mb',
    extended: true
}));
app.use(cookieParser());
app.use(morgan('dev'));
app.use('/uploads', express.static('uploads'));

app.use('/api', routes);
app.use("/api/ads", adsRoutes);

app.get('/', (req, res) => res.json({ message: 'Hello World' }));

module.exports = app;
