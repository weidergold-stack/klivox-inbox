// api/bot-config.js - configuracion del bot ONLINE (Upstash KV), por bandeja.
// GET  -> { cfg: {...} }
// POST { cfg:{...} } -> guarda la configuracion completa.
// Clave: botcfg:<INBOX_NS>
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const URL = process.env.KV_REST_API_URL;
  const TOK = process.env.KV_REST_API_TOKEN;
  const KEY = 'botcfg:' + (process.env.INBOX_NS || 'default');
  const AUTH = { Authorization: 'Bearer ' + TOK };
  const DEF = {
    enabled: false,
    persona: '',
    knowledge: '',
    hours: { enabled: false, from: '08:00', to: '18:00', days: [1,2,3,4,5,6], offMsg: '' },
    escalate: { enabled: true, keywords: 'asesor,humano,persona real,hablar con alguien,agente', msg: '' }
  };
  if (!URL || !TOK) { res.status(200).json({ cfg: DEF, error: 'no_kv' }); return; }

  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const cfg = (body && body.cfg) || {};
      const r = await fetch(URL + '/set/' + encodeURIComponent(KEY), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'text/plain' }, AUTH),
        body: JSON.stringify(cfg)
      });
      res.status(200).json({ ok: r.ok });
      return;
    }
    const r = await fetch(URL + '/get/' + encodeURIComponent(KEY), { headers: AUTH });
    const d = await r.json().catch(() => ({}));
    let cfg = null;
    if (d && d.result) { try { cfg = JSON.parse(d.result); } catch (_) { cfg = null; } }
    res.status(200).json({ cfg: cfg || DEF });
  } catch (e) {
    res.status(200).json({ cfg: DEF, error: String(e) });
  }
};
