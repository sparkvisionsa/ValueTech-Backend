const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const routes = require('./presentation/routes/index.routes');
const adsRoutes = require("./presentation/routes/ads.route");
const harajAdsRoutes = require("./presentation/routes/harajAds.routes");
const harajScrapeRoutes = require("./presentation/routes/harajScrape.routes");
const mobasherRoute = require("./presentation/routes/mobasher.route");
const yallaRoute = require("./presentation/routes/yalla.routes");







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
app.use("/api/haraj-ads", harajAdsRoutes);
app.use("/api/haraj-scrape", harajScrapeRoutes);

app.use("/api/mobasher", mobasherRoute);
app.use("/api/yalla", yallaRoute);




// app.use("/api/reports", allReportRoutes);

app.get('/', (req, res) => res.json({ message: 'Hello World' }));

module.exports = app;
