// api/messages.js — lista de conversaciones (hilos) para la bandeja, desde Zavu.
// IMPORTANTE: usa /v1/conversations (hilos), NO el log plano /v1/messages.
// El log plano solo trae los últimos mensajes de TODA la cuenta, así que los
// chats menos recientes desaparecían de la lista y el historial se veía
// incompleto frente a Zavu. Aquí paginamos TODAS las conversaciones y
// devolvemos el último mensaje de cada una como preview; el historial completo
// lo trae /api/thread al abrir el chat.
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER;
  const H = { Authorization: 'Bearer ' + KEY };
  if (SENDER) H['Zavu-Sender'] = SENDER;
  const ZAVU = 'https://api.zavu.dev/v1';
  try {
    const messages = [];
    let cursor = '', pages = 0;
    do {
      const url = ZAVU + '/conversations?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const r = await fetch(url, { headers: H });
      if (r.status === 401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
      const d = await r.json().catch(() => ({}));
      const items = (d && d.items) || [];
      for (const c of items) {
        const who = c.contactIdentifier || '';
        if (!who) continue;
        const lm = c.lastMessage || {};
        const inbound = lm.direction === 'inbound';
        messages.push({
          convId: c.id || '',
          id: lm.id || '',
          direction: inbound ? 'inbound' : 'outbound',
          from: inbound ? who : (c.senderId || ''),
          to: inbound ? (c.senderId || '') : who,
          body: lm.text || '',
          type: 'text',
          unread: (c.unreadCount || 0) > 0,
          date: lm.at || c.updatedAt || c.createdAt || new Date().toISOString()
        });
      }
      cursor = (d && d.nextCursor) || '';
      pages++;
    } while (cursor && pages < 40);
    res.status(200).json({ messages });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
