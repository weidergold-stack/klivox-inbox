// lib/botstate.js — estado del bot POR CHAT (Upstash Redis), aislado por bandeja (INBOX_NS).
//
// Modelo:
//   botknown:<NS>   conjunto con todos los contactos que YA tienen historial.
//   boton:<NS>      conjunto con los contactos que tienen el bot ENCENDIDO.
//   botseeded:<NS>  fecha en que se marcaron como "conocidos" los chats que ya existian.
//
// Regla: un contacto que escribe por primera vez (no esta en botknown y no tiene
// historial en Zavu) entra con el bot encendido. Todos los demas quedan apagados
// hasta que alguien lo encienda a mano desde la bandeja.

const NS = process.env.INBOX_NS || 'default';
const K_KNOWN = 'botknown:' + NS;
const K_ON = 'boton:' + NS;
const K_SEEDED = 'botseeded:' + NS;
const K_GLOBAL_PAUSE = 'botpaused:' + NS;
const K_LIA = 'botlia:' + NS; // chats que Lia ya conoce (se le paso al menos un mensaje)

// ---- Puente con Lia (el bot del consultorio, el mismo que atiende en el CRM) ----
// Con PUENTE_SECRET configurado, quien responde en los chats con el bot encendido
// es Lia: la bandeja le pasa el mensaje y Lia devuelve la respuesta por /api/webhook.
const LIA_URL = (process.env.LIA_URL || 'https://cita.kromagrupo.com').replace(/\/+$/, '');
function liaReady() { return !!process.env.PUENTE_SECRET; }

// El contacto tal como lo usa Zavu: "+573001234567", o el usuario sin numero tal cual.
function canon(v) {
  const s = String(v || '').replace('whatsapp:', '').trim();
  if (!s) return '';
  if (/[A-Za-z]/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  return d ? '+' + d : '';
}

// Le avisa algo a Lia. Devuelve su respuesta, o null si no se pudo.
async function lia(evento, de, extra, ms) {
  if (!liaReady()) return null;
  const dest = canon(de);
  if (!dest) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 8000);
    const r = await fetch(LIA_URL + '/api/zavu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-puente-secret': process.env.PUENTE_SECRET },
      body: JSON.stringify(Object.assign({ evento, de: dest }, extra || {})),
      signal: ctl.signal
    });
    clearTimeout(t);
    const d = await r.json().catch(() => null);
    return (r.ok && d) ? d : null;
  } catch (_) { return null; }
}

// ¿Lia ya conoce este chat?
async function liaKnows(num) {
  const id = chatId(num);
  if (!id || !liaReady()) return false;
  const r = await pipeline([['SISMEMBER', K_LIA, id]]);
  return !!(r && Number(r[0]) === 1);
}

// Identificador estable del contacto: sirve igual para "+57 318 605 3827",
// "573186053827" y para los contactos con numero oculto ("CO.1427565742865374").
function chatId(v) {
  return String(v || '').replace('whatsapp:', '').replace(/[^0-9A-Za-z]/g, '').toLowerCase();
}

function kvReady() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Ejecuta varios comandos de Redis en una sola llamada. Devuelve un arreglo con
// el resultado de cada uno, o null si Redis no esta disponible.
async function pipeline(cmds) {
  if (!kvReady() || !cmds.length) return null;
  try {
    const r = await fetch(process.env.KV_REST_API_URL + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds)
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d)) return null;
    return d.map(x => (x && Object.prototype.hasOwnProperty.call(x, 'result')) ? x.result : null);
  } catch (_) { return null; }
}

async function isOn(num) {
  const id = chatId(num);
  if (!id) return false;
  const r = await pipeline([['SISMEMBER', K_ON, id]]);
  return !!(r && Number(r[0]) === 1);
}

// Enciende o apaga el bot en un chat. Al tocarlo a mano el contacto queda como conocido.
async function setOn(num, on) {
  const id = chatId(num);
  if (!id) return false;
  const r = await pipeline([['SADD', K_KNOWN, id], [on ? 'SADD' : 'SREM', K_ON, id]]);
  return !!r;
}

// Una persona del equipo escribio en el chat: el contacto ya tiene historial y el bot se apaga ahi.
async function humanTookOver(num) {
  return setOn(num, false);
}

async function listOn() {
  const r = await pipeline([['SMEMBERS', K_ON], ['GET', K_SEEDED], ['SCARD', K_KNOWN]]);
  if (!r) return { on: [], seeded: null, known: 0, kv: false };
  return { on: Array.isArray(r[0]) ? r[0] : [], seeded: r[1] || null, known: Number(r[2]) || 0, kv: true };
}

// Marca como conocidos los contactos indicados (no enciende ni apaga nada).
async function markKnown(ids) {
  const clean = (ids || []).map(chatId).filter(Boolean);
  let added = 0;
  for (let i = 0; i < clean.length; i += 500) {
    const r = await pipeline([['SADD', K_KNOWN].concat(clean.slice(i, i + 500))]);
    if (!r) return null;
    added += Number(r[0]) || 0;
  }
  return added;
}

async function setSeeded() {
  const r = await pipeline([['SET', K_SEEDED, new Date().toISOString(), 'NX'], ['GET', K_SEEDED]]);
  return r ? r[1] : null;
}

module.exports = {
  NS, K_KNOWN, K_ON, K_SEEDED, K_GLOBAL_PAUSE, K_LIA,
  liaReady, canon, lia, liaKnows,
  chatId, kvReady, pipeline, isOn, setOn, humanTookOver, listOn, markKnown, setSeeded
};
