// api/bot-state.js — interruptor de pausa del bot en Redis (Upstash)
// Sin 'number' => interruptor GLOBAL (botpaused:<INBOX_NS>).
// Con 'number' => interruptor por conversacion (paused:<INBOX_NS>:<number>).
module.exports = async (req, res) => {
  const pass = req.headers['x-inbox-pass'] || '';
  if (!process.env.INBOX_PASSWORD || pass !== process.env.INBOX_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return res.status(500).json({ error: 'kv_no_config' });
  const H = { Authorization: `Bearer ${KT}` };
  const NS = process.env.INBOX_NS || 'default';
  const keyFor = (num) => num ? ('paused:' + NS + ':' + String(num)) : ('botpaused:' + NS);

  // --- Estado de pago de la suscripcion del cliente (kind=sub) ---
  // GET  /api/bot-state?kind=sub              -> { cycles:['2026-09-18', ...] }
  // POST /api/bot-state { kind:'sub', cycle:'2026-09-18', paid:true|false }
  let _b = req.body;
  if (typeof _b === 'string') { try { _b = JSON.parse(_b); } catch (e) { _b = {}; } }
  _b = _b || {};
  const wantsSub = (req.query && req.query.kind === 'sub') || _b.kind === 'sub';
  if (wantsSub) {
    const SUBKEY = 'sub:' + NS;
    const subRead = async () => {
      try {
        const r = await fetch(KU + '/get/' + encodeURIComponent(SUBKEY), { headers: H });
        const d = await r.json();
        const v = d && d.result ? JSON.parse(d.result) : null;
        return (v && Array.isArray(v.cycles)) ? v : { cycles: [] };
      } catch (e) { return { cycles: [] }; }
    };
    if (req.method !== 'POST') {
      const cur = await subRead();
      return res.status(200).json({ cycles: cur.cycles, updatedAt: cur.updatedAt || null });
    }
    const cycle = String(_b.cycle || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cycle)) return res.status(400).json({ error: 'bad_cycle' });
    const cur = await subRead();
    const set = cur.cycles.filter(function (c) { return c !== cycle; });
    if (_b.paid !== false) set.push(cycle);
    set.sort();
    const out = { cycles: set.slice(-24), updatedAt: new Date().toISOString() };
    try {
      await fetch(KU + '/set/' + encodeURIComponent(SUBKEY), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KT, 'Content-Type': 'text/plain' },
        body: JSON.stringify(out)
      });
    } catch (e) { return res.status(500).json({ error: 'kv_write' }); }
    return res.status(200).json({ ok: true, cycles: out.cycles });
  }
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
