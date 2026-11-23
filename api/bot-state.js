// api/bot-state.js — estado del bot en Redis (Upstash), aislado por bandeja (INBOX_NS).
//
// GET  ?number=<n>           -> { number, on, paused }   estado del bot en ESE chat
// GET  ?list=1               -> { on:[ids], seeded, known }  chats con el bot encendido
// GET  (sin parametros)      -> { paused }               pausa GLOBAL heredada (botpaused:<NS>)
// POST { number, on }        -> enciende / apaga el bot en ese chat
// POST { number, paused }    -> igual, formato anterior (paused = !on)
// POST { action:'seed' }     -> marca como "ya existentes" todos los chats actuales de Zavu
//                               (quedan con el bot apagado). Se puede repetir sin riesgo.
// POST { paused } sin number -> pausa GLOBAL heredada
//
// Env: INBOX_PASSWORD, KV_REST_API_URL, KV_REST_API_TOKEN, ZAVU_API_KEY, ZAVU_SENDER (opcional)
const BS = require('../lib/botstate');

async function allZavuContacts() {
  const KEY = process.env.ZAVU_API_KEY, SENDER = process.env.ZAVU_SENDER;
  const H = { Authorization: 'Bearer ' + KEY };
  if (SENDER) H['Zavu-Sender'] = SENDER;
  const out = [];
  let cursor = '', pages = 0;
  do {
    const url = 'https://api.zavu.dev/v1/conversations?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error('zavu_http_' + r.status);
    const d = await r.json().catch(() => ({}));
    for (const c of ((d && d.items) || [])) { if (c.contactIdentifier) out.push(c.contactIdentifier); }
    cursor = (d && d.nextCursor) || '';
    pages++;
  } while (cursor && pages < 60);
  if (cursor) throw new Error('demasiadas_conversaciones'); // no dar por sembrado algo incompleto
  return out;
}

module.exports = async (req, res) => {
  const pass = req.headers['x-inbox-pass'] || '';
  if (!process.env.INBOX_PASSWORD || pass !== process.env.INBOX_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!BS.kvReady()) return res.status(500).json({ error: 'kv_no_config' });

  try {
    if (req.method === 'POST') {
      let b = req.body || {};
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }

      if (b.action === 'seed') {
        const ids = await allZavuContacts();
        const added = await BS.markKnown(ids);
        if (added === null) return res.status(500).json({ error: 'kv_error' });
        const seeded = await BS.setSeeded();
        return res.status(200).json({ ok: true, chats: ids.length, nuevos: added, seeded });
      }

      if (b.number) {
        const on = (typeof b.on === 'boolean') ? b.on : !b.paused;
        const ok = await BS.setOn(b.number, on);
        if (!ok) return res.status(500).json({ error: 'kv_error' });
        return res.status(200).json({ ok: true, number: b.number, on, paused: !on });
      }

      const val = b.paused ? '1' : '0';
      await BS.pipeline([['SET', BS.K_GLOBAL_PAUSE, val]]);
      return res.status(200).json({ ok: true, number: null, paused: val === '1' });
    }

    const q = req.query || {};
    if (q.list) {
      const st = await BS.listOn();
      return res.status(200).json(st);
    }
    if (q.number) {
      const on = await BS.isOn(q.number);
      return res.status(200).json({ number: q.number, on, paused: !on });
    }
    const r = await BS.pipeline([['GET', BS.K_GLOBAL_PAUSE]]);
    return res.status(200).json({ number: null, paused: !!(r && r[0] === '1') });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
