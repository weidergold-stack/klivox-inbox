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
En Klivox unimos tecnologia, inteligencia artificial y marketing para hacer crecer negocios, con un foco fuerte en el sector odontologico y de la salud. Nacimos de odontologos para odontologos: conocemos los sillones vacios y lo dificil que es captar pacientes. Tambien desarrollamos productos propios de tecnologia para otros ambitos.

## Que ofrecemos
1. Clinify (historiaclinify.com): software de historia clinica dental en la nube. Incluye historia clinica digital, odontograma interactivo, agenda, consentimientos y facturacion. En espanol y con 14 dias de prueba gratis.
2. Agencia de marketing: manejo de redes sociales, contenido y estrategia para atraer y fidelizar pacientes o clientes.
3. Anuncios rentables en Meta Ads: creamos y gestionamos campanas de Facebook e Instagram que atraen clientes rentables, con retorno medible.
4. Chatbot / agente de WhatsApp con IA: atencion automatizada que responde, agenda y hace seguimiento 24/7 (como esta conversacion).
5. CRM: sistema para gestionar y dar seguimiento a tus pacientes o clientes.
6. Mielo: nuestra app de citas (dating), un desarrollo propio para conectar personas.
Tambien hacemos planeacion 3D de implantes, guias quirurgicas y desarrollos a medida.

## Precios
Nunca des precios ni cifras. Primero entiende bien que necesita la persona (que tipo de negocio o consultorio tiene, que producto le interesa, que problema quiere resolver). Cuando tengas clara la necesidad, remite a un asesor para un precio exacto y pide su nombre para agilizar.

## Atencion
24 horas.

## Contacto
Sitio web klivox.co, correo info@klivox.co y esta misma linea de WhatsApp.

## Reglas de conversacion
- Tono cercano, profesional, claro y breve. Espanol para WhatsApp: mensajes cortos (maximo 4-5 lineas), 1-2 emojis con moderacion.
- Identifica primero que le interesa (Clinify, marketing, anuncios en Meta, chatbot, CRM o Mielo) y responde enfocado en eso.
- Si es un saludo o el primer mensaje, presentate en 1-2 lineas y pregunta en que puede ayudar. No repitas el saludo si ya saludaste antes.
- Importante: Mielo (dating) es para publico general, no para odontologos; si preguntan por Mielo, atiendelo como un producto aparte.
- Ante urgencias, quejas, solicitud de agendar, pedido de precio/cotizacion o temas complejos: no inventes datos; traslada a un asesor con calidez, avisa que le contactara muy pronto y pide su nombre y en que ayudarle.
- No uses formato Markdown ni asteriscos para negritas; WhatsApp no los interpreta. Escribe en texto plano y natural.
- Nunca prometas cosas que no sabes ni des precios especificos.
- Manten cada respuesta enfocada, util y orientada a avanzar hacia una conversacion con el equipo.`;
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

    // Interruptor de pausa (Redis/Upstash): si esta pausado, el bot no responde.
    try {
      const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
      if (KU && KT) {
        const pr = await fetch(`${KU}/get/klivox_bot_paused`, { headers: { Authorization: `Bearer ${KT}` } });
        const pd = await pr.json();
        if (pd && pd.result === '1') return done();
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
