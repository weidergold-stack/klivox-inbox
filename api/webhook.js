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
- No uses formato Markdown ni asteriscos para negritas; WhatsApp no los interpreta. Escribe en texto plano y natural.
- Nunca prometas cosas que no sabes.
- Manten cada respuesta enfocada, util y orientada a avanzar hacia la llamada o hacia el registro de la prueba.`;
// ============================================================================

// Aviso por Telegram: te llega a tu Telegram personal cada vez que entra un mensaje.
// Requiere env TELEGRAM_TOKEN y TELEGRAM_CHAT_ID (opcionales; si faltan, no hace nada).
async function notifyTelegram(fromNum, text) {
  const TG = process.env.TELEGRAM_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG || !CHAT) return;
  const preview = (text || '').slice(0, 300) || '(sin texto / adjunto)';
  const msg = '🔔 Nuevo mensaje en tu bandeja Klivox\n\n👤 ' + fromNum + '\n💬 ' + preview + '\n\nAbrir: https://klivox-inbox.vercel.app';
  try {
    await fetch('https://api.telegram.org/bot' + TG + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: msg, disable_web_page_preview: true })
    });
  } catch (_) {}
}

// ============================================================================
// AGENDA DE LLAMADAS (Google Calendar, via el script "Agenda Klivox").
// Solo se activa si existen las variables AGENDA_URL y AGENDA_CLAVE en Vercel.
// Sin ellas el bot se comporta como antes: pide dia y hora y avisa a un asesor.
// Las reglas duras (horario valido, sin choques, una llamada por numero) las
// hace cumplir el script del calendario, no el modelo.
// ============================================================================
const NL = String.fromCharCode(10);
// Frases con las que el bot afirma que una llamada quedo agendada.
const DICE_AGENDADA = /(te agendo|te agend[eé]|agendad[ao]|qued[oó] (programad|confirmad|reservad)|nos vemos el)/i;
const NOTA_AGENDA = '[Nota interna del sistema, no la escribio el cliente] La llamada todavia NO esta creada en la agenda. Si la persona ya eligio un horario, usa ver_horarios_disponibles y luego agendar_llamada AHORA, y confirma solo si responde ok true. Si aun no ha elegido horario, responde sin decir que quedo agendada.';
const FALLO_AGENDA = 'Tuve un inconveniente para registrar tu llamada en la agenda 🙏 Un asesor te escribe en un momento para confirmarte el horario.';
const AGENDA_TOOLS = [
  {
    name: 'ver_horarios_disponibles',
    description: 'Consulta en la agenda real los horarios libres para una llamada con un asesor de Klivox. Devuelve opciones, cada una con inicio (valor exacto para agendar) y etiqueta (texto para mostrar a la persona).',
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
    '- La llamada la hace un asesor de Klivox al mismo numero de WhatsApp desde el que escribe.'
  ].join(NL);
}

async function agendaCall(name, input, phone) {
  try {
    const payload = name === 'agendar_llamada'
      ? { accion: 'agendar', inicio: input.inicio, nombre: input.nombre, negocio: input.negocio, interes: input.interes, telefono: phone }
      : { accion: 'disponibilidad' };
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

module.exports = async (req, res) => {
  const p = req.body || {};
  const from = p.From || '';
  const body = (p.Body || '').trim();

  res.setHeader('Content-Type', 'text/xml');
  const done = () => res.status(200).send('<Response></Response>');

  try {
    if (!from.startsWith('whatsapp:')) return done();

    // Aviso a Telegram (si esta configurado)
    await notifyTelegram(from.replace('whatsapp:', ''), body);

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
        if (paused) return done();
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
    const windowMs = HUMAN_WINDOW_MIN * 60 * 1000;
    const recentHumanOutbound = msgs.some(m => {
      const isOut = (m.direction || '').startsWith('outbound');
      const isBot = (m.body || '').includes(BOT_MARK);
      const ts = m.date_sent || m.date_created;
      const t = ts ? new Date(ts).getTime() : 0;
      return isOut && !isBot && (now - t) < windowMs;
    });
    if (recentHumanOutbound) return done();

    let hist = msgs
      .map(m => ({
        role: (m.direction || '').startsWith('inbound') ? 'user' : 'assistant',
        text: (m.body || '').replace(BOT_MARK, '').trim(),
        t: m.date_created ? new Date(m.date_created).getTime() : 0
      }))
      .filter(m => m.text)
      .sort((a, b) => a.t - b.t)
      .slice(-HISTORY_MAX);

    if (body && (!hist.length || hist[hist.length - 1].text !== body)) {
      hist.push({ role: 'user', text: body, t: now });
    }

    const messages = [];
    for (const m of hist) {
      const last = messages[messages.length - 1];
      if (last && last.role === m.role) last.content += '\n' + m.text;
      else messages.push({ role: m.role, content: m.text });
    }
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length) messages.push({ role: 'user', content: body || 'Hola' });

    let reply = 'Gracias por escribir a Klivox 😊 En breve un asesor te atendera. ¿Me cuentas tu nombre y que necesitas?';
    if (KEY) {
      try {
        const agendaOn = !!(process.env.AGENDA_URL && process.env.AGENDA_CLAVE);
        const system = agendaOn ? SYSTEM_PROMPT + agendaPrompt() : SYSTEM_PROMPT;

        // Una pasada completa con el modelo: hasta 4 vueltas para consultar horarios y agendar.
        // Devuelve el texto final y si la llamada quedo DE VERDAD en la agenda.
        const pedir = async (convo) => {
          let txt = '';
          let agendada = false;
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
              results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
            }
            convo.push({ role: 'user', content: results });
          }
          return { txt, agendada };
        };

        let r = await pedir(messages.slice());

        // CANDADO: el bot no puede decir que agendo si la agenda no lo confirmo.
        // Si lo dice sin haber creado la llamada, se le exige crearla; si aun asi no
        // queda creada, se envia un mensaje honesto y lo confirma un asesor.
        if (agendaOn && !r.agendada && DICE_AGENDADA.test(r.txt)) {
          const convo2 = messages.slice();
          convo2.push({ role: 'user', content: NOTA_AGENDA });
          r = await pedir(convo2);
          if (!r.agendada && DICE_AGENDADA.test(r.txt)) r.txt = FALLO_AGENDA;
        }

        if (r.txt) reply = r.txt;
      } catch (_) { /* usa el mensaje de respaldo */ }
    }

    // Limpiar Markdown que WhatsApp no interpreta y enviar por Twilio REST
    reply = reply.replace(/\*\*/g, '').replace(/__/g, '').trim();
    const sendBody = new URLSearchParams({ From: FROM, To: from, Body: reply + BOT_MARK });
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: sendBody.toString()
    });

    return done();
  } catch (e) {
    return done();
  }
};
