// api/send.js — Bandeja Klivox sobre Zavu. Envía WhatsApp por la API de Zavu.
// Modos de envío:
//   1) Texto libre     -> { to, body }
//   2) Plantilla Meta  -> { to, contentSid, variables? }   (contentSid = templateId de Zavu)
//   3) Archivo (media) -> { to, mediaUrl, body? }           (PDF/imagen; body = caption)
// Opcional en cualquier envío: { replyToMessageId } -> responde citando (cita nativa).
//
// Acciones extra (fusionadas aquí para no superar el límite de 12 funciones del plan Hobby):
//   { action:'typing', messageId }         -> marca leído (✓✓ azul) y muestra "escribiendo…"
//   { action:'react',  messageId, emoji }  -> reacciona a un mensaje (emoji vacío lo quita)
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ ok: false, error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER; // snd_... (opcional si el proyecto tiene un solo sender)
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  // ---- Acciones: typing / react (no necesitan 'to') ----
  const action = (body.action || '').trim();
  if (action === 'typing' || action === 'react') {
    const id = (body.messageId || '').trim();
    if (!id) { res.status(400).json({ ok: false, error: 'falta messageId' }); return; }
    const h = { Authorization: 'Bearer ' + KEY };
    if (SENDER) h['Zavu-Sender'] = SENDER;
    try {
      if (action === 'typing') {
        const r = await fetch('https://api.zavu.dev/v1/messages/' + encodeURIComponent(id) + '/typing', { method: 'POST', headers: h });
        res.status(200).json({ ok: r.ok });
        return;
      }
      // react
      h['Content-Type'] = 'application/json';
      const emoji = (body.emoji != null ? String(body.emoji) : '');
      const r = await fetch('https://api.zavu.dev/v1/messages/' + encodeURIComponent(id) + '/reactions', {
        method: 'POST', headers: h, body: JSON.stringify({ emoji })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(200).json({ ok: false, error: (d && (d.message || d.error)) || ('HTTP ' + r.status) }); return; }
      res.status(200).json({ ok: true });
      return;
    } catch (e) {
      res.status(200).json({ ok: false, error: String(e) }); return;
    }
  }

  // ---- Envío normal ----
  let to = (body.to || '').replace('whatsapp:', '').trim();
  const text = (body.body || '').trim();
  const contentSid = (body.contentSid || '').trim(); // templateId de Zavu
  const variables = body.variables || null;          // { "1": "Laura" }
  const mediaUrl = (body.mediaUrl || '').trim();
  const replyToId = (body.replyToMessageId || '').trim(); // ID Zavu del mensaje a citar

  if (!to || (!text && !contentSid && !mediaUrl)) {
    res.status(400).json({ ok: false, error: 'Faltan datos' }); return;
  }

  const payload = { to, channel: 'whatsapp' };
  if (contentSid) {
    payload.messageType = 'template';
    payload.content = { templateId: contentSid };
    if (variables && typeof variables === 'object') payload.content.templateVariables = variables;
  } else if (mediaUrl) {
    const isImg = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(mediaUrl);
    payload.messageType = isImg ? 'image' : 'document';
    payload.content = { mediaUrl };
    if (!isImg) {
      try { payload.content.filename = decodeURIComponent(mediaUrl.split('/').pop().split('?')[0]); } catch (_) {}
    }
    if (text) payload.text = text; // caption
  } else {
    payload.text = text;
  }

  // Cita nativa de WhatsApp.
  if (replyToId) {
    payload.content = payload.content || {};
    payload.content.replyToMessageId = replyToId;
  }

  const headers = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  if (SENDER) headers['Zavu-Sender'] = SENDER;

  // Clave de idempotencia: una sola por pedido. Si hay que reintentar, Zavu
  // reconoce que es el MISMO mensaje y no lo manda dos veces (responde 409).
  payload.idempotencyKey = 'inbox-' + require('crypto').randomUUID();

  // Errores pasajeros de Zavu que se resuelven reintentando: choque de escrituras
  // simultaneas en la misma conversacion ("changed while it was being run"),
  // caidas 5xx y cortes de red. No son errores del mensaje.
  const esPasajero = (status, msg) =>
    status >= 500 || status === 0 ||
    /changed while it was being run|optimistic concurrency|try again|timeout|timed out/i.test(msg || '');
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const PAUSAS = [500, 1500]; // 3 intentos en total

  // Ultimo recurso: confirmar en Zavu si el mensaje SI quedo registrado aunque
  // la respuesta haya sido un error (asi no se le pide al equipo reenviarlo).
  const yaSalio = async (desde) => {
    try {
      const h = { Authorization: 'Bearer ' + KEY };
      if (SENDER) h['Zavu-Sender'] = SENDER;
      const lr = await fetch('https://api.zavu.dev/v1/messages?limit=30', { headers: h });
      if (!lr.ok) return null;
      const ld = await lr.json().catch(() => ({}));
      const dig = to.replace(/\D/g, '');
      const hit = ((ld && ld.items) || []).find((m) => {
        // Contactos con numero oculto (BSUID) no tienen digitos utiles: se compara el identificador tal cual.
        const igual = (m.to || '') === to || (dig.length >= 7 && (m.to || '').replace(/\D/g, '') === dig);
        if (!igual) return false;
        const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
        if (!t || t < desde - 5000) return false;
        if (contentSid) return m.messageType === 'template';
        if (mediaUrl) return ((m.content || {}).mediaUrl || '') === mediaUrl;
        return (m.text || '').trim() === text;
      });
      return hit ? (hit.id || true) : null;
    } catch (_) { return null; }
  };

  const inicio = Date.now();
  let okId = null, enviado = false, err = 'error', code;
  for (let intento = 0; intento <= PAUSAS.length; intento++) {
    let status = 0, d = {};
    try {
      const r = await fetch('https://api.zavu.dev/v1/messages', {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
      status = r.status;
      d = await r.json().catch(() => ({}));
      if (r.ok) { enviado = true; okId = (d && (d.id || (d.message && d.message.id))) || null; break; }
      // 409 en un reintento = la clave ya existe = el intento anterior SI entro.
      if (status === 409 && intento > 0) { enviado = true; break; }
      err = (d && (d.message || (d.error && d.error.message))) || ('HTTP ' + status);
      code = d && (d.code || (d.error && d.error.code));
    } catch (e) {
      err = String(e);
    }
    if (!esPasajero(status, err) || intento === PAUSAS.length) break;
    await espera(PAUSAS[intento]);
  }

  if (!enviado && esPasajero(0, err)) {
    const hit = await yaSalio(inicio);
    if (hit) { enviado = true; okId = hit === true ? null : hit; }
  }

  if (!enviado) {
    if (/changed while it was being run/i.test(err)) {
      err = 'Zavu estaba ocupado con este chat. Antes de reenviar, revisa si el mensaje ya aparece arriba en la conversación.';
    }
    res.status(200).json({ ok: false, error: err, code }); return;
  }

  res.status(200).json({ ok: true, id: okId });
};
