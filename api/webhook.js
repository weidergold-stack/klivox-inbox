// api/webhook.js
// Bot de auto-respuesta de Klivox para WhatsApp (Twilio -> Claude -> Twilio)
//
// - Twilio llama a este endpoint SOLO cuando entra un mensaje (inbound).
// - El bot marca sus respuestas con un caracter invisible (BOT_MARK): contesta
//   cada mensaje del paciente, pero se aparta si un HUMANO responde manual.
// - Lee el historial reciente en Twilio para dar contexto a Claude.
// - Limpia formato Markdown que WhatsApp no interpreta.

const HUMAN_WINDOW_MIN = 3;
const HISTORY_MAX = 12;
const MODEL = 'claude-haiku-4-5-20251001';
const BOT_MARK = '​'; // marca invisible: distingue respuestas del bot de las manuales

// ============================================================================
// BASE DE CONOCIMIENTO — edita este bloque para "alimentar" al bot.
// ============================================================================
const SYSTEM_PROMPT = `Eres el asistente virtual de WhatsApp de "Klivox".

## Quienes somos
En Klivox unimos tecnologia e inteligencia artificial para que consultorios y negocios atiendan mejor y vendan mas por WhatsApp. Nacimos de odontologos para odontologos: conocemos los sillones vacios y lo dificil que es responder a tiempo y captar pacientes. Nuestro plus: adaptamos cada proyecto a la necesidad de cada cliente.

## Que ofrecemos (3 productos principales y otros servicios)
1. CRM Klivox — US$ 97 al mes. Responde automaticamente los mensajes y agenda citas las 24 horas, como una recepcionista que nunca descansa. Sirve para odontologia y para cualquier negocio que reciba muchos mensajes y trabaje con agenda. Mas informacion en klivox.co. Para empezar se agenda una llamada donde definimos los requisitos del cliente.
2. Clinify (historiaclinify.com) — software de historia clinica para odontologia. Incluye RIPS, facturacion electronica y nomina electronica, y cumple con la ultima resolucion vigente en Colombia. Tiene 14 dias de prueba gratis: la persona se registra ella misma en historiaclinify.com y empieza de inmediato, sin llamada. El precio depende del numero de usuarios clinicos y esta publicado en la web.
3. API de WhatsApp — US$ 29 al mes. Conecta el numero del negocio a la API oficial de WhatsApp para evitar los bloqueos. Normalmente se activa en 1 dia. Para empezar se agenda una llamada donde definimos los requisitos del cliente.

Otros servicios que tambien ofrecemos:
4. Agencia de marketing: manejo de redes sociales, contenido y estrategia para atraer y fidelizar pacientes o clientes.
5. Anuncios rentables en Meta Ads: creamos y gestionamos campanas de Facebook e Instagram que atraen clientes rentables, con retorno medible.
6. Chatbot / agente de WhatsApp con IA: atencion automatizada que responde, agenda y hace seguimiento 24/7 (como esta conversacion).
7. Mielo: nuestra app de citas (dating), un desarrollo propio para conectar personas.
Tambien hacemos desarrollos a medida.
Estos otros servicios no tienen precio fijo: se cotizan segun la necesidad. Entiende primero que necesita la persona y luego propone una llamada con un asesor para darle el precio exacto.

## Precios
Si puedes dar precios, pero solo estos: CRM Klivox US$ 97 al mes y API de WhatsApp US$ 29 al mes. Para Clinify no des una cifra: explica que depende del numero de usuarios clinicos y que los precios estan en historiaclinify.com. No inventes descuentos, promociones, planes ni costos adicionales; si preguntan por algo que no esta aqui, di que un asesor lo confirma en la llamada.

## Como avanzar con cada persona
- Interesado en el CRM, en la API de WhatsApp o en cualquiera de los otros servicios: el siguiente paso es agendar una llamada. Pide su nombre, el tipo de negocio y el dia y la hora en que prefiere que lo llamen, y avisa que un asesor lo contactara para confirmarla. No confirmes tu una hora exacta.
- Interesado en Clinify: invitalo a registrar su prueba gratis de 14 dias en historiaclinify.com. Si tiene dudas que no puedas resolver, ofrece que un asesor lo contacte.
- Si necesita algo a la medida, dile que adaptamos el proyecto a su necesidad y que eso se define en la llamada.

## Atencion
24 horas.

## Contacto
Sitio web klivox.co, correo info@klivox.co y esta misma linea de WhatsApp.

## Reglas de conversacion
- Tono cercano, profesional, claro y breve. Espanol para WhatsApp: mensajes cortos (maximo 4-5 lineas), 1-2 emojis con moderacion.
- Identifica primero que le interesa (CRM, Clinify, API de WhatsApp u otro de nuestros servicios) y que tipo de negocio tiene, y responde enfocado en eso. No recites toda la lista si ya sabes cual le interesa.
- Importante: Mielo (dating) es para publico general, no para odontologos; si preguntan por Mielo, atiendelo como un producto aparte.
- Si es un saludo o el primer mensaje, presentate en 1-2 lineas y pregunta en que puede ayudar. No repitas el saludo si ya saludaste antes.
- Solo ofrecemos lo que esta en este texto. Si piden otro servicio, di con amabilidad que no esta en nuestro portafolio actual y que un asesor puede revisar su caso.
- Ante urgencias, quejas o temas complejos: no inventes datos; traslada a un asesor con calidez, avisa que le contactara muy pronto y pide su nombre y en que ayudarle.
- Puedes ver las imagenes que te envian y leer las notas de voz, que te llegan ya transcritas entre corchetes. Responde a su contenido con naturalidad, sin mencionar la transcripcion ni los corchetes. Si es una captura de un error, usala para ayudar. No hagas diagnosticos clinicos a partir de fotos.
- No uses formato Markdown ni asteriscos para negritas; WhatsApp no los interpreta. Escribe en texto plano y natural.
- Nunca prometas cosas que no sabes.
- Manten cada respuesta enfocada, util y orientada a avanzar hacia la llamada o hacia el registro de la prueba.`;
// ============================================================================

// Avisos por Telegram. Solo hay dos motivos: (1) escriben en un chat con el bot en pausa y
// (2) el bot pasa el caso a un asesor o hay novedad de una llamada (ver el final del handler).
// Requiere env TELEGRAM_TOKEN y TELEGRAM_CHAT_ID (opcionales; si faltan, no hace nada).
async function notifyTelegram(fromNum, text, lead) {
  const quien = lead && (lead.nombre || lead.perfil) ? (lead.nombre || lead.perfil) + ' · ' : '';
  const preview = (text || '').slice(0, 300) || '(sin texto: envió un adjunto)';
  await C.avisar('⏸️ Escribieron en un chat con el bot en pausa' + NL + NL + '👤 ' + quien + fromNum + NL + '💬 ' + preview + NL + NL + 'Abrir: ' + C.BASE_PUBLICA);
}

// ============================================================================
// AGENDA DE LLAMADAS (Google Calendar, via el script "Agenda Klivox").
// Solo se activa si existen las variables AGENDA_URL y AGENDA_CLAVE en Vercel.
// Sin ellas el bot se comporta como antes: pide dia y hora y avisa a un asesor.
// Las reglas duras (horario valido, sin choques, una llamada por numero) las
// hace cumplir el script del calendario, no el modelo.
// ============================================================================
const NL = String.fromCharCode(10);

// ============================================================================
// MANUALES DE SOPORTE: se leen de la carpeta manuales/ y se le entregan al modelo.
// Para corregir lo que el bot sabe de un producto se edita el manual, no este archivo.
// sonrisaspass.md NO se carga: es para pacientes del consultorio, no para este numero.
// ============================================================================
const C = require('../lib/comun');
const fs = require('fs');
const path = require('path');
function leerManual(nombre) {
  try { return fs.readFileSync(path.join(__dirname, '..', 'manuales', nombre), 'utf8'); } catch (_) { return ''; }
}
const MANUAL_CLINIFY = leerManual('clinify.md');
const MANUAL_KLIVOX = leerManual('klivox.md');
const SOPORTE = (MANUAL_CLINIFY || MANUAL_KLIVOX) ? NL + NL + [
  '## Soporte a clientes (usa los manuales de abajo)',
  'Este numero tambien da soporte a quienes ya usan nuestros productos.',
  '- Si la persona pregunta como hacer algo o tiene un problema, responde con lo que dicen los manuales: pasos concretos y en orden, en mensajes cortos. Si son muchos pasos, da los primeros y pregunta si pudo.',
  '- Si la respuesta no esta en los manuales, no la inventes: dilo con naturalidad y pasa el caso a un asesor, pidiendo el correo de su cuenta y que describa el problema.',
  '- Pasa siempre a un asesor los casos que cada manual lista en la seccion de cuando pasar a una persona (cobros, perdida de datos, bloqueos de linea, etc.).',
  '- Nunca pidas ni recibas contrasenas, numeros de tarjeta ni llaves. Si las envian, pide que no lo hagan.',
  '- No expliques como esta construido el sistema por dentro; solo como se usa.',
  '- Para vender sigue las reglas de arriba; los manuales te sirven tambien para responder dudas antes de comprar.',
  MANUAL_CLINIFY ? NL + '===== MANUAL: CLINIFY =====' + NL + MANUAL_CLINIFY : '',
  MANUAL_KLIVOX ? NL + '===== MANUAL: KLIVOX =====' + NL + MANUAL_KLIVOX : ''
].join(NL) : '';
// Frases con las que el bot afirma que una llamada quedo agendada.
const DICE_AGENDADA = /(te agendo|te agend[eé]|agendad[ao]|qued[oó] (programad|confirmad|reservad)|nos vemos el)/i;
const DICE_CAMBIADA = /(reprogramad[ao]|reagendad[ao]|cambiad[ao]|te la cambi[eé]|te la pas[eé]|qued[oó] para el)/i;
const DICE_CANCELADA = /(cancelad[ao]|te la cancel[eé]|cancel[eé] tu|he cancelado)/i;
const NOTA_AGENDA = '[Nota interna del sistema, no la escribio el cliente] La llamada todavia NO esta creada en la agenda. Si la persona ya eligio un horario, usa ver_horarios_disponibles y luego agendar_llamada AHORA, y confirma solo si responde ok true. Si aun no ha elegido horario, responde sin decir que quedo agendada.';
const NOTA_CAMBIO = '[Nota interna del sistema, no la escribio el cliente] La llamada todavia NO se ha cambiado en la agenda. Si la persona ya eligio el nuevo horario, usa ver_horarios_disponibles y luego reprogramar_llamada AHORA, y confirma solo si responde ok true. Si aun no ha elegido, ofrece las opciones sin decir que quedo cambiada.';
const NOTA_CANCELA = '[Nota interna del sistema, no la escribio el cliente] La llamada todavia NO esta cancelada en la agenda. Si la persona pidio cancelarla, usa cancelar_llamada AHORA y confirma solo si responde ok true. Si no lo pidio, no digas que quedo cancelada.';
const FALLO_AGENDA = 'Tuve un inconveniente para registrar tu llamada en la agenda 🙏 Un asesor te escribe en un momento para confirmarte el horario.';
const FALLO_CAMBIO = 'Tuve un inconveniente para hacer ese cambio en la agenda 🙏 Un asesor te escribe en un momento para confirmarlo.';
const AGENDA_TOOLS = [
  {
    name: 'ver_horarios_disponibles',
    description: 'Consulta en la agenda real los horarios libres para una llamada con un asesor de Klivox. Devuelve opciones, cada una con inicio (valor exacto para agendar o reprogramar) y etiqueta (texto para mostrar a la persona). Tambien devuelve llamada_actual: la llamada que esta persona ya tiene agendada, o null si no tiene.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'agendar_llamada',
    description: 'Crea la llamada en la agenda. Usala solo cuando la persona ya eligio una de las opciones devueltas por ver_horarios_disponibles y ya tienes su nombre.',
    input_schema: {
      type: 'object',
      properties: {
        inicio: { type: 'string', description: 'Valor inicio exacto de la opcion elegida, tal como lo devolvio ver_horarios_disponibles.' },
        nombre: { type: 'string', description: 'Nombre de la persona.' },
        negocio: { type: 'string', description: 'Tipo de negocio o consultorio.' },
        interes: { type: 'string', description: 'Producto o servicio que le interesa.' }
      },
      required: ['inicio', 'nombre']
    }
  },
  {
    name: 'reprogramar_llamada',
    description: 'Cambia de horario la llamada que esta persona ya tiene agendada. Usala cuando pida cambiarla o moverla y ya haya elegido una de las opciones devueltas por ver_horarios_disponibles.',
    input_schema: {
      type: 'object',
      properties: {
        inicio: { type: 'string', description: 'Valor inicio exacto del nuevo horario, tal como lo devolvio ver_horarios_disponibles.' }
      },
      required: ['inicio']
    }
  },
  {
    name: 'cancelar_llamada',
    description: 'Cancela la llamada que esta persona tiene agendada. Usala cuando pida cancelarla.',
    input_schema: { type: 'object', properties: {} }
  }
];

function agendaPrompt() {
  const hoy = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return NL + NL + [
    '## Agenda de llamadas (tienes herramientas)',
    'Esta seccion reemplaza la instruccion de no confirmar una hora: ahora la llamada la agendas tu.',
    'Hoy es ' + hoy + ' (hora de Colombia).',
    '- Cuando la persona quiera la llamada, usa ver_horarios_disponibles y ofrecele siempre exactamente 2 opciones numeradas, en 2 dias distintos (nunca dos horas del mismo dia). Si ninguna de las 2 le sirve, no ofrezcas mas opciones: preguntale en que dia y hora le queda mejor. Usa las etiquetas tal como las devuelve la herramienta. Nunca inventes horarios.',
    '- Para agendar necesitas su nombre y su tipo de negocio. Si faltan, pidelos en el mismo mensaje en que ofreces las opciones.',
    '- Cuando elija una opcion, vuelve a usar ver_horarios_disponibles para tomar el valor inicio exacto de esa opcion y enseguida usa agendar_llamada.',
    '- Cuando la persona diga el dia y la hora que prefiere: si coincide con una opcion de la lista de ver_horarios_disponibles, agendala; si no coincide, no agendes ni ofrezcas otras opciones: agradece, repite el horario que pidio y avisale que en un momento un asesor le confirma.',
    '- Confirma la llamada solo si agendar_llamada responde ok true, repitiendo dia y hora. Si responde ocupado, ofrece las nuevas opciones. Si responde ya_tiene_cita, recuerdale la llamada que ya tiene. Si hay un error, di que un asesor lo contactara para coordinarla.',
    '- Si la persona pide CAMBIAR su llamada: usa ver_horarios_disponibles (llamada_actual te dice la que tiene), ofrece 2 opciones en dias distintos y, cuando elija, usa reprogramar_llamada con el inicio exacto. Di que quedo cambiada solo si responde ok true. Si responde sin_cita, dile que no tiene una llamada agendada y ofrece agendar una.',
    '- Si la persona pide CANCELAR su llamada: usa cancelar_llamada de inmediato, sin insistir ni pedir motivos. Di que quedo cancelada solo si responde ok true. Si responde sin_cita, dile que no tiene una llamada agendada.',
    '- Si agendar_llamada responde ya_tiene_cita y la persona quiere otro horario, usa reprogramar_llamada en lugar de agendar otra.',
    '- El recordatorio de la llamada trae botones. Si la persona responde Confirmo, agradece y confirma que la llamaremos a esa hora, sin usar herramientas. Si responde Cambiar hora, sigue el flujo de CAMBIAR. Si responde Cancelar, sigue el flujo de CANCELAR.',
    '- La llamada la hace un asesor de Klivox al mismo numero de WhatsApp desde el que escribe.'
  ].join(NL);
}

async function agendaCall(name, input, phone) {
  try {
    let payload;
    if (name === 'agendar_llamada') payload = { accion: 'agendar', inicio: input.inicio, nombre: input.nombre, negocio: input.negocio, interes: input.interes };
    else if (name === 'reprogramar_llamada') payload = { accion: 'reprogramar', inicio: input.inicio };
    else if (name === 'cancelar_llamada') payload = { accion: 'cancelar' };
    else payload = { accion: 'disponibilidad' };
    // El telefono lo pone el servidor, nunca el modelo: asi nadie cambia la llamada de otro.
    payload.telefono = phone;
    payload.clave = process.env.AGENDA_CLAVE;
    const r = await fetch(process.env.AGENDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) {
    return { error: 'agenda_no_disponible' };
  }
}

// ============================================================================
// ADJUNTOS: fotos y notas de voz que envia la persona.
//  - Imagenes: se le pasan al modelo, que las puede ver.
//  - Notas de voz: se transcriben (Groq Whisper u otro servicio compatible con OpenAI).
//    Requiere TRANSCRIPCION_API_KEY en Vercel; sin ella el bot avisa que no pudo escucharla.
//  - Lo que se entendio de cada adjunto se guarda 7 dias en Redis, para que el bot
//    siga sabiendo que dijo el audio en los mensajes siguientes.
// ============================================================================
const TOPE_IMAGEN = 3.5 * 1024 * 1024;
const TOPE_AUDIO = 20 * 1024 * 1024;

async function bajar(url, auth, tope) {
  const r = await fetch(url, { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length && buf.length <= tope ? buf : null;
}

async function transcribir(url, auth, tipo) {
  const key = process.env.TRANSCRIPCION_API_KEY;
  if (!key) return '';
  const buf = await bajar(url, auth, TOPE_AUDIO);
  if (!buf) return '';
  const ext = tipo.includes('mpeg') ? 'mp3' : tipo.includes('mp4') ? 'm4a' : tipo.includes('wav') ? 'wav' : tipo.includes('amr') ? 'amr' : 'ogg';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: tipo }), 'audio.' + ext);
  form.append('model', process.env.TRANSCRIPCION_MODELO || 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  if (process.env.TRANSCRIPCION_IDIOMA) form.append('language', process.env.TRANSCRIPCION_IDIOMA);
  const r = await fetch(process.env.TRANSCRIPCION_URL || 'https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form
  });
  if (!r.ok) return '';
  const d = await r.json();
  return String((d && d.text) || '').trim().slice(0, 2000);
}

async function leerAdjuntos(p, auth) {
  const notas = [], imagenes = [];
  const n = Math.min(Number(p.NumMedia || 0) || 0, 4);
  for (let i = 0; i < n; i++) {
    const url = p['MediaUrl' + i];
    const tipo = String(p['MediaContentType' + i] || '').toLowerCase().split(';')[0].trim();
    if (!url) continue;
    try {
      if (/^image[/](jpeg|png|webp|gif)$/.test(tipo)) {
        if (imagenes.length >= 3) continue;
        const buf = await bajar(url, auth, TOPE_IMAGEN);
        if (!buf) { notas.push('[La persona envio una imagen que no se pudo abrir. Pidele que la reenvie o que describa lo que muestra.]'); continue; }
        imagenes.push({ type: 'image', source: { type: 'base64', media_type: tipo, data: buf.toString('base64') } });
        notas.push('[La persona envio una imagen]');
      } else if (tipo.indexOf('audio/') === 0) {
        const txt = await transcribir(url, auth, tipo);
        notas.push(txt
          ? '[Nota de voz, transcrita]: ' + txt
          : '[La persona envio una nota de voz que no pudiste escuchar. Dile con amabilidad que por ahora no pudiste escuchar ese audio y pidele que te lo escriba.]');
      } else {
        notas.push('[La persona envio un archivo (' + (tipo || 'desconocido') + ') que no puedes abrir. Dile que no puedes abrirlo y pidele que te cuente por escrito que necesita.]');
      }
    } catch (_) {
      notas.push('[La persona envio un adjunto que no se pudo leer. Pidele que te lo escriba.]');
    }
  }
  return { notas, imagenes };
}

// Memoria corta en Redis (Upstash). Si no esta configurado, no hace nada.
async function kvGet(key) {
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return null;
  try {
    const r = await fetch(KU + '/get/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + KT } });
    const d = await r.json();
    return d && typeof d.result === 'string' ? d.result : null;
  } catch (_) { return null; }
}
async function kvSet(key, value, segundos) {
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return;
  try {
    await fetch(KU, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KT, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, value, 'EX', segundos])
    });
  } catch (_) {}
}

// ============================================================================
// FICHA DEL PROSPECTO: despues de responder, una consulta corta al modelo resume
// quien es la persona, que le interesa y si necesita a un asesor. Con eso se llena
// el registro de prospectos y se decide a quien avisar y a quien hacerle seguimiento.
// ============================================================================
const FICHA_TOOL = {
  name: 'ficha',
  description: 'Registra la ficha del prospecto segun la conversacion.',
  input_schema: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre de la persona si lo dijo; si no, cadena vacia.' },
      negocio: { type: 'string', description: 'Tipo de negocio o consultorio si lo dijo; si no, cadena vacia.' },
      interes: { type: 'string', enum: ['crm', 'clinify', 'api_whatsapp', 'otro', 'ninguno'] },
      es_cliente: { type: 'boolean', description: 'true si ya usa uno de nuestros productos y pide soporte.' },
      necesita_persona: { type: 'boolean', description: 'true solo si el bot le dijo que un asesor le escribira o confirmara algo que quedo pendiente, o si la persona pide hablar con una persona, o hay queja, cobro o urgencia. Una llamada que ya quedo agendada, cambiada o cancelada en la agenda NO cuenta: eso es false.' },
      motivo_persona: { type: 'string', description: 'Por que necesita a una persona, en pocas palabras; si no aplica, cadena vacia.' },
      no_contactar: { type: 'boolean', description: 'true si la persona pidio que no le escriban mas.' },
      resumen: { type: 'string', description: 'Resumen de 1 o 2 frases de lo que quiere y en que quedo.' }
    },
    required: ['nombre', 'negocio', 'interes', 'es_cliente', 'necesita_persona', 'motivo_persona', 'no_contactar', 'resumen']
  }
};

async function sacarFicha(KEY, messages, reply) {
  const texto = (c) => Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(NL) : String(c || '');
  const guion = messages.slice(-12).map(m => (m.role === 'user' ? 'Cliente: ' : 'Bot: ') + texto(m.content)).join(NL) + NL + 'Bot: ' + reply;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 350,
      system: 'Lees conversaciones de WhatsApp entre un cliente y el bot de Klivox (CRM con IA, Clinify historia clinica, API de WhatsApp) y llenas la ficha del prospecto. Usa solo lo que dice la conversacion; no inventes.',
      tools: [FICHA_TOOL], tool_choice: { type: 'tool', name: 'ficha' },
      messages: [{ role: 'user', content: guion.slice(-6000) }]
    })
  });
  const d = await r.json();
  const u = ((d && d.content) || []).find(b => b.type === 'tool_use');
  return u ? u.input : null;
}

module.exports = async (req, res) => {
  // Diagnostico: /api/webhook?diag=1 dice si los manuales estan cargados (solo tamanos).
  if (req.method === 'GET' && req.query && req.query.diag) {
    return res.status(200).json({ manual_clinify: MANUAL_CLINIFY.length, manual_klivox: MANUAL_KLIVOX.length, transcripcion_de_audios: !!process.env.TRANSCRIPCION_API_KEY, firma_twilio_exigida: (await C.kvGet('klivox_firma_vista')) === '1' });
  }
  const p = req.body || {};
  const from = p.From || '';
  const body = (p.Body || '').trim();

  res.setHeader('Content-Type', 'text/xml');
  const done = () => res.status(200).send('<Response></Response>');

  try {
    if (!from.startsWith('whatsapp:')) return done();

    // Seguridad: solo se atiende a Twilio. Ver revisarFirma en lib/comun.js.
    const firma = await C.revisarFirma(req);
    if (!firma.permitir) return res.status(403).send('<Response></Response>');

    // Registro de prospectos: una ficha por numero. Se actualiza aunque el bot este en pausa.
    const t0 = Date.now();
    let lead = await C.leerLead(from);
    const esNuevo = !lead;
    if (!lead) lead = { tel: from.replace('whatsapp:', ''), primer: t0, mensajes: 0, seguimientos: [], enviados: [] };
    lead.ultimoIn = t0;
    lead.mensajes = (lead.mensajes || 0) + 1;
    if (p.ProfileName) lead.perfil = String(p.ProfileName).slice(0, 60);
    // Si llego desde un anuncio de clic a WhatsApp, Twilio entrega el titular y el enlace.
    if (!lead.anuncio && (p.ReferralHeadline || p.ReferralSourceUrl)) {
      lead.anuncio = {
        titulo: String(p.ReferralHeadline || p.ReferralBody || '').slice(0, 160),
        url: String(p.ReferralSourceUrl || '').slice(0, 300),
        tipo: String(p.ReferralSourceType || '').slice(0, 30)
      };
    }
    await C.guardarLead(lead);


    // Interruptor de pausa (Redis/Upstash).
    // Regla (la misma de api/bot-state.js): lo que se elige en un chat manda sobre el global;
    // un chat sin eleccion propia sigue al interruptor global.
    // La llave del chat usa los ultimos 10 digitos, asi coincide aunque el numero
    // este guardado con o sin +57 en la bandeja.
    try {
      const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
      if (KU && KT) {
        const chatKey = 'klivox_paused:' + from.replace(/\D/g, '').slice(-10);
        const pr = await fetch(`${KU}/mget/${encodeURIComponent(chatKey)}/klivox_bot_paused`, { headers: { Authorization: `Bearer ${KT}` } });
        const pd = await pr.json();
        const v = (pd && pd.result) || [];
        const own = v[0] === '1' || v[0] === '0';
        const paused = own ? v[0] === '1' : v[1] === '1';
        if (paused) {
          // Aviso al equipo: escribieron en un chat que el bot NO esta atendiendo.
          await notifyTelegram(from.replace('whatsapp:', ''), body, lead);
          return done();
        }
      }
    } catch (_) {}

    const SID = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM = process.env.TWILIO_WHATSAPP_FROM;
    const KEY = process.env.ANTHROPIC_API_KEY;
    if (!SID || !TOKEN || !FROM) return done();

    const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    const patientNum = from.replace('whatsapp:', '');

    const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?PageSize=50`;
    let msgs = [];
    try {
      const lr = await fetch(listUrl, { headers: { Authorization: auth } });
      const ld = await lr.json();
      msgs = (ld.messages || []).filter(m => {
        const f = m.from || '', t = m.to || '';
        return f.includes(patientNum) || t.includes(patientNum);
      });
    } catch (_) { msgs = []; }

    const now = Date.now();
    // Un contacto que ya tenia historia antes de hoy no es prospecto nuevo: no se le hace seguimiento automatico.
    if (esNuevo && msgs.some(m => (now - new Date(m.date_sent || m.date_created || now).getTime()) > 24 * 3600000)) {
      lead.antiguo = true;
      await C.guardarLead(lead);
    }
    const windowMs = HUMAN_WINDOW_MIN * 60 * 1000;
    const recentHumanOutbound = msgs.some(m => {
      const isOut = (m.direction || '').startsWith('outbound');
      // El recordatorio por plantilla no lleva la marca invisible: se reconoce por su texto.
      const isBot = (m.body || '').includes(BOT_MARK) || (m.body || '').includes('Te recordamos tu llamada con un asesor de Klivox') || (lead.enviados || []).includes(m.sid);
      const ts = m.date_sent || m.date_created;
      const t = ts ? new Date(ts).getTime() : 0;
      return isOut && !isBot && (now - t) < windowMs;
    });
    if (recentHumanOutbound) return done();

    // Adjuntos del mensaje que acaba de entrar.
    const sidMsg = String(p.MessageSid || p.SmsMessageSid || '');
    const adj = await leerAdjuntos(p, auth);
    if (sidMsg && adj.notas.length) await kvSet('klivox_adj:' + sidMsg, adj.notas.join(NL), 604800);

    // Adjuntos de mensajes anteriores: se recupera lo que se entendio de cada uno.
    const previos = {};
    await Promise.all(msgs
      .filter(m => m.sid !== sidMsg && (m.direction || '').startsWith('inbound') && !(m.body || '').trim() && Number(m.num_media) > 0)
      .slice(0, 8)
      .map(async m => { const v = await kvGet('klivox_adj:' + m.sid); if (v) previos[m.sid] = v; }));

    let hist = msgs
      .filter(m => !sidMsg || m.sid !== sidMsg) // el mensaje actual se agrega abajo, con sus adjuntos
      .map(m => ({
        role: (m.direction || '').startsWith('inbound') ? 'user' : 'assistant',
        text: (m.body || '').replace(BOT_MARK, '').trim() || previos[m.sid] || '',
        t: m.date_created ? new Date(m.date_created).getTime() : 0
      }))
      .filter(m => m.text)
      .sort((a, b) => a.t - b.t)
      .slice(-HISTORY_MAX);

    const actual = [body].concat(adj.notas).filter(Boolean).join(NL);
    if (actual && (sidMsg || !hist.length || hist[hist.length - 1].text !== actual)) {
      hist.push({ role: 'user', text: actual, t: now });
    }

    const messages = [];
    for (const m of hist) {
      const last = messages[messages.length - 1];
      if (last && last.role === m.role) last.content += NL + m.text;
      else messages.push({ role: m.role, content: m.text });
    }
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length) messages.push({ role: 'user', content: actual || 'Hola' });

    // Las imagenes van pegadas al ultimo mensaje de la persona, para que el modelo las vea.
    if (adj.imagenes.length) {
      const ult = messages[messages.length - 1];
      if (ult.role === 'user') ult.content = [{ type: 'text', text: String(ult.content) }].concat(adj.imagenes);
    }

    const eventos = [];      // lo que la agenda confirmo en este turno (agendada, cambiada, cancelada)
    let falloAgenda = false; // el bot no logro registrar algo en la agenda
    let reply = 'Gracias por escribir a Klivox 😊 En breve un asesor te atendera. ¿Me cuentas tu nombre y que necesitas?';
    if (KEY) {
      try {
        const agendaOn = !!(process.env.AGENDA_URL && process.env.AGENDA_CLAVE);
        // El bloque fijo (conocimiento + manuales) va en cache; la agenda cambia con la hora y va aparte.
        const system = [{ type: 'text', text: SYSTEM_PROMPT + SOPORTE, cache_control: { type: 'ephemeral' } }];
        if (agendaOn) system.push({ type: 'text', text: agendaPrompt().trim() });

        // Una pasada completa con el modelo: hasta 4 vueltas para consultar horarios y agendar.
        // Devuelve el texto final y si la llamada quedo DE VERDAD en la agenda.
        const pedir = async (convo) => {
          let txt = '';
          let agendada = false, cambiada = false, cancelada = false;
          for (let i = 0; i < 4; i++) {
            const reqBody = { model: MODEL, max_tokens: 500, system, messages: convo };
            if (agendaOn) reqBody.tools = AGENDA_TOOLS;
            const ar = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-api-key': KEY,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify(reqBody)
            });
            const ad = await ar.json();
            const blocks = (ad && ad.content) || [];
            const uses = blocks.filter(b => b.type === 'tool_use');
            if (ad.stop_reason !== 'tool_use' || !uses.length) {
              txt = blocks.filter(b => b.type === 'text').map(b => b.text).join(NL).trim();
              break;
            }
            convo.push({ role: 'assistant', content: blocks });
            const results = [];
            for (const u of uses) {
              const out = await agendaCall(u.name, u.input || {}, patientNum);
              // Cuenta como agendada si se acaba de crear o si la agenda confirma que ya existe.
              if (u.name === 'agendar_llamada' && out && (out.ok === true || out.motivo === 'ya_tiene_cita')) agendada = true;
              if (u.name === 'reprogramar_llamada' && out && out.ok === true) { cambiada = true; agendada = true; }
              if (u.name === 'cancelar_llamada' && out && (out.ok === true || out.motivo === 'sin_cita')) cancelada = true;
              if (out && out.ok === true) {
                if (u.name === 'agendar_llamada') eventos.push({ tipo: 'agendada', etiqueta: out.etiqueta });
                if (u.name === 'reprogramar_llamada') eventos.push({ tipo: 'cambiada', etiqueta: out.etiqueta, anterior: out.anterior });
                if (u.name === 'cancelar_llamada') eventos.push({ tipo: 'cancelada', etiqueta: out.cancelada });
              }
              if (u.name === 'ver_horarios_disponibles' && out && !out.error && 'llamada_actual' in out) lead.llamada = out.llamada_actual || null;
              results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
            }
            convo.push({ role: 'user', content: results });
          }
          return { txt, agendada, cambiada, cancelada };
        };

        let r = await pedir(messages.slice());

        // CANDADO: el bot no puede afirmar que agendo, cambio o cancelo una llamada si la
        // agenda no lo confirmo en este mismo turno. Si lo afirma sin haberlo hecho, se le
        // exige hacerlo; si aun asi no queda hecho, sale un mensaje honesto y confirma un asesor.
        const falta = (x) => {
          if (!agendaOn) return null;
          if (!x.cancelada && DICE_CANCELADA.test(x.txt)) return { tipo: 'cancelada', nota: NOTA_CANCELA, fallo: FALLO_CAMBIO };
          if (x.cancelada) return null; // hablar de la llamada que se acaba de cancelar es correcto
          if (x.agendada) return null;  // se creo, se movio o la agenda confirmo que existe
          if (DICE_CAMBIADA.test(x.txt)) return { tipo: 'cambiada', nota: NOTA_CAMBIO, fallo: FALLO_CAMBIO };
          if (DICE_AGENDADA.test(x.txt)) return { tipo: 'agendada', nota: NOTA_AGENDA, fallo: FALLO_AGENDA };
          return null;
        };
        const f1 = falta(r);
        if (f1) {
          // Antes de corregir al modelo se mira la agenda: puede estar diciendo algo cierto
          // que viene de un turno anterior (por ejemplo, recordar una llamada ya agendada).
          const est = await agendaCall('ver_horarios_disponibles', {}, patientNum);
          const actual = est && est.llamada_actual ? String(est.llamada_actual) : '';
          const dia = actual.split(' ')[0];
          const dicho = r.txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const yaEsVerdad =
            (f1.tipo === 'agendada' && !!dia && dicho.includes(dia)) ||
            (f1.tipo === 'cancelada' && !!est && !est.error && !actual);
          if (!yaEsVerdad) {
            const convo2 = messages.slice();
            convo2.push({ role: 'user', content: f1.nota });
            r = await pedir(convo2);
            const f2 = falta(r);
            if (f2) { r.txt = f2.fallo; falloAgenda = true; }
          }
        }

        if (r.txt) reply = r.txt;
      } catch (_) { /* usa el mensaje de respaldo */ }
    }

    // Limpiar Markdown que WhatsApp no interpreta y enviar por Twilio REST
    reply = reply.replace(/\*\*/g, '').replace(/__/g, '').trim();
    const sendBody = new URLSearchParams({ From: FROM, To: from, Body: reply + BOT_MARK, StatusCallback: C.BASE_PUBLICA + '/api/estado' });
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: sendBody.toString()
    });

    // ---- Despues de responder: ficha del prospecto y avisos al equipo ----
    try {
      lead.ultimoOut = Date.now();
      for (const ev of eventos) {
        lead.llamada = ev.tipo === 'cancelada' ? null : ev.etiqueta;
        lead.confirmo = null;
      }
      const confirmo = /^confirmo[.!]?$/i.test(body) && !!lead.llamada;
      if (confirmo) lead.confirmo = Date.now();

      let ficha = null;
      if (KEY) { try { ficha = await sacarFicha(KEY, messages, reply); } catch (_) { ficha = null; } }
      if (ficha) {
        if (ficha.nombre) lead.nombre = String(ficha.nombre).slice(0, 80);
        if (ficha.negocio) lead.negocio = String(ficha.negocio).slice(0, 120);
        if (ficha.interes && (ficha.interes !== 'ninguno' || !lead.interes)) lead.interes = ficha.interes;
        if (ficha.es_cliente) lead.cliente = true;
        if (ficha.no_contactar) lead.noSeguir = true;
        if (ficha.resumen) lead.resumen = String(ficha.resumen).slice(0, 400);
      }

      const TIT = { agendada: '📅 Llamada agendada', cambiada: '🔁 Llamada cambiada', cancelada: '❌ Llamada cancelada' };
      for (const ev of eventos) {
        await C.avisar(TIT[ev.tipo] + ': ' + (ev.etiqueta || '') + (ev.anterior ? ' (antes: ' + ev.anterior + ')' : '') + NL + C.fichaTexto(lead));
      }
      if (confirmo) await C.avisar('✅ Confirmó su llamada: ' + lead.llamada + NL + C.fichaTexto(lead));
      if (falloAgenda) {
        await C.avisar('⚠️ El bot no pudo registrar un cambio en la agenda y le dijo que un asesor lo confirma. Revisar y escribirle.' + NL + C.fichaTexto(lead));
        lead.asesor = { ts: Date.now(), motivo: 'Fallo de agenda' };
      } else if (ficha && ficha.necesita_persona && !eventos.length && (!lead.asesor || Date.now() - lead.asesor.ts > 6 * 3600000)) {
        lead.asesor = { ts: Date.now(), motivo: String(ficha.motivo_persona || '').slice(0, 160) };
        await C.avisar('🙋 Necesita a un asesor' + (lead.asesor.motivo ? ': ' + lead.asesor.motivo : '') + NL + C.fichaTexto(lead) + NL + 'Abrir: ' + C.BASE_PUBLICA);
      }
      await C.guardarLead(lead);
    } catch (_) {}

    return done();
  } catch (e) {
    return done();
  }
};
