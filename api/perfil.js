// api/perfil.js — perfil de WhatsApp Business del numero de Klivox (Twilio Senders API v2)
//
//  GET   -> muestra el perfil actual del numero (nombre visible, descripcion, foto, etc.).
//  POST { aplicar: true } -> actualiza el perfil con los datos fijos de PERFIL (abajo).
//          No cambia el nombre visible: ese pasa por revision de Meta y se decide aparte.
//
// Para cambiar un texto del perfil se edita PERFIL aqui y se vuelve a aplicar.
// Requiere env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, INBOX_PASSWORD

const PERFIL = {
  about: 'Recepcionista con IA para tu negocio, 24 horas',
  description: 'Klivox: CRM con inteligencia artificial, WhatsApp oficial que no se bloquea e historia clínica Clinify. Respondemos y agendamos por ti las 24 horas.',
  address: 'Bogotá, Colombia',
  vertical: 'Professional Services',
  logo_url: 'https://klivox-inbox.vercel.app/logo-klivox.png',
  websites: [
    { website: 'https://klivox.co', label: 'Klivox' },
    { website: 'https://historiaclinify.com', label: 'Clinify' }
  ],
  emails: [{ email: 'info@klivox.co', label: 'Contacto' }]
};

const BASE = 'https://messaging.twilio.com/v2/Channels/Senders';

module.exports = async (req, res) => {
  if (!process.env.INBOX_PASSWORD || (req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const SID = process.env.TWILIO_ACCOUNT_SID, TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM = String(process.env.TWILIO_WHATSAPP_FROM || '');
  if (!SID || !TOKEN || !FROM) { res.status(200).json({ ok: false, error: 'twilio_sin_config' }); return; }
  const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');
  const solo = (p) => p ? {
    name: p.name, about: p.about, description: p.description, address: p.address,
    vertical: p.vertical, logo_url: p.logo_url, websites: p.websites, emails: p.emails
  } : null;

  try {
    // Busca el remitente que corresponde al numero del bot.
    const lr = await fetch(BASE + '?Channel=whatsapp&channel=whatsapp&PageSize=100', { headers: { Authorization: auth } });
    const ld = await lr.json();
    if (!lr.ok) { res.status(200).json({ ok: false, paso: 'listar', detalle: String(ld.message || lr.status).slice(0, 300) }); return; }
    const lista = ld.senders || [];
    const d10 = FROM.replace(/\D/g, '').slice(-10);
    const s = lista.find(x => String(x.sender_id || '').replace(/\D/g, '').slice(-10) === d10);
    if (!s) { res.status(200).json({ ok: false, error: 'remitente_no_encontrado', total: lista.length }); return; }

    if (req.method !== 'POST') {
      res.status(200).json({ ok: true, estado: s.status, perfil: solo(s.profile) });
      return;
    }

    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
    if (b.aplicar !== true) { res.status(400).json({ ok: false, error: 'falta_aplicar' }); return; }

    const ur = await fetch(BASE + '/' + s.sid, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: PERFIL })
    });
    const ud = await ur.json().catch(() => ({}));
    if (!ur.ok) { res.status(200).json({ ok: false, paso: 'actualizar', detalle: String(ud.message || ur.status).slice(0, 300) }); return; }
    res.status(200).json({ ok: true, estado: ud.status, perfil: solo(ud.profile) });
  } catch (e) {
    res.status(200).json({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};
