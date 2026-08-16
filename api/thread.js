// api/thread.js — mensajes COMPLETOS de UNA conversacion (bajo demanda al abrir el chat).
// Uso: /api/thread?c=<conversationId>  (o  ?num=<numero>  como respaldo)
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
  const q = req.query || {};
  const qnum = norm(q.num);
  let convId = q.c || '';
  let contact = qnum;

  try {
    if (!convId) {
      let cursor = '', pages = 0, found = false;
      do {
        const url = ZAVU + '/conversations?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
        const cr = await fetch(url, { headers: H });
        if (cr.status === 401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
        const cd = await cr.json().catch(() => ({}));
        const items = (cd && cd.items) || [];
        for (const c of items) {
          if (norm(c.contactIdentifier) === qnum) { convId = c.id; contact = c.contactIdentifier || qnum; found = true; break; }
        }
        if (found) break;
        cursor = (cd && cd.nextCursor) || '';
        pages++;
      } while (cursor && pages < 20);
    }
    if (!convId) { res.status(200).json({ messages: [] }); return; }

    const mr = await fetch(ZAVU + '/conversations/' + encodeURIComponent(convId) + '/messages?limit=100', { headers: H });
    const md = await mr.json().catch(() => ({}));
    const items = (md && md.items) || [];
    const cdig = norm(contact);
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
    out.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.status(200).json({ messages: out });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
