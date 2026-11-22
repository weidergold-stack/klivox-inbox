// api/recordatorio.js — recordatorio de la llamada, 1 hora antes
//
// Lo llama el reloj del script "Agenda Klivox" (Google Apps Script) cuando una
// "Llamada Klivox" esta a una hora de empezar. Este archivo decide COMO enviarlo:
//
//  - Si la persona escribio en las ultimas 24 h  -> mensaje de texto normal.
//  - Si no                                        -> plantilla aprobada por Meta
//    (WhatsApp no deja enviar texto libre fuera de esa ventana).
//
// La plantilla se busca por nombre en Twilio, asi no hay que configurar su id:
// en cuanto Meta la aprueba, empieza a usarse sola.
//
// Requiere env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, AGENDA_CLAVE.
// Opcional: KV_REST_API_URL / KV_REST_API_TOKEN (evita recordatorios repetidos).

const PLANTILLA = 'klivox_recordatorio_llamada';
const BOT_MARK = '​'; // la misma marca invisible de api/webhook.js
const VENTANA_MS = 23 * 60 * 60 * 1000; // 23 h: una hora de margen sobre las 24 de WhatsApp

const texto = (nombre, hora) =>
  'Hola ' + nombre + ' 👋 Te recordamos tu llamada con un asesor de Klivox hoy a las ' + hora +
  '. Te llamaremos a este mismo número. Si necesitas cambiarla o cancelarla, respóndenos por aquí.';

module.exports = async (req, res) => {
  const fin = (code, obj) => res.status(code).json(obj);
  try {
    if (req.method !== 'POST') return fin(405, { ok: false, motivo: 'metodo' });
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }

    const CLAVE = process.env.AGENDA_CLAVE;
    if (!CLAVE || b.clave !== CLAVE) return fin(401, { ok: false, motivo: 'no_autorizado' });

    const SID = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM = process.env.TWILIO_WHATSAPP_FROM;
    if (!SID || !TOKEN || !FROM) return fin(200, { ok: false, motivo: 'twilio_sin_config' });

    const digitos = String(b.telefono || '').replace(/\D/g, '');
    if (digitos.length < 10) return fin(200, { ok: false, motivo: 'telefono_invalido' });
    const to = 'whatsapp:+' + digitos;
    const nombre = (String(b.nombre || '').trim().split(/\s+/)[0] || 'hola').slice(0, 40);
    const hora = String(b.hora || '').trim().slice(0, 20);
    if (!hora) return fin(200, { ok: false, motivo: 'falta_hora' });

    // Candado contra repetidos: un solo recordatorio por numero y por horario.
    const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
    const llave = 'klivox_recordado:' + digitos.slice(-10) + ':' + String(b.inicio || hora).replace(/[^0-9T]/g, '');
    const kv = async (ruta) => {
      if (!KU || !KT) return null;
      const r = await fetch(KU + ruta, { method: 'POST', headers: { Authorization: 'Bearer ' + KT } });
      const d = await r.json();
      return d ? d.result : null;
    };
    try {
      if ((await kv('/get/' + encodeURIComponent(llave))) === '1') return fin(200, { ok: true, ya_enviado: true });
    } catch (_) {}

    const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');
    const base = 'https://api.twilio.com/2010-04-01/Accounts/' + SID + '/Messages.json';

    // ¿Escribio la persona en las ultimas 24 h?
    let dentro = false;
    try {
      const lr = await fetch(base + '?PageSize=1&From=' + encodeURIComponent(to), { headers: { Authorization: auth } });
      const ld = await lr.json();
      const m = (ld.messages || [])[0];
      const ts = m && (m.date_sent || m.date_created);
      if (ts) dentro = (Date.now() - new Date(ts).getTime()) < VENTANA_MS;
    } catch (_) { dentro = false; }

    const params = new URLSearchParams({ From: FROM, To: to });
    let via;
    if (dentro) {
      params.set('Body', texto(nombre, hora) + BOT_MARK);
      via = 'texto';
    } else {
      // Fuera de la ventana: solo sirve una plantilla aprobada.
      let sid = '';
      try {
        const cr = await fetch('https://content.twilio.com/v1/ContentAndApprovals?PageSize=100', { headers: { Authorization: auth } });
        const cd = await cr.json();
        const c = (cd.contents || []).find(x =>
          x.friendly_name === PLANTILLA && String((x.approval_requests || {}).status || '').toLowerCase() === 'approved');
        if (c) sid = c.sid;
      } catch (_) {}
      if (!sid) return fin(200, { ok: false, motivo: 'sin_plantilla_aprobada' });
      params.set('ContentSid', sid);
      params.set('ContentVariables', JSON.stringify({ 1: nombre, 2: hora }));
      via = 'plantilla';
    }

    const sr = await fetch(base, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const sd = await sr.json().catch(() => ({}));
    if (!sr.ok || !sd.sid) {
      return fin(200, { ok: false, motivo: 'twilio_rechazo', detalle: String(sd.message || sr.status).slice(0, 200) });
    }

    try { await kv('/set/' + encodeURIComponent(llave) + '/1/EX/172800'); } catch (_) {}
    return fin(200, { ok: true, via });
  } catch (e) {
    return fin(200, { ok: false, motivo: 'error', detalle: String((e && e.message) || e).slice(0, 200) });
  }
};
