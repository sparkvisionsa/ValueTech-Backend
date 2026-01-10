const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
        cb(null, true);
        return;
    }
    cb(new Error('Only image uploads are allowed'));
};

module.exports = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});
