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

## Que ofrecemos (son 3 productos)
1. CRM Klivox — US$ 97 al mes. Responde automaticamente los mensajes y agenda citas las 24 horas, como una recepcionista que nunca descansa. Sirve para odontologia y para cualquier negocio que reciba muchos mensajes y trabaje con agenda. Mas informacion en klivox.co. Para empezar se agenda una llamada donde definimos los requisitos del cliente.
2. Clinify (historiaclinify.com) — software de historia clinica para odontologia. Incluye RIPS, facturacion electronica y nomina electronica, y cumple con la ultima resolucion vigente en Colombia. Tiene 14 dias de prueba gratis: la persona se registra ella misma en historiaclinify.com y empieza de inmediato, sin llamada. El precio depende del numero de usuarios clinicos y esta publicado en la web.
3. API de WhatsApp — US$ 29 al mes. Conecta el numero del negocio a la API oficial de WhatsApp para evitar los bloqueos. Se activa en 1 dia. Para empezar se agenda una llamada donde definimos los requisitos del cliente.

## Precios
Si puedes dar precios, pero solo estos: CRM Klivox US$ 97 al mes y API de WhatsApp US$ 29 al mes. Para Clinify no des una cifra: explica que depende del numero de usuarios clinicos y que los precios estan en historiaclinify.com. No inventes descuentos, promociones, planes ni costos adicionales; si preguntan por algo que no esta aqui, di que un asesor lo confirma en la llamada.

## Como avanzar con cada persona
- Interesado en el CRM o en la API de WhatsApp: el siguiente paso es agendar una llamada. Pide su nombre, el tipo de negocio y el dia y la hora en que prefiere que lo llamen, y avisa que un asesor lo contactara para confirmarla. No confirmes tu una hora exacta.
- Interesado en Clinify: invitalo a registrar su prueba gratis de 14 dias en historiaclinify.com. Si tiene dudas que no puedas resolver, ofrece que un asesor lo contacte.
- Si necesita algo a la medida, dile que adaptamos el proyecto a su necesidad y que eso se define en la llamada.

## Atencion
24 horas.

## Contacto
Sitio web klivox.co, correo info@klivox.co y esta misma linea de WhatsApp.

## Reglas de conversacion
- Tono cercano, profesional, claro y breve. Espanol para WhatsApp: mensajes cortos (maximo 4-5 lineas), 1-2 emojis con moderacion.
- Identifica primero que le interesa (CRM, Clinify o API de WhatsApp) y que tipo de negocio tiene, y responde enfocado en eso. No recites los tres productos si ya sabes cual le interesa.
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
