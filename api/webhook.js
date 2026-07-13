// api/webhook.js
// Bot de auto-respuesta de Klivox para WhatsApp (Twilio -> Claude -> Twilio)
//
// Comportamiento clave:
//  - Twilio llama a este endpoint SOLO cuando entra un mensaje (inbound).
//  - Si un humano ya respondió a ese contacto en los ultimos HUMAN_WINDOW_MIN
//    minutos, el bot se calla y deja que la persona atienda (no se pisan).
//  - Lee el historial reciente en Twilio para dar contexto a Claude (no repite
//    el saludo y mantiene coherencia en varios turnos).
//  - Si no hay ANTHROPIC_API_KEY o Claude falla, envia un mensaje de respaldo.

const HUMAN_WINDOW_MIN = 3;      // si tu respondiste hace <3 min, el bot no interviene
const HISTORY_MAX = 12;          // turnos de contexto que se le pasan a Claude
const MODEL = 'claude-haiku-4-5-20251001';
const BOT_MARK = '\u200B'; // marca invisible: distingue respuestas del bot de las manuales

// ============================================================================
// BASE DE CONOCIMIENTO — edita este bloque para "alimentar" al bot.
// ============================================================================
const SYSTEM_PROMPT = `Eres el asistente virtual de WhatsApp de "Klivox Automatizaciones".

## Quienes somos
Somos expertos en tecnologia e inteligencia artificial para consultorios y clinicas odontologicas, y tambien desarrollamos tecnologia para otros ambitos de la salud y de lo social. Nacimos de odontologos para odontologos: conocemos el mercado, los sillones vacios y lo dificil que es captar pacientes. En la universidad no nos ensenaron marketing ni ventas, y por eso existimos: para ayudarte a llenar tu consulta, automatizarla y aumentar tus ventas.

Ademas somos agencia de marketing: manejamos redes sociales y hacemos anuncios rentables para atraer pacientes rentables al consultorio. Cubrimos todo el proceso: llevar contenido al usuario, agendarlo, llevarlo al consultorio, venderle, hacerle seguimiento y darle recompensas.

## Servicios
- Historia clinica digital y CRM
- Chatbot de atencion automatizada
- Agendamiento automatico y apps de agendamiento
- Captacion de pacientes con flujos de IA
- Marketing digital: manejo de redes y anuncios rentables
- Sistemas de fidelizacion y recompensas
- Planeacion 3D de implantes
- Diseno de guias quirurgicas para colocacion de implantes
- Desarrollos a medida
- Desarrollo de Mielo (una app de citas / dating)

## Precios
Nunca des precios ni cifras. Primero entiende bien la idea o necesidad del prospecto (que tipo de consultorio/negocio tiene, que problema quiere resolver, que servicio le interesa). Cuando tengas clara la necesidad, remite a un asesor para que le de un precio exacto, y pide su nombre para agilizar el contacto.

## Atencion
Atencion 24 horas.

## Contacto
Sitio web klivox.co, correo info@klivox.co y esta misma linea de WhatsApp.

## Reglas de conversacion
- Tono cercano, profesional, claro y breve. Escribe en espanol para chat de WhatsApp: mensajes cortos (maximo 4-5 lineas), puedes usar 1-2 emojis con moderacion.
- Si es el primer mensaje o un saludo, presenta a Klivox en 1-2 lineas y pregunta en que puede ayudar. No repitas el saludo si ya saludaste antes en la conversacion.
- Responde dudas sobre los servicios de forma concreta y con lenguaje simple.
- Haz preguntas para entender el proyecto del prospecto antes de proponer soluciones.
- Ante urgencias, quejas, solicitud de agendar, pedido de precio/cotizacion, o cualquier tema complejo o sensible: NO inventes datos; traslada a un asesor con calidez, avisa que le contactara muy pronto y pide su nombre y en que puede ayudarle.
- Nunca prometas cosas que no sabes ni des precios especificos.
- Manten cada respuesta enfocada, util y orientada a avanzar hacia una conversacion con el equipo.`;
// ============================================================================

module.exports = async (req, res) => {
  // Twilio manda application/x-www-form-urlencoded; Vercel lo parsea en req.body
  const p = req.body || {};
  const from = p.From || '';       // whatsapp:+57...
  const body = (p.Body || '').trim();

  res.setHeader('Content-Type', 'text/xml');
  const done = () => res.status(200).send('<Response></Response>');

  try {
    if (!from.startsWith('whatsapp:')) return done();

    const SID = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM = process.env.TWILIO_WHATSAPP_FROM; // whatsapp:+...
    const KEY = process.env.ANTHROPIC_API_KEY;
    if (!SID || !TOKEN || !FROM) return done();

    const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    const patientNum = from.replace('whatsapp:', '');

    // 1) Traer mensajes recientes de este contacto
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

    // 2) Backoff humano: si hay un outbound reciente, el bot no interviene
    const now = Date.now();
    const windowMs = HUMAN_WINDOW_MIN * 60 * 1000;
    const recentHumanOutbound = msgs.some(m => {
      const isOut = (m.direction || '').startsWith('outbound');
      const isBot = (m.body || '').includes(BOT_MARK);
      const ts = m.date_sent || m.date_created;
      const t = ts ? new Date(ts).getTime() : 0;
      return isOut && !isBot && (now - t) < windowMs;
    });
    if (recentHumanOutbound) return done(); // solo se aparta si un HUMANO respondio desde la bandeja

    // 3) Armar historial para Claude (cronologico, alternando roles)
    let hist = msgs
      .map(m => ({
        role: (m.direction || '').startsWith('inbound') ? 'user' : 'assistant',
        text: (m.body || '').replace(BOT_MARK, '').trim(),
        t: m.date_created ? new Date(m.date_created).getTime() : 0
      }))
      .filter(m => m.text)
      .sort((a, b) => a.t - b.t)
      .slice(-HISTORY_MAX);

    // El mensaje recien recibido puede no estar aun en la API: agregarlo
    if (body && (!hist.length || hist[hist.length - 1].text !== body)) {
      hist.push({ role: 'user', text: body, t: now });
    }

    // Colapsar roles consecutivos
    const messages = [];
    for (const m of hist) {
      const last = messages[messages.length - 1];
      if (last && last.role === m.role) last.content += '\n' + m.text;
      else messages.push({ role: m.role, content: m.text });
    }
    // Anthropic exige que empiece en 'user'
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length) messages.push({ role: 'user', content: body || 'Hola' });

    // 4) Generar respuesta con Claude
    let reply = 'Gracias por escribir a Klivox Automatizaciones 😊 En breve un asesor te atendera. ¿Me cuentas tu nombre y que necesitas?';
    if (KEY) {
      try {
        const ar = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM_PROMPT, messages })
        });
        const ad = await ar.json();
        const txt = ad && ad.content && ad.content[0] && ad.content[0].text;
        if (txt) reply = txt.trim();
      } catch (_) { /* usa el mensaje de respaldo */ }
    }

    // 5) Enviar por Twilio REST
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
