// api/send.js — Bandeja Klivox sobre Zavu. Envía WhatsApp por la API de Zavu.
// Modos:
//   1) Texto libre     -> { to, body }
//   2) Plantilla Meta  -> { to, contentSid, variables? }   (contentSid = templateId de Zavu)
//   3) Archivo (media) -> { to, mediaUrl, body? }           (PDF/imagen; body = caption)
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ ok: false, error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER; // snd_... (opcional si el proyecto tiene un solo sender)
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  let to = (body.to || '').replace('whatsapp:', '').trim();
  const text = (body.body || '').trim();
  const contentSid = (body.contentSid || '').trim(); // templateId de Zavu
  const variables = body.variables || null;          // { "1": "Laura" }
  const mediaUrl = (body.mediaUrl || '').trim();

  if (!to || (!text && !contentSid && !mediaUrl)) {
    res.status(400).json({ ok: false, error: 'Faltan datos' }); return;
  }

  const payload = { to, channel: 'whatsapp' };
  if (contentSid) {
    payload.messageType = 'template';
    payload.content = { templateId: contentSid };
    if (variables && typeof variables === 'object') payload.content.templateVariables = variables;
  } else if (mediaUrl) {
    const isImg = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(mediaUrl);
    payload.messageType = isImg ? 'image' : 'document';
    payload.content = { mediaUrl };
    if (!isImg) {
      try { payload.content.filename = decodeURIComponent(mediaUrl.split('/').pop().split('?')[0]); } catch (_) {}
    }
    if (text) payload.text = text; // caption
  } else {
    payload.text = text;
  }

  const headers = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  if (SENDER) headers['Zavu-Sender'] = SENDER;

  try {
    const r = await fetch('https://api.zavu.dev/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(payload)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = (d && (d.message || (d.error && d.error.message))) || 'error';
      const code = d && (d.code || (d.error && d.error.code));
      res.status(200).json({ ok: false, error: err, code }); return;
    }
    res.status(200).json({ ok: true, id: (d && (d.id || (d.message && d.message.id))) || null });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
};
