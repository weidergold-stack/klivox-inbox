// Bandeja Klivox — lista las plantillas de contenido (Meta/WhatsApp) y su estado
// de aprobación, usando la Twilio Content API (ContentAndApprovals).
// Requiere env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  if (!SID || !TOKEN) { res.status(200).json({ templates: [], error: 'Faltan credenciales' }); return; }
  const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');

  try {
    const url = 'https://content.twilio.com/v1/ContentAndApprovals?PageSize=100';
    const r = await fetch(url, { headers: { Authorization: auth } });
    const d = await r.json();
    const contents = d.contents || [];

    const templates = contents.map(c => {
      const types = c.types || {};
      // Extrae el cuerpo y los botones según el tipo de contenido
      let body = '';
      let buttons = [];
      if (types['twilio/text']) {
        body = types['twilio/text'].body || '';
      } else if (types['twilio/quick-reply']) {
        body = types['twilio/quick-reply'].body || '';
        buttons = (types['twilio/quick-reply'].actions || []).map(a => a.title);
      } else if (types['twilio/call-to-action']) {
        body = types['twilio/call-to-action'].body || '';
        buttons = (types['twilio/call-to-action'].actions || []).map(a => a.title);
      } else {
        // toma el primer tipo con body disponible
        const first = Object.values(types)[0] || {};
        body = first.body || '';
      }

      // Estado de aprobación de WhatsApp
      const ap = c.approval_requests || {};
      const rawStatus = (ap.status || 'unsubmitted').toLowerCase();
      let status = 'pending';
      if (rawStatus === 'approved') status = 'approved';
      else if (rawStatus === 'rejected') status = 'rejected';
      else status = 'pending'; // received / pending / unsubmitted / submitted

      // Cuenta las variables {{n}} para saber cuántas pide la plantilla
      const varCount = (body.match(/\{\{\s*\d+\s*\}\}/g) || []).length;

      return {
        sid: c.sid,
        name: c.friendly_name || '',
        language: c.language || '',
        body,
        buttons,
        status,
        rawStatus,
        varCount
      };
    });

    // Orden: aprobadas primero, luego pendientes, luego rechazadas
    const rank = { approved: 0, pending: 1, rejected: 2 };
    templates.sort((a, b) => (rank[a.status] - rank[b.status]) || a.name.localeCompare(b.name));

    res.status(200).json({ templates });
  } catch (e) {
    res.status(200).json({ templates: [], error: String(e) });
  }
};
