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

// Al ENCENDER el bot en un chat: si el paciente tiene mensajes sin contestar (lo ultimo
// del chat es suyo y es de las ultimas 23 horas, dentro de la ventana de WhatsApp), se le
// pasan a Lia para que arranque de una vez. Sin esto el bot solo reaccionaria cuando el
// paciente vuelva a escribir. Devuelve cuantos mensajes se le pasaron.
async function retomar(number, convId) {
  if (!BS.liaReady()) return 0;
  const cfgRaw = await BS.pipeline([['GET', 'botcfg:' + BS.NS]]);
  let enabled = false;
  try { enabled = !!JSON.parse((cfgRaw && cfgRaw[0]) || '{}').enabled; } catch (_) {}
  if (!enabled) return 0; // con el bot general apagado Lia no podria responder

  const KEY = process.env.ZAVU_API_KEY, SENDER = process.env.ZAVU_SENDER;
  if (!KEY) return 0;
  const H = { Authorization: 'Bearer ' + KEY };
  if (SENDER) H['Zavu-Sender'] = SENDER;
  const id = BS.chatId(number);
  const Z = 'https://api.zavu.dev/v1';

  let cid = String(convId || '').trim();
  if (!cid) {
    const cr = await fetch(Z + '/conversations?limit=100', { headers: H });
    if (!cr.ok) return 0;
    const cd = await cr.json().catch(() => ({}));
    const conv = ((cd && cd.items) || []).find(c => BS.chatId(c.contactIdentifier) === id);
    cid = (conv && conv.id) || '';
  }
  if (!cid) return 0;
  const mr = await fetch(Z + '/conversations/' + encodeURIComponent(cid) + '/messages?limit=100', { headers: H });
  if (!mr.ok) return 0;
  const md = await mr.json().catch(() => ({}));
  const all = ((md && md.items) || [])
    .map(m => ({
      id: m.id || '',
      mine: BS.chatId(m.from) === id,
      text: String(m.text || '').replace('\u200B', '').trim(),
      at: m.createdAt || null,
      t: m.createdAt ? Date.parse(m.createdAt) : 0
    }))
    .filter(m => m.t)
    .sort((a, b) => a.t - b.t);
  // Seguridad: que la conversacion sea de verdad la de este contacto.
  if (!all.some(m => m.mine)) return 0;

  // Lo ultimo del chat que escribio el paciente y nadie contesto.
  let i = all.length;
  while (i > 0 && all[i - 1].mine) i--;
  const limite = Date.now() - 23 * 60 * 60 * 1000;
  const pend = all.slice(i).filter(m => m.text && m.id && m.t > limite);
  if (!pend.length) return 0;

  const first = await BS.pipeline([['SADD', BS.K_LIA, id]]);
  const isFirst = !!(first && Number(first[0]) === 1);
  const previo = isFirst
    ? all.slice(0, i).filter(m => m.text).slice(-20).map(m => ({ rol: m.mine ? 'paciente' : 'equipo', texto: m.text.slice(0, 1500), fecha: m.at }))
    : undefined;

  let n = 0;
  for (let k = 0; k < pend.length; k++) {
    const extra = { texto: pend[k].text, messageId: pend[k].id, fecha: pend[k].at };
    if (k === 0 && previo && previo.length) extra.previo = previo;
    const r = await BS.lia('entrante', number, extra, 15000);
    if (r && r.ok !== false && r.guardado) n++;
    else if (!r || r.ok === false) { if (isFirst && n === 0) await BS.pipeline([['SREM', BS.K_LIA, id]]); break; }
  }
  return n;
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
        // Lia se entera de que le devolvieron o le quitaron el chat.
        try { if (await BS.liaKnows(b.number)) await BS.lia(on ? 'bot_on' : 'bot_off', b.number, null, 4000); } catch (_) {}
        // Recien encendido: Lia retoma lo que el paciente dejo sin contestar.
        let retomados = 0;
        if (on) { try { retomados = await retomar(b.number, b.convId); } catch (_) {} }
        return res.status(200).json({ ok: true, number: b.number, on, paused: !on, retomados });
      }

      const val = b.paused ? '1' : '0';
      await BS.pipeline([['SET', BS.K_GLOBAL_PAUSE, val]]);
      return res.status(200).json({ ok: true, number: null, paused: val === '1' });
    }

    const q = req.query || {};
    if (q.puente) {
      // Diagnostico: ¿el secreto de la bandeja y el de Lia son el mismo? No guarda ni envia nada.
      // Lia contesta 401 si el secreto no coincide y 400 ("evento desconocido") si si coincide.
      if (!BS.liaReady()) return res.status(200).json({ configurado: false });
      let status = 0;
      try {
        const r = await fetch((process.env.LIA_URL || 'https://cita.kromagrupo.com').replace(/\/+$/, '') + '/api/zavu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-puente-secret': process.env.PUENTE_SECRET },
          body: JSON.stringify({ evento: 'ping', de: '+570000000000' })
        });
        status = r.status;
      } catch (_) {}
      return res.status(200).json({ configurado: true, status, coincide: status === 400 });
    }
    if (q.list) {
      const st = await BS.listOn();
      st.lia = BS.liaReady(); // true = responde Lia; false = el bot sencillo del panel
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
