// api/create-template.js — Crea una plantilla de WhatsApp en Zavu (estilo Zavu) y la envía
// a revisión de Meta. Replica el formulario del dashboard de Zavu:
//   Nombre, Idioma, Categoría (UTILITY/MARKETING/AUTHENTICATION), Cuerpo, Encabezado,
//   Pie de página y Botones (máx 3).
// Flujo Zavu: POST /v1/templates (crea borrador) -> POST /v1/templates/{id}/submit (a Meta).
// Env: ZAVU_API_KEY, ZAVU_SENDER (sender con WABA, requerido para enviar a Meta), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ ok: false, error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER; // snd_... con WhatsApp Business (WABA)
  const ZAVU = 'https://api.zavu.dev/v1';
  const H = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

  const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const name = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const language = (b.language || 'es').trim();
  const category = (b.category || 'UTILITY').toUpperCase();       // UTILITY | MARKETING | AUTHENTICATION
  const body = (b.body || '').trim();
  const headerText = (b.headerText || '').trim();
  const footer = (b.footer || '').trim();
  const buttons = Array.isArray(b.buttons) ? b.buttons : [];

  if (!name || !body) { res.status(400).json({ ok: false, error: 'Faltan nombre o cuerpo del mensaje' }); return; }

  // Cuerpo del payload (Zavu: whatsappCategory; algunos entornos usan category)
  const payload = { name, language, body, whatsappCategory: category };
  if (headerText) { payload.headerType = 'text'; payload.headerContent = headerText; }
  if (footer) payload.footer = footer.slice(0, 60);
  if (buttons.length) {
    payload.buttons = buttons.slice(0, 3).map(x => {
      const btn = { type: x.type || 'quick_reply', text: (x.text || '').slice(0, 25) };
      if (btn.type === 'url' && x.url) btn.url = x.url;
      if (btn.type === 'phone' && x.phoneNumber) btn.phoneNumber = x.phoneNumber;
      return btn;
    }).filter(x => x.text);
  }

  // 1) Crear plantilla (borrador)
  let tpl, createErr;
  try {
    let r = await fetch(ZAVU + '/templates', { method: 'POST', headers: H, body: JSON.stringify(payload) });
    let d = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Reintento con 'category' en vez de 'whatsappCategory'
      const alt = Object.assign({}, payload); delete alt.whatsappCategory; alt.category = category;
      r = await fetch(ZAVU + '/templates', { method: 'POST', headers: H, body: JSON.stringify(alt) });
      d = await r.json().catch(() => ({}));
    }
    if (!r.ok) { createErr = (d && (d.message || (d.error && d.error.message))) || ('HTTP ' + r.status); }
    else { tpl = d; }
  } catch (e) { createErr = String(e); }

  if (!tpl) { res.status(200).json({ ok: false, error: createErr || 'No se pudo crear la plantilla' }); return; }
  const id = tpl.id || (tpl.template && tpl.template.id);

  // 2) Enviar a revisión de Meta (requiere sender con WABA)
  let submitted = false, submitErr = null;
  if (id && SENDER) {
    try {
      const sr = await fetch(ZAVU + '/templates/' + encodeURIComponent(id) + '/submit', {
        method: 'POST', headers: H, body: JSON.stringify({ senderId: SENDER, category })
      });
      const sd = await sr.json().catch(() => ({}));
      if (sr.ok) submitted = true;
      else submitErr = (sd && (sd.message || (sd.error && sd.error.message))) || ('HTTP ' + sr.status);
    } catch (e) { submitErr = String(e); }
  } else if (!SENDER) {
    submitErr = 'Falta conectar el número (ZAVU_SENDER): la plantilla quedó en borrador. Se enviará a Meta cuando el número esté conectado.';
  }

  res.status(200).json({ ok: true, id, name, status: tpl.status || 'draft', submitted, submitError: submitErr });
};
