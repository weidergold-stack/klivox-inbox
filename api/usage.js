// api/usage.js — Métricas de uso para el panel (desde Zavu).
// Cuenta los mensajes del mes en curso y suma el gasto de proveedor (Meta) del periodo.
// Zavu NO expone un contador de plan por API: el limite (2000) es de NUESTRO negocio
// (umbral Esencial -> Pro). Aqui lo calculamos contando /v1/messages del mes.
// Devuelve: { count, limit, spentMeta, spentTotal, plan, balance }
// Env: ZAVU_API_KEY, INBOX_PASSWORD, INBOX_PLAN (opcional, por defecto "Pro")
const LIMIT_ESENCIAL = 2000; // umbral de mensajes/mes para sugerir pasar a Pro
const MAX_PAGES = 30;        // tope de paginacion (30 x 100 = 3000 msgs/mes)

module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const ZAVU = 'https://api.zavu.dev/v1';
  const H = { Authorization: 'Bearer ' + KEY };

  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // Punto de reinicio (go-live): el contador no cuenta nada anterior a esta fecha.
  // Reajustable con la variable de entorno INBOX_SINCE. Para meses futuros el
  // inicio de mes es posterior a SINCE, asi que el conteo mensual sigue normal.
  const SINCE = process.env.INBOX_SINCE ? Date.parse(process.env.INBOX_SINCE) : Date.parse('2026-08-15T06:22:00Z');
  const startCount = Math.max(monthStart, SINCE);
  const num = (x) => (typeof x === 'number' ? x : 0);

  let count = 0, spentMeta = 0, spentTotal = 0, cursor = '', pages = 0, truncated = false;
  try {
    do {
      const url = ZAVU + '/messages?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const r = await fetch(url, { headers: H });
      if (r.status === 401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
      const d = await r.json().catch(() => ({}));
      const items = (d && d.items) || [];
      for (const m of items) {
        const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
        if (t >= startCount) {
          count++;
          spentMeta += num(m.costProvider);
          spentTotal += (typeof m.costTotal === 'number') ? m.costTotal : (num(m.cost) + num(m.costProvider));
        }
      }
      cursor = (d && d.nextCursor) || '';
      pages++;
      if (pages >= MAX_PAGES) { truncated = !!cursor; break; }
    } while (cursor);
  } catch (_) { /* devuelve lo acumulado */ }

  // Balance de la sub-cuenta (gasto total acumulado, en centavos)
  let balance = null;
  try {
    const br = await fetch(ZAVU + '/balance', { headers: H });
    const bd = await br.json().catch(() => ({}));
    if (bd && (typeof bd.totalSpent === 'number' || typeof bd.balance === 'number')) {
      balance = {
        totalSpent: typeof bd.totalSpent === 'number' ? bd.totalSpent / 100 : null,
        balance: typeof bd.balance === 'number' ? bd.balance / 100 : null,
        currency: bd.currency || 'usd'
      };
    }
  } catch (_) {}

  const round = (n) => Math.round(n * 10000) / 10000;
  try {
    const _ns = process.env.INBOX_NS || 'default';
    const _mk = now.getUTCFullYear() + '-' + (now.getUTCMonth() + 1);
    const _kk = 'usage:' + _ns + ':' + _mk;
    const _ku = process.env.KV_REST_API_URL, _kt = process.env.KV_REST_API_TOKEN;
    if (_ku && _kt) {
      let _prev = null;
      try { const _gr = await fetch(_ku + '/get/' + _kk, { headers: { Authorization: 'Bearer ' + _kt } }); const _gd = await _gr.json(); if (_gd && _gd.result) _prev = JSON.parse(_gd.result); } catch (e) {}
      if (_prev && typeof _prev.count === 'number' && _prev.count > count) {
        count = _prev.count;
        if (typeof _prev.spentMeta === 'number' && _prev.spentMeta > spentMeta) spentMeta = _prev.spentMeta;
        if (typeof _prev.spentTotal === 'number' && _prev.spentTotal > spentTotal) spentTotal = _prev.spentTotal;
      } else {
        try { await fetch(_ku + '/set/' + _kk, { method: 'POST', headers: { Authorization: 'Bearer ' + _kt, 'Content-Type': 'text/plain' }, body: JSON.stringify({ count: count, spentMeta: spentMeta, spentTotal: spentTotal }) }); } catch (e) {}
      }
    }
  } catch (e) {}
  res.status(200).json({
    count,
    limit: LIMIT_ESENCIAL,
    spentMeta: round(spentMeta),
    spentTotal: round(spentTotal),
    plan: process.env.INBOX_PLAN || 'Pro',
    truncated,
    balance
  });
};
