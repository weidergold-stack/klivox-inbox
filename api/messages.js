// api/messages.js — historial COMPLETO y RESILIENTE para la bandeja (desde Zavu).
// Trae TODAS las conversaciones (paginando) y sus mensajes, con REINTENTO ante 429
// (rate limit de Zavu). Concurrencia baja para no saturar. La direccion se toma del contacto.
// Devuelve: { messages:[{direction,from,to,body,type,mediaUrl,filename,mimeType,date}] }
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD, INBOX_SINCE (opcional)
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER;
  const ZAVU = 'https://api.zavu.dev/v1';
  const H = { Authorization: 'Bearer ' + KEY };
  if (SENDER) H['Zavu-Sender'] = SENDER;
  const norm = (s) => (s || '').replace(/\D/g, '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SINCE = process.env.INBOX_SINCE ? Date.parse(process.env.INBOX_SINCE) : Date.parse('2020-01-01T00:00:00Z');

  const MAX_CONV_PAGES = 20;
  const MAX_CONVS = 300;
  const CONCURRENCY = 4;

  // GET con reintento ante 429 (rate limit) o error de red.
  const getJson = async (url) => {
    for (let a = 0; a < 5; a++) {
      try {
        const r = await fetch(url, { headers: H });
        if (r.status === 429) { await sleep(500 * (a + 1)); continue; }
        if (r.status === 401) return { __401: true };
        return await r.json().catch(() => ({}));
      } catch (_) { await sleep(300 * (a + 1)); }
    }
    return {};
  };

  try {
    // 1) TODAS las conversaciones (paginando por cursor), con reintento.
    let convs = [];
    let cursor = '';
    let pages = 0;
    do {
      const url = ZAVU + '/conversations?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const cd = await getJson(url);
      if (cd && cd.__401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
      const items = (cd && cd.items) || [];
      convs = convs.concat(items);
      cursor = (cd && cd.nextCursor) || '';
      pages++;
    } while (cursor && pages < MAX_CONV_PAGES && convs.length < MAX_CONVS);
    convs = convs.slice(0, MAX_CONVS);

    // 2) Mensajes de cada conversacion, en lotes pequenos, con reintento.
    const fetchConv = async (c) => {
      const contact = c.contactIdentifier || '';
      const cdig = norm(contact);
      const md = await getJson(ZAVU + '/conversations/' + encodeURIComponent(c.id) + '/messages?limit=100');
      const items = (md && md.items) || [];
      const out = [];
      for (const m of items) {
        const mt = m.createdAt ? new Date(m.createdAt).getTime() : 0;
        if (mt && mt < SINCE) continue;
        const inbound = !!(m.from && (m.from === contact || (cdig && norm(m.from) === cdig)));
        const ct = m.content || {};
        out.push({
          direction: inbound ? 'inbound' : 'outbound',
          from: m.from || '',
          to: m.to || '',
          body: m.text || '',
          type: m.messageType || 'text',
          mediaUrl: ct.mediaUrl || '',
          filename: ct.filename || '',
          mimeType: ct.mimeType || '',
          date: m.createdAt || m.updatedAt || new Date().toISOString()
        });
      }
      return out;
    };

    let messages = [];
    for (let i = 0; i < convs.length; i += CONCURRENCY) {
      const batch = convs.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(fetchConv));
      for (const arr of results) messages = messages.concat(arr);
    }

    res.status(200).json({ messages });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
