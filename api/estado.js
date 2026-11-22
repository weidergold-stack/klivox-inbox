// api/estado.js — Twilio avisa aqui el estado de cada mensaje enviado
//
// Cuando un mensaje no se entrega (failed / undelivered), se avisa al equipo por
// Telegram con el motivo. Los demas estados (sent, delivered, read) no hacen ruido.

const C = require('../lib/comun');

const MOTIVOS = {
  63016: 'Fuera de la ventana de 24 h: hacía falta una plantilla aprobada.',
  63024: 'El número no existe o no tiene WhatsApp.',
  63018: 'Meta limitó los envíos de esta línea (tope de mensajes).',
  21211: 'Número inválido.'
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/xml');
  const done = () => res.status(200).send('<Response></Response>');
  try {
    const firma = await C.revisarFirma(req);
    if (!firma.permitir) return res.status(403).send('<Response></Response>');

    const p = req.body || {};
    const estado = String(p.MessageStatus || p.SmsStatus || '').toLowerCase();
    if (estado !== 'failed' && estado !== 'undelivered') return done();

    // Un aviso por mensaje, aunque Twilio lo reporte varias veces.
    const sid = String(p.MessageSid || p.SmsSid || '');
    if (sid) {
      const nuevo = await C.kvCmd(['SET', 'klivox_falla:' + sid, '1', 'EX', 86400, 'NX']);
      if (nuevo === null && process.env.KV_REST_API_URL) return done();
    }
    // Si lo que no se entrego era un menu, se manda enseguida el mismo contenido como texto.
    if (sid) {
      const resp = await C.kvGet('klivox_menu_respaldo:' + sid);
      if (resp) {
        await C.kvCmd(['DEL', 'klivox_menu_respaldo:' + sid]);
        try { const m = JSON.parse(resp); await C.enviarWhatsApp({ to: m.to, body: m.texto + C.BOT_MARK }); } catch (_) {}
        await C.kvSet('klivox_menu_falla', String(p.ErrorCode || 'sin_codigo') + ' ' + new Date().toISOString(), 604800);
        return done();
      }
    }
    const codigo = String(p.ErrorCode || '');
    const lead = p.To ? await C.leerLead(p.To) : null;
    // No se avisa por Telegram (el equipo pidio solo dos tipos de aviso). La falla queda
    // anotada en la ficha del prospecto y se ve en la pagina de prospectos.
    if (lead) {
      lead.falla = { ts: Date.now(), motivo: (MOTIVOS[codigo] || String(p.ErrorMessage || 'sin detalle')).slice(0, 160), codigo };
      await C.guardarLead(lead);
    }
    return done();
  } catch (_) {
    return done();
  }
};
