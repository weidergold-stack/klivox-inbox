// lib/comun.js — piezas compartidas por las funciones de /api
//
//  - Redis (Upstash): memoria del bot.
//  - Telegram: avisos al equipo.
//  - Twilio: envio de WhatsApp, plantillas aprobadas y validacion de firma.
//  - Prospectos: una ficha por numero de WhatsApp.

const crypto = require('crypto');

const NL = String.fromCharCode(10);
const BOT_MARK = '​'; // marca invisible que llevan las respuestas del bot
const BASE_PUBLICA = 'https://klivox-inbox.vercel.app';

// ---------------------------------------------------------------- Redis ----
async function kvCmd(cmd) {
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return null;
  try {
    const r = await fetch(KU, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KT, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    });
    const d = await r.json();
    return d ? d.result : null;
  } catch (_) { return null; }
}
const kvGet = (key) => kvCmd(['GET', key]);
const kvSet = (key, value, segundos) => kvCmd(segundos ? ['SET', key, value, 'EX', segundos] : ['SET', key, value]);

// ------------------------------------------------------------- Telegram ----
async function avisar(texto) {
  const TG = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG || !CHAT) return false;
  try {
    await fetch('https://api.telegram.org/bot' + TG + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: String(texto).slice(0, 3500), disable_web_page_preview: true })
    });
    return true;
  } catch (_) { return false; }
}

// --------------------------------------------------------------- Twilio ----
function twilio() {
  const SID = process.env.TWILIO_ACCOUNT_SID, TOKEN = process.env.TWILIO_AUTH_TOKEN, FROM = process.env.TWILIO_WHATSAPP_FROM;
  if (!SID || !TOKEN || !FROM) return null;
  return {
    SID, TOKEN, FROM,
    auth: 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64'),
    mensajes: 'https://api.twilio.com/2010-04-01/Accounts/' + SID + '/Messages.json'
  };
}

const aWhatsApp = (tel) => 'whatsapp:+' + String(tel || '').replace(/\D/g, '');

// Envia un WhatsApp. Con contentSid va como plantilla; si no, como texto.
// Siempre pide a Twilio que avise el estado de entrega a /api/estado.
async function enviarWhatsApp({ to, body, contentSid, variables }) {
  const t = twilio();
  if (!t) return { ok: false, error: 'twilio_sin_config' };
  const params = new URLSearchParams({ From: t.FROM, To: to, StatusCallback: BASE_PUBLICA + '/api/estado' });
  if (contentSid) {
    params.set('ContentSid', contentSid);
    if (variables) params.set('ContentVariables', JSON.stringify(variables));
  } else {
    params.set('Body', body);
  }
  try {
    const r = await fetch(t.mensajes, {
      method: 'POST',
      headers: { Authorization: t.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.sid) return { ok: false, error: String(d.message || r.status).slice(0, 200), code: d.code };
    return { ok: true, sid: d.sid };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

// Plantillas de la cuenta, con su estado de aprobacion. { nombre: { sid, aprobada } }
async function plantillas() {
  const t = twilio();
  if (!t) return {};
  try {
    const r = await fetch('https://content.twilio.com/v1/ContentAndApprovals?PageSize=100', { headers: { Authorization: t.auth } });
    const d = await r.json();
    const out = {};
    for (const c of (d.contents || [])) {
      out[c.friendly_name] = { sid: c.sid, aprobada: String((c.approval_requests || {}).status || '').toLowerCase() === 'approved' };
    }
    return out;
  } catch (_) { return {}; }
}

// Ultimos mensajes con un numero, en cualquier direccion (mas nuevos primero).
async function mensajesCon(to, cuantos) {
  const t = twilio();
  if (!t) return [];
  const pedir = async (campo) => {
    try {
      const r = await fetch(t.mensajes + '?PageSize=' + (cuantos || 10) + '&' + campo + '=' + encodeURIComponent(to), { headers: { Authorization: t.auth } });
      const d = await r.json();
      return d.messages || [];
    } catch (_) { return []; }
  };
  const [ent, sal] = await Promise.all([pedir('From'), pedir('To')]);
  const fecha = (m) => new Date(m.date_sent || m.date_created || 0).getTime();
  return ent.concat(sal).sort((a, b) => fecha(b) - fecha(a));
}

// "Escribiendo…": muestra el indicador en el chat de la persona y marca su mensaje como leido.
// Es una funcion en beta de Twilio; si falla no pasa nada, el bot responde igual.
// El resultado del ultimo intento queda en Redis para poder revisarlo en el diagnostico.
async function escribiendo(messageSid) {
  const t = twilio();
  if (!t || !/^(SM|MM)/.test(String(messageSid || ''))) return;
  let nota = '';
  try {
    let r = await fetch('https://messaging.twilio.com/v3/Indicators/Typing.json', {
      method: 'POST', headers: { Authorization: t.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: messageSid, channel: 'whatsapp' })
    });
    nota = 'v3:' + r.status;
    if (!r.ok) {
      r = await fetch('https://messaging.twilio.com/v2/Indicators/Typing.json', {
        method: 'POST', headers: { Authorization: t.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ messageId: messageSid, channel: 'whatsapp' }).toString()
      });
      nota += ' v2:' + r.status;
    }
  } catch (e) { nota += ' error'; }
  await kvSet('klivox_typing_ultimo', nota + ' ' + new Date().toISOString(), 604800);
}

// --------------------------------------------------------------- Menus ----
// Menu de lista de WhatsApp: la persona toca una opcion en vez de escribirla.
// Solo funciona dentro de la conversacion abierta (24 h) y no necesita aprobacion de Meta.
// menu = { texto, boton, opciones: [{ titulo, descripcion }] }  (2 a 6 opciones)
const limpio = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);

function menuComoTexto(menu) {
  const ops = (menu.opciones || []).map((o, i) => (i + 1) + '. ' + limpio(o.titulo, 60) + (o.descripcion ? ' — ' + limpio(o.descripcion, 100) : ''));
  return String(menu.texto || '').trim() + NL + NL + ops.join(NL);
}

async function plantillaMenu(n) {
  const llave = 'klivox_menu_sid:' + n;
  const guardado = await kvGet(llave);
  if (guardado) return guardado;
  const t = twilio();
  const nombre = 'klivox_menu_' + n;
  const existentes = await plantillas();
  if (existentes[nombre]) { await kvSet(llave, existentes[nombre].sid); return existentes[nombre].sid; }
  const variables = { 1: 'Elige una opción', 2: 'Ver opciones' };
  const items = [];
  for (let i = 0; i < n; i++) {
    const b = 3 + i * 3;
    items.push({ item: '{{' + b + '}}', id: '{{' + (b + 1) + '}}', description: '{{' + (b + 2) + '}}' });
    variables[b] = 'Opción ' + (i + 1); variables[b + 1] = 'op' + (i + 1); variables[b + 2] = 'Detalle de la opción';
  }
  const r = await fetch('https://content.twilio.com/v1/Content', {
    method: 'POST', headers: { Authorization: t.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ friendly_name: nombre, language: 'es', variables, types: { 'twilio/list-picker': { body: '{{1}}', button: '{{2}}', items } } })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.sid) return '';
  await kvSet(llave, d.sid);
  return d.sid;
}

// Envia el menu. Si no se puede armar, devuelve ok:false y quien llama manda el texto normal.
// Si Twilio lo acepta pero luego no se entrega, /api/estado manda el texto de respaldo.
async function enviarMenu(to, menu) {
  try {
    const ops = (menu.opciones || []).filter(o => o && limpio(o.titulo, 24));
    if (!twilio() || ops.length < 2 || ops.length > 6) return { ok: false, error: 'opciones_fuera_de_rango' };
    const sid = await plantillaMenu(ops.length);
    if (!sid) return { ok: false, error: 'sin_plantilla_de_menu' };
    const variables = { 1: limpio(menu.texto, 1000) || 'Elige una opción', 2: limpio(menu.boton, 20) || 'Ver opciones' };
    ops.forEach((o, i) => {
      const b = 3 + i * 3;
      variables[b] = limpio(o.titulo, 24);
      variables[b + 1] = 'op' + (i + 1);
      variables[b + 2] = limpio(o.descripcion, 72) || limpio(o.titulo, 72);
    });
    const envio = await enviarWhatsApp({ to, contentSid: sid, variables });
    if (envio.ok) await kvSet('klivox_menu_respaldo:' + envio.sid, JSON.stringify({ to, texto: menuComoTexto(menu) }), 3600);
    return envio;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

// Firma de Twilio: comprueba que la peticion viene de Twilio y no de un tercero.
function firmaValida(req) {
  const t = twilio();
  const firma = req.headers && req.headers['x-twilio-signature'];
  if (!t || !firma) return false;
  const p = (req.body && typeof req.body === 'object') ? req.body : {};
  const cola = Object.keys(p).sort().map(k => k + (Array.isArray(p[k]) ? p[k].join('') : String(p[k]))).join('');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const urls = ['https://' + host + (req.url || ''), BASE_PUBLICA + (req.url || '')];
  for (const u of urls) {
    const esperado = crypto.createHmac('sha1', t.TOKEN).update(Buffer.from(u + cola, 'utf8')).digest('base64');
    try {
      if (esperado.length === firma.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(firma))) return true;
    } catch (_) {}
  }
  return false;
}

// Decide si se atiende una peticion que dice venir de Twilio.
// La validacion se enciende sola: mientras no se haya visto NINGUNA firma valida, se
// deja pasar todo (asi un error de configuracion no deja mudo al bot). Desde la primera
// firma valida que llega de Twilio, toda peticion sin firma valida se rechaza.
async function revisarFirma(req) {
  const valida = firmaValida(req);
  const vista = (await kvGet('klivox_firma_vista')) === '1';
  if (valida && !vista) await kvSet('klivox_firma_vista', '1');
  return { valida, exigida: vista, permitir: valida || !vista };
}

// ----------------------------------------------------------- Prospectos ----
const tel10 = (tel) => String(tel || '').replace(/\D/g, '').slice(-10);

async function leerLead(tel) {
  const v = await kvGet('klivox_lead:' + tel10(tel));
  if (!v) return null;
  try { return JSON.parse(v); } catch (_) { return null; }
}
async function guardarLead(lead) {
  if (!lead || !lead.tel) return;
  await kvSet('klivox_lead:' + tel10(lead.tel), JSON.stringify(lead));
  await kvCmd(['SADD', 'klivox_leads', tel10(lead.tel)]);
}
async function listarLeads() {
  const ids = (await kvCmd(['SMEMBERS', 'klivox_leads'])) || [];
  if (!ids.length) return [];
  const vals = (await kvCmd(['MGET'].concat(ids.slice(0, 500).map(i => 'klivox_lead:' + i)))) || [];
  const out = [];
  for (const v of vals) { if (v) { try { out.push(JSON.parse(v)); } catch (_) {} } }
  return out;
}
const nombreCorto = (lead) => {
  const n = String((lead && (lead.nombre || lead.perfil)) || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,20}$/.test(n) ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
};
const INTERES = { crm: 'CRM Klivox', clinify: 'Clinify', api_whatsapp: 'API de WhatsApp', idei: 'IDEI (instituto)', otro: 'Otro servicio', ninguno: 'Sin definir' };
function fichaTexto(lead) {
  const l = lead || {};
  return [
    '👤 ' + (l.nombre || l.perfil || 'Sin nombre') + ' · ' + (l.tel || ''),
    l.negocio ? '🏢 ' + l.negocio : '',
    '🎯 ' + (INTERES[l.interes] || 'Sin definir'),
    l.anuncio && l.anuncio.titulo ? '📣 Anuncio: ' + l.anuncio.titulo : '',
    l.resumen ? '📝 ' + l.resumen : ''
  ].filter(Boolean).join(NL);
}

// ------------------------------------------------------------------ Hora ----
// Hora de Colombia (UTC-5, sin cambio de horario). dow: 1=lunes ... 7=domingo.
function bogota(fecha) {
  const d = new Date((fecha ? new Date(fecha).getTime() : Date.now()) - 5 * 3600000);
  return { hora: d.getUTCHours(), minuto: d.getUTCMinutes(), dow: d.getUTCDay() === 0 ? 7 : d.getUTCDay() };
}

module.exports = {
  NL, BOT_MARK, BASE_PUBLICA, INTERES,
  kvCmd, kvGet, kvSet, avisar,
  twilio, aWhatsApp, enviarWhatsApp, plantillas, mensajesCon, firmaValida, revisarFirma,
  escribiendo, enviarMenu, menuComoTexto,
  tel10, leerLead, guardarLead, listarLeads, nombreCorto, fichaTexto, bogota
};
