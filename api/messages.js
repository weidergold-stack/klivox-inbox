// api/messages.js — historial COMPLETO para la bandeja (desde Zavu).
// Trae TODAS las conversaciones (paginando por cursor) y sus mensajes en paralelo suave.
// La direccion se determina por el contacto del hilo (contactIdentifier).
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
  const SINCE = process.env.INBOX_SINCE ? Date.parse(process.env.INBOX_SINCE) : Date.parse('2020-01-01T00:00:00Z');

  const MAX_CONV_PAGES = 20;  // hasta 20 x 50 = 1000 conversaciones
  const MAX_CONVS = 300;      // tope de conversaciones a procesar
  const CONCURRENCY = 4;      // fetches de mensajes en paralelo (suave)

  try {
    // 1) Traer TODAS las conversaciones (paginando por cursor).
    let convs = [];
    let cursor = '';
    let pages = 0;
    do {
      const url = ZAVU + '/conversations?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const cr = await fetch(url, { headers: H });
      if (cr.status === 401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
      const cd = await cr.json().catch(() => ({}));
      const items = (cd && cd.items) || [];
      convs = convs.concat(items);
      cursor = (cd && cd.nextCursor) || '';
      pages++;
    } while (cursor && pages < MAX_CONV_PAGES && convs.length < MAX_CONVS);
    convs = convs.slice(0, MAX_CONVS);

    // 2) Mensajes de cada conversacion (en lotes) para traer todo sin demorar de mas.
    const fetchConv = async (c) => {
      const contact = c.contactIdentifier || '';
      const cdig = norm(contact);
      let items = [];
      try {
        const mr = await fetch(ZAVU + '/conversations/' + encodeURIComponent(c.id) + '/messages?limit=100', { headers: H });
        const md = await mr.json().catch(() => ({}));
        items = (md && md.items) || [];
      } catch (_) { items = []; }
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
