// api/messages.js — LISTA de conversaciones (rapida) desde Zavu.
// Devuelve UN mensaje por conversacion (el ultimo) para pintar la lista al instante.
// Los mensajes completos de cada chat se cargan en /api/thread al abrirlo.
// Solo pagina /conversations (1-2 llamadas): rapido y sin saturar el rate limit.
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER;
  const ZAVU = 'https://api.zavu.dev/v1';
  const H = { Authorization: 'Bearer ' + KEY };
  if (SENDER) H['Zavu-Sender'] = SENDER;

  const MAX_PAGES = 20;
  const MAX_CONVS = 500;
  try {
    let convs = [], cursor = '', pages = 0;
    do {
      const url = ZAVU + '/conversations?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const cr = await fetch(url, { headers: H });
      if (cr.status === 401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
      const cd = await cr.json().catch(() => ({}));
      const items = (cd && cd.items) || [];
      convs = convs.concat(items);
      cursor = (cd && cd.nextCursor) || '';
      pages++;
    } while (cursor && pages < MAX_PAGES && convs.length < MAX_CONVS);

    const messages = [];
    for (const c of convs) {
      const contact = c.contactIdentifier || '';
      if (!contact) continue;
      const lm = c.lastMessage || {};
      const inbound = lm.direction === 'inbound';
      messages.push({
        direction: inbound ? 'inbound' : 'outbound',
        from: inbound ? contact : '',
        to: inbound ? '' : contact,
        body: lm.text || '',
        type: 'text',
        mediaUrl: '', filename: '', mimeType: '',
        date: lm.at || c.updatedAt || c.createdAt || new Date().toISOString(),
        convId: c.id || '',
        unread: (c.unreadCount || 0) > 0
      });
    }
    res.status(200).json({ messages });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
