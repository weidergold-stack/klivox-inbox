// api/webhook.js — Bot de auto-respuesta de Klivox sobre Zavu (WhatsApp Cloud API).
//
// - Zavu llama a este endpoint con el evento "message.inbound" cuando entra un mensaje.
// - El bot marca sus respuestas con un caracter invisible (BOT_MARK): contesta cada
//   mensaje del paciente, pero se aparta si un HUMANO respondió manual (relevo).
// - Respeta el interruptor de pausa (global o por conversación) guardado en Redis.
// - Lee el historial reciente en Zavu para dar contexto a Claude.
//
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), ANTHROPIC_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN

const HUMAN_WINDOW_MIN = 3;
const HISTORY_MAX = 12;
const MODEL = 'claude-haiku-4-5-20251001';
const BOT_MARK = '​'; // marca invisible: distingue respuestas del bot de las manuales
const ZAVU = 'https://api.zavu.dev/v1';

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

async function kvGet(key) {
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return null;
  try {
    const r = await fetch(KU + '/get/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + KT } });
    const d = await r.json();
    return d && d.result;
  } catch (_) { return null; }
}

module.exports = async (req, res) => {
  const done = () => res.status(200).json({ ok: true });
  try {
    const ev = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!ev || ev.type !== 'message.inbound') return done(); // ignora eventos de entrega, etc.

    const data = ev.data || {};
    const from = (data.from || '').trim();
    const body = (data.text || '').trim();
    if (!from || !body) return done(); // por ahora solo texto

    // Interruptor de pausa: global o por conversación (Redis)
    if ((await kvGet('tania_bot_paused')) === '1') return done();
    if ((await kvGet('tania_paused:' + from)) === '1') return done();

    const KEY = process.env.ZAVU_API_KEY, SENDER = process.env.ZAVU_SENDER, AKEY = process.env.ANTHROPIC_API_KEY;
    if (!KEY) return done();
    const zh = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
    if (SENDER) zh['Zavu-Sender'] = SENDER;

    const dig = from.replace(/\D/g, '');

    // Historial reciente (para contexto y relevo humano)
    let msgs = [];
    try {
      const lr = await fetch(ZAVU + '/messages?limit=100', { headers: { Authorization: 'Bearer ' + KEY } });
      const ld = await lr.json();
      msgs = (ld.items || []).filter(m =>
        ((m.from || '').replace(/\D/g, '') === dig) || ((m.to || '').replace(/\D/g, '') === dig)
      );
    } catch (_) { msgs = []; }

    const now = Date.now();
    const windowMs = HUMAN_WINDOW_MIN * 60 * 1000;
    const recentHuman = msgs.some(m => {
      const isOut = m.status !== 'received';
      const isBot = (m.text || '').includes(BOT_MARK);
      const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
      return isOut && !isBot && (now - t) < windowMs;
    });
    if (recentHuman) return done();

    let hist = msgs
      .map(m => ({
        role: m.status === 'received' ? 'user' : 'assistant',
        text: (m.text || '').replace(BOT_MARK, '').trim(),
        t: m.createdAt ? new Date(m.createdAt).getTime() : 0
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
    if (AKEY) {
      try {
        const ar = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': AKEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM_PROMPT, messages })
        });
        const ad = await ar.json();
        const txt = ad && ad.content && ad.content[0] && ad.content[0].text;
        if (txt) reply = txt.trim();
      } catch (_) { /* usa el mensaje de respaldo */ }
    }

    reply = reply.replace(/\*\*/g, '').replace(/__/g, '').trim();

    await fetch(ZAVU + '/messages', {
      method: 'POST', headers: zh,
      body: JSON.stringify({ to: from, channel: 'whatsapp', text: reply + BOT_MARK })
    });

    return done();
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
};
