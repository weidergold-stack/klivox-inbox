// Bandeja Klivox — lista los mensajes de WhatsApp desde Twilio
// Requiere env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  if (!SID || !TOKEN) { res.status(200).json({ messages: [], error: 'Faltan credenciales de Twilio' }); return; }
  const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?PageSize=200`;
    const r = await fetch(url, { headers: { Authorization: auth } });
    const d = await r.json();
    const messages = (d.messages || [])
      .filter(m => (m.from && m.from.startsWith('whatsapp:')) || (m.to && m.to.startsWith('whatsapp:')))
      .map(m => {
        // num_media viene como string ("0", "1", ...). Si hay adjunto, exponemos la
        // URL del proxy /api/media para que la bandeja pueda pintarlo (audio, imagen, etc.).
        const nm = parseInt(m.num_media || '0', 10) || 0;
        // Algunos tipos de WhatsApp (p. ej. notas de voz) llegan sin texto y Twilio/el
        // canal los deja como "[unsupported]"; en esos casos también intentamos traer el medio.
        const looksUnsupported = /^\s*\[?\s*unsupported/i.test(m.body || '');
        const hasMedia = nm > 0 || looksUnsupported;
        return {
          sid: m.sid,
          from: m.from,
          to: m.to,
          body: m.body,
          numMedia: nm,
          mediaUrl: hasMedia ? ('/api/media?sid=' + m.sid + '&i=0') : null,
          direction: m.direction,
          status: m.status,
          date: m.date_created
        };
      });
    res.status(200).json({ messages });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
