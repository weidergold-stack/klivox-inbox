// api/messages.js — historial de mensajes para la bandeja (desde Zavu).
// La DIRECCION se determina por el contacto del hilo (robusto), no por 'status':
// en Zavu los entrantes NO siempre llegan con status 'received' (p.ej. 'delivered').
// Se usan los endpoints de conversaciones: cada hilo trae su 'contactIdentifier'
// (el numero del paciente); todo mensaje cuyo 'from' sea ese contacto es entrante.
// Incluye multimedia (imagen/archivo): type + mediaUrl + filename para verlo en la bandeja.
// Reinicio (go-live): oculta el historial anterior al punto SINCE (o INBOX_SINCE).
// Devuelve el formato que espera index.html: { messages:[{direction,from,to,body,type,mediaUrl,filename,mimeType,date}] }
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
  // Punto de reinicio (go-live): oculta el historial anterior a esta fecha.
  // Se puede reajustar sin tocar el codigo con la variable de entorno INBOX_SINCE.
  const SINCE = process.env.INBOX_SINCE ? Date.parse(process.env.INBOX_SINCE) : Date.parse('2026-08-15T06:22:00Z');

  try {
    const cr = await fetch(ZAVU + '/conversations?limit=50', { headers: H });
    if (cr.status === 401) { res.status(401).json({ error: 'unauthorized_zavu' }); return; }
    const cd = await cr.json().catch(() => ({}));
    const convs = (cd && cd.items) || [];

    let messages = [];
    for (const c of convs.slice(0, 30)) {
      const contact = c.contactIdentifier || '';
      const cdig = norm(contact);
      let items = [];
      try {
        const mr = await fetch(ZAVU + '/conversations/' + encodeURIComponent(c.id) + '/messages?limit=100', { headers: H });
        const md = await mr.json().catch(() => ({}));
        items = (md && md.items) || [];
      } catch (_) { items = []; }

      for (const m of items) {
        // Reinicio: ignora todo mensaje anterior al punto SINCE.
        const mt = m.createdAt ? new Date(m.createdAt).getTime() : 0;
        if (mt && mt < SINCE) continue;
        // Entrante si el remitente es el contacto del hilo (por string exacto o por digitos).
        const inbound = !!(m.from && (m.from === contact || (cdig && norm(m.from) === cdig)));
        const ct = m.content || {};
        messages.push({
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
    }

    res.status(200).json({ messages });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
