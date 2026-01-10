const path = require('path');
const StoredFile = require('../../../infrastructure/models/storedFile');

const sanitizeName = (value, fallback = 'file') => {
    const base = path
        .basename(String(value || ''))
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 80);
    return base || fallback;
};

const storeUploadedFile = async (file, { ownerId = null, purpose = '' } = {}) => {
    if (!file || !Buffer.isBuffer(file.buffer)) {
        throw new Error('Uploaded file buffer is missing');
    }
    const originalName = path.basename(String(file.originalname || ''));
    const doc = await StoredFile.create({
        originalName,
        mimeType: String(file.mimetype || 'application/octet-stream'),
        size: Number(file.size || file.buffer.length || 0),
        data: file.buffer,
        ownerId,
        purpose: String(purpose || '')
    });
    return doc;
};

const buildFileUrl = (fileId) => `/api/files/${String(fileId || '')}`;

const storeAttachments = async (files = [], options = {}) => {
    if (!Array.isArray(files) || files.length === 0) return [];
    const docs = await Promise.all(files.map((file) => storeUploadedFile(file, options)));
    return docs.map((doc) => ({
        fileId: doc._id.toString(),
        url: buildFileUrl(doc._id.toString()),
        name: doc.originalName || '',
        type: doc.mimeType || '',
        size: doc.size || 0
    }));
};

module.exports = {
    sanitizeName,
    storeUploadedFile,
    storeAttachments,
    buildFileUrl
};
