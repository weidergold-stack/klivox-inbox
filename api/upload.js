// api/upload.js — sube un archivo a Vercel Blob (público) y devuelve su URL.
// El navegador envía { filename, contentType, dataBase64 }. Protegido por INBOX_PASSWORD.
const { put } = require('@vercel/blob');

module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const dataBase64 = body.dataBase64 || '';
    const filename = body.filename || 'archivo';
    const contentType = body.contentType || 'application/octet-stream';
    if (!dataBase64) return res.status(400).json({ ok: false, error: 'no_file' });

    const buf = Buffer.from(dataBase64, 'base64');
    const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-60);
    const path = 'inbox/' + Date.now() + '-' + safe;

    const blob = await put(path, buf, {
      access: 'public',
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true
    });

    return res.status(200).json({ ok: true, url: blob.url, name: safe });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};
