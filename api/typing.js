// api/typing.js — marca un mensaje ENTRANTE como leído (✓✓ azules) y muestra
// "escribiendo…" al paciente. Se quita solo al responder o a los 25 s.
// POST { messageId }  -> id Zavu de un mensaje inbound de WhatsApp.
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ ok: false, error: 'unauthorized' }); return;
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const id = (body.messageId || '').trim();
  if (!id) { res.status(400).json({ ok: false, error: 'falta messageId' }); return; }
  const headers = { Authorization: 'Bearer ' + process.env.ZAVU_API_KEY };
  if (process.env.ZAVU_SENDER) headers['Zavu-Sender'] = process.env.ZAVU_SENDER;
  try {
    const r = await fetch('https://api.zavu.dev/v1/messages/' + encodeURIComponent(id) + '/typing', {
      method: 'POST', headers
    });
    // 202 = ok. No exponemos detalle; es best-effort.
    res.status(200).json({ ok: r.ok });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
};
