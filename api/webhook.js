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

const SYSTEM_PROMPT = `Eres el asistente virtual de WhatsApp de "Klivox Automatizaciones", una empresa que ayuda a consultorios y clinicas odontologicas a crecer con tecnologia e inteligencia artificial.

Servicios de Klivox:
- Odontologia digital y flujos de trabajo digitales
- Historia clinica digital
- CRM y seguimiento de pacientes
- Detector de implantes con IA
- Agente / chatbot de atencion automatica
- Apps de agendamiento de citas
- Guias quirurgicas y planeacion 3D de implantes
- Desarrollos a medida

Tono: cercano, profesional, claro y breve. Escribe en espanol, para chat de WhatsApp (mensajes cortos, maximo 4-5 lineas, puedes usar 1-2 emojis con moderacion).

Objetivo: dar la bienvenida, entender que necesita el prospecto, explicar de forma simple como Klivox puede ayudarle y avanzar hacia una conversacion con el equipo.

Reglas:
- Si es el primer mensaje o un saludo, presenta a Klivox en 2 lineas y pregunta en que puede ayudar. No repitas el saludo si ya saludaste antes en la conversacion.
- Responde dudas sobre los servicios de forma concreta.
- Si piden precios exactos, una cotizacion, agendar una reunion/demo, o el tema es complejo o sensible (queja, urgencia), NO inventes datos: responde con calidez que un asesor del equipo le contactara muy pronto y pide su nombre y que necesita para agilizar.
- Nunca prometas cosas que no sabes ni des precios especificos.
- Contacto oficial: correo info@klivox.co y sitio klivox.co.
- Manten cada respuesta enfocada y util.`;

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
    const recentOutbound = msgs.some(m => {
      const isOut = (m.direction || '').startsWith('outbound');
      const ts = m.date_sent || m.date_created;
      const t = ts ? new Date(ts).getTime() : 0;
      return isOut && (now - t) < windowMs;
    });
    if (recentOutbound) return done(); // hay un humano atendiendo

    // 3) Armar historial para Claude (cronologico, alternando roles)
    let hist = msgs
      .map(m => ({
        role: (m.direction || '').startsWith('inbound') ? 'user' : 'assistant',
        text: (m.body || '').trim(),
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
    const sendBody = new URLSearchParams({ From: FROM, To: from, Body: reply });
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
