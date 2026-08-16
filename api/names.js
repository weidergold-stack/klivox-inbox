// api/names.js — nombres de contactos ONLINE (Upstash KV), independientes por bandeja.
// GET  -> { names: { "<numero>": "<nombre>" } }
// POST { names:{...} } -> guarda el mapa completo.
// La clave lleva el prefijo INBOX_NS para que cada bandeja tenga SUS propios nombres.
// Env: INBOX_PASSWORD, KV_REST_API_URL, KV_REST_API_TOKEN, INBOX_NS (opcional)
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const URL = process.env.KV_REST_API_URL;
  const TOK = process.env.KV_REST_API_TOKEN;
  const KEY = 'names:' + (process.env.INBOX_NS || 'default');
  const AUTH = { Authorization: 'Bearer ' + TOK };
  if (!URL || !TOK) { res.status(200).json({ names: {}, error: 'no_kv' }); return; }

  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const names = (body && body.names) || {};
      const r = await fetch(URL + '/set/' + encodeURIComponent(KEY), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'text/plain' }, AUTH),
        body: JSON.stringify(names)
      });
      res.status(200).json({ ok: r.ok });
      return;
    }
    const r = await fetch(URL + '/get/' + encodeURIComponent(KEY), { headers: AUTH });
    const d = await r.json().catch(() => ({}));
    let names = {};
    if (d && d.result) { try { names = JSON.parse(d.result); } catch (_) { names = {}; } }
    res.status(200).json({ names: names || {} });
  } catch (e) {
    res.status(200).json({ names: {}, error: String(e) });
  }
};
