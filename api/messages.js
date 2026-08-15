// Bandeja Klivox — lista los mensajes de WhatsApp desde Twilio (con soporte de imágenes/archivos)
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
        const numMedia = parseInt(m.num_media || '0', 10) || 0;
        const out = { sid: m.sid, from: m.from, to: m.to, body: m.body, direction: m.direction, status: m.status, date: m.date_created };
        if (numMedia > 0) {
          out.numMedia = numMedia;
          out.type = 'media';
          out.mediaUrl = '/api/media?sid=' + encodeURIComponent(m.sid);
        }
        return out;
      });
    res.status(200).json({ messages });
  } catch (e) {
    res.status(200).json({ messages: [], error: String(e) });
  }
};
