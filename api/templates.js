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

  // POST { crear: '<clave>' } -> crea una de las plantillas FIJAS de abajo y la envia a
  // aprobacion de WhatsApp. No acepta texto libre. Si ya existe, no la duplica.
  if (req.method === 'POST') {
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
    const FIJAS = {
      recordatorio_llamada: {
        nombre: 'klivox_recordatorio_llamada', categoria: 'UTILITY', variables: { 1: 'Weider', 2: '7:30 p. m.' },
        types: { 'twilio/text': { body: 'Hola {{1}} 👋 Te recordamos tu llamada con un asesor de Klivox hoy a las {{2}}. Te llamaremos a este mismo número. Si necesitas cambiarla o cancelarla, respóndenos por aquí.' } }
      },
      recordatorio_botones: {
        nombre: 'klivox_recordatorio_llamada_botones', categoria: 'UTILITY', variables: { 1: 'Weider', 2: '7:30 p. m.' },
        types: { 'twilio/quick-reply': {
          body: 'Hola {{1}} 👋 Te recordamos tu llamada con un asesor de Klivox hoy a las {{2}}. Te llamaremos a este mismo número. ¿Sigue en pie?',
          actions: [{ title: 'Confirmo', id: 'confirmo' }, { title: 'Cambiar hora', id: 'cambiar' }, { title: 'Cancelar', id: 'cancelar' }]
        } }
      },
      despues_llamada: {
        nombre: 'klivox_despues_llamada', categoria: 'UTILITY', variables: { 1: 'Weider' },
        types: { 'twilio/text': { body: 'Hola {{1}} 👋 Gracias por tu interés en Klivox. ¿Cómo te fue en la llamada con nuestro asesor? Si te quedó alguna duda o quieres avanzar, respóndenos por aquí.' } }
      }
    };
    const F = FIJAS[b.crear];
    if (!F) { res.status(400).json({ ok: false, error: 'plantilla_desconocida' }); return; }
    const NOMBRE = F.nombre;
    const jh = { Authorization: auth, 'Content-Type': 'application/json' };
    try {
      const lr = await fetch('https://content.twilio.com/v1/ContentAndApprovals?PageSize=100', { headers: { Authorization: auth } });
      const ld = await lr.json();
      let c = (ld.contents || []).find(x => x.friendly_name === NOMBRE);
      let creada = false;
      if (!c) {
        const cr = await fetch('https://content.twilio.com/v1/Content', {
          method: 'POST', headers: jh,
          body: JSON.stringify({ friendly_name: NOMBRE, language: 'es', variables: F.variables, types: F.types })
        });
        c = await cr.json();
        if (!cr.ok || !c.sid) { res.status(200).json({ ok: false, paso: 'crear', detalle: String(c.message || cr.status).slice(0, 300) }); return; }
        creada = true;
      }
      const estado = String(((c.approval_requests || {}).status) || 'unsubmitted').toLowerCase();
      let enviada = false, detalle = '';
      if (creada || estado === 'unsubmitted') {
        const ar = await fetch('https://content.twilio.com/v1/Content/' + c.sid + '/ApprovalRequests/whatsapp', {
          method: 'POST', headers: jh,
          body: JSON.stringify({ name: NOMBRE, category: F.categoria })
        });
        const ad = await ar.json().catch(() => ({}));
        enviada = ar.ok;
        detalle = String(ad.status || ad.message || ar.status).slice(0, 300);
      }
      res.status(200).json({ ok: true, creada, enviada_a_aprobacion: enviada, estado_anterior: creada ? 'no_existia' : estado, detalle });
    } catch (e) {
      res.status(200).json({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
    }
    return;
  }

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
