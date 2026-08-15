// api/webhook.js — Bot de auto-respuesta (Zavu / WhatsApp Cloud API) para la instancia de Tania.
//
// ESTADO: INACTIVO por diseño. El guion (SYSTEM_PROMPT) esta vacio a proposito:
// la Dra. Tania atiende manual desde la bandeja. La infraestructura del bot queda lista;
// para activarlo en el futuro basta con escribir el guion en SYSTEM_PROMPT (abajo) y
// desplegar: el bot empezara a responder automaticamente con relevo humano y pausa.
//
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), ANTHROPIC_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN

const HUMAN_WINDOW_MIN = 3;
const HISTORY_MAX = 12;
const MODEL = 'claude-haiku-4-5-20251001';
const BOT_MARK = '​'; // marca invisible: distingue respuestas del bot de las manuales
const ZAVU = 'https://api.zavu.dev/v1';

// ============================================================================
// GUION DEL BOT — VACIO = bot inactivo (atencion 100% manual).
// Para activar el bot en el futuro, escribe aqui el guion del consultorio de Tania
// (quien es, servicios, tono, que hacer ante citas/precios) y vuelve a desplegar.
// ============================================================================
const SYSTEM_PROMPT = ``;
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
    // Bot inactivo mientras no haya guion configurado (atencion manual).
    if (!SYSTEM_PROMPT.trim()) return done();

    const ev = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!ev || ev.type !== 'message.inbound') return done(); // ignora eventos de entrega, etc.

    const data = ev.data || {};
    const from = (data.from || '').trim();     // numero del paciente
    const body = (data.text || '').trim();
    const myNum = (data.to || '').replace(/\D/g, ''); // NUESTRO numero (el sender)
    if (!from || !body) return done(); // por ahora solo texto

    // Interruptor de pausa: global o por conversación (Redis) — claves aisladas de Tania
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

    // Direccion robusta: un mensaje es SALIENTE si su 'from' es NUESTRO numero.
    const isOutbound = (m) => myNum && ((m.from || '').replace(/\D/g, '') === myNum);

    const now = Date.now();
    const windowMs = HUMAN_WINDOW_MIN * 60 * 1000;
    const recentHuman = msgs.some(m => {
      const isBot = (m.text || '').includes(BOT_MARK);
      const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
      return isOutbound(m) && !isBot && (now - t) < windowMs;
    });
    if (recentHuman) return done();

    let hist = msgs
      .map(m => ({
        role: isOutbound(m) ? 'assistant' : 'user',
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

    let reply = '';
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
      } catch (_) { /* sin respuesta si falla */ }
    }
    if (!reply) return done();

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
