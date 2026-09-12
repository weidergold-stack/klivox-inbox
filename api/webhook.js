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
// GUION DEL BOT: se configura desde el panel de la bandeja (boton Bot).
// Se guarda en KV bajo botcfg:<INBOX_NS> y se lee en cada mensaje entrante.
// Esta constante queda solo por compatibilidad; ya no se usa.
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

const NS = process.env.INBOX_NS || 'default';

async function kvSet(key, val) {
  const KU = process.env.KV_REST_API_URL, KT = process.env.KV_REST_API_TOKEN;
  if (!KU || !KT) return false;
  try {
    await fetch(KU + '/set/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KT, 'Content-Type': 'text/plain' },
      body: String(val)
    });
    return true;
  } catch (_) { return false; }
}

const CFG_DEF = {
  hours: { enabled: false, from: '08:00', to: '18:00', days: [1, 2, 3, 4, 5, 6], offMsg: '' },
  escalate: { enabled: true, keywords: 'asesor,humano,persona real,hablar con alguien,agente', msg: '' }
};

// Lee la configuracion guardada desde el panel de la bandeja.
async function loadCfg() {
  let c = {};
  try {
    const raw = await kvGet('botcfg:' + NS);
    if (raw) c = JSON.parse(raw) || {};
  } catch (_) { c = {}; }
  return {
    enabled: !!c.enabled,
    persona: c.persona || '',
    knowledge: c.knowledge || '',
    hours: Object.assign({}, CFG_DEF.hours, c.hours || {}),
    escalate: Object.assign({}, CFG_DEF.escalate, c.escalate || {})
  };
}

// Arma el system prompt con el guion + la base de conocimiento.
function buildSystem(cfg) {
  const parts = [];
  if (cfg.persona && cfg.persona.trim()) parts.push(cfg.persona.trim());
  if (cfg.knowledge && cfg.knowledge.trim()) {
    parts.push('INFORMACION DEL CONSULTORIO (usa unicamente estos datos):\n' + cfg.knowledge.trim());
  }
  if (!parts.length) return '';
  parts.push('REGLAS: responde en espanol, por WhatsApp, breve (1 a 3 frases). Nunca inventes precios, horarios ni datos que no esten arriba. No des diagnosticos: invita a una valoracion. Si no sabes algo, dilo y ofrece que una persona del equipo lo confirme.');
  return parts.join('\n\n');
}

// Horario de atencion en hora de Colombia (UTC-5).
function inHours(h) {
  try {
    const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const days = Array.isArray(h.days) ? h.days : [];
    if (days.length && days.indexOf(d.getUTCDay()) === -1) return false;
    const toMin = (v, def) => {
      const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : def;
    };
    const cur = d.getUTCHours() * 60 + d.getUTCMinutes();
    const a = toMin(h.from, 0), b = toMin(h.to, 24 * 60 - 1);
    return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
  } catch (_) { return true; }
}

function today5() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  const done = () => res.status(200).json({ ok: true });
  try {
    // El encendido/apagado del bot vive en la configuracion (ver mas abajo).

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

    // ---- Configuracion del bot (panel de la bandeja) ----
    const cfg = await loadCfg();
    if (!cfg.enabled) return done();   // bot apagado => atencion 100% manual
    const SYS = buildSystem(cfg);
    if (!SYS.trim()) return done();    // sin guion => no responde

    const sendText = async (t) => {
      if (!t || !String(t).trim()) return;
      try {
        await fetch(ZAVU + '/messages', {
          method: 'POST', headers: zh,
          body: JSON.stringify({ to: from, channel: 'whatsapp', text: String(t).trim() + BOT_MARK })
        });
      } catch (_) {}
    };

    // Fuera de horario: avisa una sola vez al dia y no responde.
    if (cfg.hours.enabled && !inHours(cfg.hours)) {
      if (cfg.hours.offMsg && cfg.hours.offMsg.trim()) {
        const dk = 'offsent:' + NS + ':' + dig;
        if ((await kvGet(dk)) !== today5()) {
          await kvSet(dk, today5());
          await sendText(cfg.hours.offMsg);
        }
      }
      return done();
    }

    // Pasar a una persona: el bot se pausa en ese chat y deja el mensaje sin responder.
    if (cfg.escalate.enabled) {
      const kws = String(cfg.escalate.keywords || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      const low = body.toLowerCase();
      if (kws.some(k => low.indexOf(k) !== -1)) {
        await kvSet('tania_paused:' + from, '1');
        await kvSet('escalated:' + NS + ':' + dig, String(Date.now()));
        await sendText(cfg.escalate.msg);
        return done();
      }
    }

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
          body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYS, messages })
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
