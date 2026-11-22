// api/bot-state.js — interruptor de pausa del bot en Redis (Upstash)
// Sin 'number' => interruptor GLOBAL (klivox_bot_paused).
// Con 'number' => interruptor por conversacion (klivox_paused:<ultimos 10 digitos del numero>).
// Regla: lo que se elige en un chat manda sobre el global.
//        Un chat sin eleccion propia sigue al interruptor global.
// OJO: api/webhook.js usa la misma llave y la misma regla. Si cambias una, cambia la otra.
const GLOBAL_KEY = 'klivox_bot_paused';
const digits = (num) => String(num || '').replace(/\D/g, '');
const chatKey = (num) => 'klivox_paused:' + digits(num).slice(-10);

module.exports = async (req, res) => {
  const pass = req.headers['x-inbox-pass'] || '';
  if (!process.env.INBOX_PASSWORD || pass !== process.env.INBOX_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return res.status(500).json({ error: 'kv_no_config' });
  const H = { Authorization: `Bearer ${KT}` };
  try {
    if (req.method === 'POST') {
      let b = req.body || {};
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
      const hasNum = !!digits(b.number);
      const key = hasNum ? chatKey(b.number) : GLOBAL_KEY;
      const val = b.paused ? '1' : '0';
      const w = await fetch(`${KU}/set/${encodeURIComponent(key)}/${val}`, { method: 'POST', headers: H });
      if (!w.ok) return res.status(502).json({ error: 'kv_write_failed' });
      return res.status(200).json({ ok: true, number: hasNum ? b.number : null, paused: val === '1' });
    }
    const num = (req.query && req.query.number) || '';
    if (!digits(num)) {
      const r = await fetch(`${KU}/get/${GLOBAL_KEY}`, { headers: H });
      const d = await r.json();
      return res.status(200).json({ number: null, paused: !!d && d.result === '1' });
    }
    // Estado EFECTIVO del chat: su propia eleccion, o la global si no tiene.
    const r = await fetch(`${KU}/mget/${encodeURIComponent(chatKey(num))}/${GLOBAL_KEY}`, { headers: H });
    const d = await r.json();
    const v = (d && d.result) || [];
    const own = v[0] === '1' || v[0] === '0';
    const paused = own ? v[0] === '1' : v[1] === '1';
    return res.status(200).json({ number: num, paused, own });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
