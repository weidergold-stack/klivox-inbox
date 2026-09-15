// api/sub.js — estado de pago de la suscripcion del cliente, guardado en KV.
// GET  -> { cycles: ['2026-09-18', ...] }  (ciclos ya pagados)
// POST { cycle:'2026-09-18', paid:true|false } -> marca / desmarca ese ciclo
module.exports = async (req, res) => {
  const pass = req.headers['x-inbox-pass'] || '';
  if (!process.env.INBOX_PASSWORD || pass !== process.env.INBOX_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const URL = process.env.KV_REST_API_URL, TOK = process.env.KV_REST_API_TOKEN;
  if (!URL || !TOK) return res.status(500).json({ error: 'kv_no_config' });
  const KEY = 'sub:' + (process.env.INBOX_NS || 'default');
  const AUTH = { Authorization: 'Bearer ' + TOK };

  async function read() {
    try {
      const r = await fetch(URL + '/get/' + encodeURIComponent(KEY), { headers: AUTH });
      const d = await r.json();
      const v = d && d.result ? JSON.parse(d.result) : null;
      return (v && Array.isArray(v.cycles)) ? v : { cycles: [] };
    } catch (e) { return { cycles: [] }; }
  }

  if (req.method === 'GET') {
    const cur = await read();
    return res.status(200).json({ cycles: cur.cycles, updatedAt: cur.updatedAt || null });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const cycle = String(body.cycle || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cycle)) return res.status(400).json({ error: 'bad_cycle' });
    const cur = await read();
    const set = cur.cycles.filter(function (c) { return c !== cycle; });
    if (body.paid !== false) set.push(cycle);
    set.sort();
    const out = { cycles: set.slice(-24), updatedAt: new Date().toISOString(), source: body.source || 'manual' };
    try {
      await fetch(URL + '/set/' + encodeURIComponent(KEY), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'text/plain' },
        body: JSON.stringify(out)
      });
    } catch (e) { return res.status(500).json({ error: 'kv_write' }); }
    return res.status(200).json({ ok: true, cycles: out.cycles });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
};
