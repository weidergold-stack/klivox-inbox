// api/media.js — Proxy seguro de media de Twilio para mostrar imágenes/archivos en la bandeja.
// Uso: /api/media?sid=<MessageSid>&i=<indice>  -> devuelve el contenido con su content-type.
// No expone credenciales: el AccountSid/AuthToken quedan en el servidor. El MessageSid (34
// caracteres) actúa como token y solo sirve media de la propia cuenta de Twilio.
// Requiere env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
module.exports = async (req, res) => {
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const msg = String((req.query && req.query.sid) || '');
  const idx = parseInt((req.query && req.query.i) || '0', 10) || 0;
  if (!SID || !TOKEN) { res.status(500).send('config'); return; }
  // Valida que 'sid' tenga forma de SID de Twilio (2 letras + 32 hex) para evitar abuso.
  if (!/^[A-Za-z]{2}[a-fA-F0-9]{32}$/.test(msg)) { res.status(400).send('bad sid'); return; }
  const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');
  try {
    // 1) Listar la media del mensaje para obtener el sid y content-type.
    const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${msg}/Media.json`;
    const lr = await fetch(listUrl, { headers: { Authorization: auth } });
    if (!lr.ok) { res.status(404).send('no media'); return; }
    const ld = await lr.json();
    const list = (ld && ld.media_list) || [];
    const item = list[idx] || list[0];
    if (!item) { res.status(404).send('no media'); return; }
    const ct = item.content_type || 'application/octet-stream';
    // 2) Traer el binario (Twilio redirige a su CDN; fetch sigue el redirect).
    const binUrl = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${msg}/Media/${item.sid}`;
    const br = await fetch(binUrl, { headers: { Authorization: auth } });
    if (!br.ok) { res.status(502).send('media fetch'); return; }
    const buf = Buffer.from(await br.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).end(buf);
  } catch (e) {
    res.status(500).send('error');
  }
};
