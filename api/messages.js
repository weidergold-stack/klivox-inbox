// api/messages.js — historial de mensajes para la bandeja (desde Zavu).
// Devuelve el mismo formato que espera index.html: { messages: [{direction, from, to, body, date}] }
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER;
  const headers = { Authorization: 'Bearer ' + KEY };
  if (SENDER) headers['Zavu-Sender'] = SENDER;
  try {
    const r = await fetch('https://api.zavu.dev/v1/messages?limit=100', { headers });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
    const items = (d && d.items) || [];
    const messages = items.map(m => ({
      // En Zavu, los mensajes entrantes llegan con status 'received'.
      direction: m.status === 'received' ? 'inbound' : 'outbound',
      from: m.from || '',
      to: m.to || '',
      body: m.text || '',
      date: m.createdAt || m.updatedAt || new Date().toISOString()
    }));
    res.status(200).json({ messages });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
