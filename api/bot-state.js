// api/bot-state.js — interruptor de pausa del bot en Redis (Upstash)
// Sin 'number' => interruptor GLOBAL (klivox_bot_paused).
// Con 'number' => interruptor por conversacion (klivox_paused:<number>).
module.exports = async (req, res) => {
  const pass = req.headers['x-inbox-pass'] || '';
  if (!process.env.INBOX_PASSWORD || pass !== process.env.INBOX_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return res.status(500).json({ error: 'kv_no_config' });
  const H = { Authorization: `Bearer ${KT}` };
  const keyFor = (num) => num ? ('klivox_paused:' + String(num)) : 'klivox_bot_paused';
  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      const key = keyFor(b.number);
      const val = b.paused ? '1' : '0';
      await fetch(`${KU}/set/${encodeURIComponent(key)}/${val}`, { method: 'POST', headers: H });
      return res.status(200).json({ ok: true, number: b.number || null, paused: val === '1' });
    }
    const num = (req.query && req.query.number) || '';
    const key = keyFor(num);
    const r = await fetch(`${KU}/get/${encodeURIComponent(key)}`, { headers: H });
    const d = await r.json();
    return res.status(200).json({ number: num || null, paused: d && d.result === '1' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
