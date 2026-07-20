// Bandeja Klivox — envía una respuesta de WhatsApp por Twilio.
// Soporta dos modos:
//   1) Texto libre  -> { to, body }            (solo dentro de la ventana de 24h)
//   2) Plantilla Meta -> { to, contentSid, variables? }  (para reabrir fuera de 24h)
// Requiere env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM = process.env.TWILIO_WHATSAPP_FROM; // ej: whatsapp:+19516291096
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  let to = (body.to || '').trim();
  const text = (body.body || '').trim();
  const contentSid = (body.contentSid || '').trim();
  const variables = body.variables || null; // { "1": "Laura" }

  if (!to || (!text && !contentSid)) { res.status(400).json({ ok: false, error: 'Faltan datos' }); return; }
  if (!to.startsWith('whatsapp:')) to = 'whatsapp:' + to;

  const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');
  const params = new URLSearchParams({ From: FROM, To: to });

  if (contentSid) {
    // Envío por plantilla aprobada (permite reabrir conversaciones fuera de 24h)
    params.set('ContentSid', contentSid);
    if (variables && typeof variables === 'object') {
      params.set('ContentVariables', JSON.stringify(variables));
    }
  } else {
    params.set('Body', text);
  }

  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const d = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, error: d.message || 'error', code: d.code }); return; }
    res.status(200).json({ ok: true, sid: d.sid });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
};
