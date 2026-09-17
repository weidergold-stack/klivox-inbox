// api/labels.js — etiquetas de conversaciones ONLINE (Upstash KV), independientes por bandeja.
// La clave lleva el prefijo INBOX_NS para que cada bandeja tenga SUS propias etiquetas.
//
// GET  -> { labels: <estado guardado> }
//   Weider: mapa plano  { "<numero>": { a:"Alejandra", d:"Dr. Weider" } }
//   Tania : { defs:[{id,name,color}], assign:{ "<numero>":[ids] } }
//
// POST { set:{ "<numero>": <valor|null> }, defs?:[...] }
//   -> MERGE en el servidor: solo toca las claves enviadas. Es la forma correcta,
//      porque dos equipos pueden guardar a la vez sin pisarse.
// POST { defs:[...] }        -> reemplaza solo las definiciones (Tania).
// POST { labels:{...} }      -> escritura completa (compatibilidad, pisa todo).
//
// Env: INBOX_PASSWORD, KV_REST_API_URL, KV_REST_API_TOKEN, INBOX_NS (opcional)
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const URL = process.env.KV_REST_API_URL;
  const TOK = process.env.KV_REST_API_TOKEN;
  const KEY = 'labels:' + (process.env.INBOX_NS || 'default');
  const AUTH = { Authorization: 'Bearer ' + TOK };
  if (!URL || !TOK) { res.status(200).json({ labels: {}, error: 'no_kv' }); return; }

  const read = async () => {
    try {
      const r = await fetch(URL + '/get/' + encodeURIComponent(KEY), { headers: AUTH });
      const d = await r.json();
      if (d && d.result) {
        const v = JSON.parse(d.result);
        if (v && typeof v === 'object') return v;
      }
    } catch (_) {}
    return {};
  };

  const write = async (v) => {
    const r = await fetch(URL + '/set/' + encodeURIComponent(KEY), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'text/plain' }, AUTH),
      body: JSON.stringify(v)
    });
    return r.ok;
  };

  const isEmpty = (v) => {
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  };

  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      body = body || {};

      if (body.set && typeof body.set === 'object') {
        const cur = await read();
        const nested = Array.isArray(cur.defs) || (cur.assign && typeof cur.assign === 'object') || Array.isArray(body.defs);
        let target;
        if (nested) {
          if (!cur.assign || typeof cur.assign !== 'object') cur.assign = {};
          target = cur.assign;
        } else {
          target = cur;
        }
        Object.keys(body.set).forEach(function (k) {
          const v = body.set[k];
          if (isEmpty(v)) delete target[k]; else target[k] = v;
        });
        if (Array.isArray(body.defs)) cur.defs = body.defs;
        const ok = await write(cur);
        res.status(200).json({ ok: ok, labels: cur });
        return;
      }

      if (Array.isArray(body.defs)) {
        const cur = await read();
        if (!cur.assign || typeof cur.assign !== 'object') cur.assign = {};
        cur.defs = body.defs;
        const ok = await write(cur);
        res.status(200).json({ ok: ok, labels: cur });
        return;
      }

      const labels = body.labels || {};
      const ok = await write(labels);
      res.status(200).json({ ok: ok, labels: labels });
      return;
    }

    const cur = await read();
    res.status(200).json({ labels: cur });
  } catch (e) {
    res.status(200).json({ labels: {}, error: String(e) });
  }
};
