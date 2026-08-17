// api/templates.js — lista las plantillas de WhatsApp (con estado Meta) desde Zavu.
// Devuelve el formato que espera index.html: { templates:[{name,status,sid,varCount,body,category,buttons}] }
// Env: ZAVU_API_KEY, ZAVU_SENDER (opcional), INBOX_PASSWORD
module.exports = async (req, res) => {
  if ((req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const KEY = process.env.ZAVU_API_KEY;
  const SENDER = process.env.ZAVU_SENDER;
  const headers = { Authorization: 'Bearer ' + KEY };
  if (SENDER) headers['Zavu-Sender'] = SENDER;
  const statusMap = { approved: 'approved', pending: 'pending', rejected: 'rejected', draft: 'pending' };
  try {
    const r = await fetch('https://api.zavu.dev/v1/templates?limit=100', { headers });
    const d = await r.json().catch(() => ({}));
    const items = (d && d.items) || [];
    const templates = items.map(t => {
      const vars = Array.isArray(t.variables)
        ? t.variables.length
        : ((t.body || '').match(/\{\{\s*\d+\s*\}\}/g) || []).length;
      const buttons = Array.isArray(t.buttons) ? t.buttons.map(b => b.text).filter(Boolean) : [];
      const category = (t.category || t.whatsappCategory || (t.whatsapp && t.whatsapp.category) || '').toUpperCase();
      return {
        name: t.name,
        status: statusMap[t.status] || 'pending',
        sid: t.id,          // index.html lo reenvía como contentSid a /api/send
        varCount: vars,
        body: t.body || '',
        category,           // UTILITY | MARKETING | AUTHENTICATION (para el costo estimado)
        buttons
      };
    });
    for (const _tpl of templates) {
    if (!_tpl.body || !String(_tpl.body).trim()) {
      try {
        const _dr = await fetch('https://api.zavu.dev/v1/templates/' + encodeURIComponent(_tpl.sid), { headers });
        if (_dr.ok) {
          const _dd = await _dr.json().catch(function(){ return null; });
          const _t = (_dd && (_dd.template || _dd.data)) || _dd || {};
          const _wa = _t.whatsapp || {};
          const _cands = [_t.body, _t.whatsappBody, _wa.body, _wa.text, _wa.content];
          let _b = '';
          for (let _ci = 0; _ci < _cands.length; _ci++) { if (typeof _cands[_ci] === 'string' && _cands[_ci].trim()) { _b = _cands[_ci]; break; } }
          if (_b) {
            _tpl.body = _b;
            const _m = _b.match(/\{\{[^}]+\}\}/g) || [];
            const _u = [];
            _m.forEach(function(x){ var k = x.replace(/[{}]/g,'').trim(); if (_u.indexOf(k) === -1) _u.push(k); });
            if (_u.length) _tpl.varCount = _u.length;
          }
        }
      } catch (_e) {}
    }
  }
  res.status(200).json({ templates });
  } catch (e) {
    res.status(200).json({ templates: [], error: String(e) });
  }
};
