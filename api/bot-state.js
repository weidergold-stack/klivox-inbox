// api/bot-state.js — lee/escribe el interruptor de pausa del bot en Redis (Upstash)
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
      const b = req.body || {};
      const val = b.paused ? '1' : '0';
      await fetch(`${KU}/set/klivox_bot_paused/${val}`, { method: 'POST', headers: H });
      return res.status(200).json({ ok: true, paused: val === '1' });
    }
    const r = await fetch(`${KU}/get/klivox_bot_paused`, { headers: H });
    const d = await r.json();
    return res.status(200).json({ paused: d && d.result === '1' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
