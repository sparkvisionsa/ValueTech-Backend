const multer = require("multer");

// Fix filenames coming from busboy (latin1 → utf8)
function decodeFilename(name) {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, "uploads/");
  },

  filename(req, file, cb) {
    const fixedName = decodeFilename(file.originalname);
    cb(null, fixedName);
  },
});

module.exports = multer({ storage });
