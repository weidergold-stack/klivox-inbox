// api/react.js — reacciona a un mensaje con un emoji (emoji vacío lo quita).
// POST { messageId, emoji }  -> id Zavu del mensaje; solo dentro de la ventana de 24 h.
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ ok: false, error: 'unauthorized' }); return;
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const id = (body.messageId || '').trim();
  const emoji = (body.emoji != null ? String(body.emoji) : '');
  if (!id) { res.status(400).json({ ok: false, error: 'falta messageId' }); return; }
  const headers = { Authorization: 'Bearer ' + process.env.ZAVU_API_KEY, 'Content-Type': 'application/json' };
  if (process.env.ZAVU_SENDER) headers['Zavu-Sender'] = process.env.ZAVU_SENDER;
  try {
    const r = await fetch('https://api.zavu.dev/v1/messages/' + encodeURIComponent(id) + '/reactions', {
      method: 'POST', headers, body: JSON.stringify({ emoji })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(200).json({ ok: false, error: (d && (d.message || d.error)) || ('HTTP ' + r.status) });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
};
