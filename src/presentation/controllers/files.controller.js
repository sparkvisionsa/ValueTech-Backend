const path = require('path');
const mongoose = require('mongoose');
const StoredFile = require('../../infrastructure/models/storedFile');
const { sanitizeName } = require('../../application/services/files/fileStorage.service');

const guessImageMime = (name = '') => {
    const ext = path.extname(String(name || '')).toLowerCase();
    switch (ext) {
        case '.webp':
            return 'image/webp';
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif';
        case '.bmp':
            return 'image/bmp';
        case '.svg':
            return 'image/svg+xml';
        default:
            return '';
    }
};

const normalizeBuffer = (value) => {
    if (Buffer.isBuffer(value)) return value;
    if (value?.buffer && Buffer.isBuffer(value.buffer)) return value.buffer;
    if (Array.isArray(value?.data)) return Buffer.from(value.data);
    if (value?.data && Buffer.isBuffer(value.data)) return value.data;
    return null;
};

exports.getFile = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid file id' });
        }

        const doc = await StoredFile.findById(id).lean();
        if (!doc || !doc.data) {
            return res.status(404).json({ message: 'File not found' });
        }

        const data = normalizeBuffer(doc.data);
        if (!data || data.length === 0) {
            return res.status(404).json({ message: 'File not found' });
        }

        const fileName = sanitizeName(doc.originalName || 'file');
        const fallbackMime = guessImageMime(fileName);
        const contentType =
            doc.mimeType && String(doc.mimeType || '').startsWith('image/')
                ? doc.mimeType
                : fallbackMime || doc.mimeType || 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', data.length);
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.end(data);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load file', error: err.message });
    }
};
