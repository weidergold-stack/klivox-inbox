// api/recordatorio.js — mensajes ligados a una llamada agendada
//
// Lo llama el reloj del script "Agenda Klivox" (Google Apps Script):
//
//  tipo 'antes' (por defecto): 1 hora antes de la llamada. Le escribe a la persona y,
//                              aparte, le manda al equipo por Telegram la ficha del prospecto.
//  tipo 'post':                despues de la llamada, para preguntar como le fue.
//
// Regla de WhatsApp: fuera de las 24 h desde el ultimo mensaje de la persona solo se
// puede enviar una plantilla aprobada. Por eso:
//   - si la plantilla con botones esta aprobada, se usa siempre;
//   - si no, dentro de las 24 h va texto normal y fuera va la plantilla de texto aprobada.
// Las plantillas se buscan por nombre: en cuanto Meta aprueba una, empieza a usarse sola.
//
// Requiere env: TWILIO_*, AGENDA_CLAVE. Opcional: KV_* (evita repetidos), TELEGRAM_* (avisos).

const C = require('../lib/comun');

const VENTANA_MS = 23 * 60 * 60 * 1000; // 23 h: una hora de margen sobre las 24 de WhatsApp

const TEXTO = {
  antes: (n, h) => 'Hola ' + n + ' 👋 Te recordamos tu llamada con un asesor de Klivox hoy a las ' + h +
    '. Te llamaremos a este mismo número. Si necesitas cambiarla o cancelarla, respóndenos por aquí.',
  post: (n) => 'Hola ' + n + ' 👋 Gracias por tu interés en Klivox. ¿Cómo te fue en la llamada con nuestro asesor? ' +
    'Si te quedó alguna duda o quieres avanzar, respóndenos por aquí.'
};
const PLANTILLAS = {
  antes: ['klivox_recordatorio_llamada_botones', 'klivox_recordatorio_llamada'],
  post: ['klivox_despues_llamada']
};

module.exports = async (req, res) => {
  const fin = (code, obj) => res.status(code).json(obj);
  try {
    if (req.method !== 'POST') return fin(405, { ok: false, motivo: 'metodo' });
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
    if (!process.env.AGENDA_CLAVE || b.clave !== process.env.AGENDA_CLAVE) return fin(401, { ok: false, motivo: 'no_autorizado' });
    if (!C.twilio()) return fin(200, { ok: false, motivo: 'twilio_sin_config' });

    const tipo = b.tipo === 'post' ? 'post' : 'antes';
    const digitos = String(b.telefono || '').replace(/\D/g, '');
    if (digitos.length < 10) return fin(200, { ok: false, motivo: 'telefono_invalido' });
    const to = 'whatsapp:+' + digitos;
    const hora = String(b.hora || '').trim().slice(0, 20);
    if (tipo === 'antes' && !hora) return fin(200, { ok: false, motivo: 'falta_hora' });

    // El mensaje de despues de la llamada no se envia de noche: espera a la manana siguiente.
    if (tipo === 'post') {
      const ahora = C.bogota();
      if (ahora.hora < 8 || ahora.hora >= 19) return fin(200, { ok: false, motivo: 'fuera_de_horario' });
    }

    // Un solo mensaje de cada tipo por numero y por horario.
    const llave = 'klivox_recordado:' + tipo + ':' + digitos.slice(-10) + ':' + String(b.inicio || hora).replace(/[^0-9T]/g, '');
    if ((await C.kvGet(llave)) === '1') return fin(200, { ok: true, ya_enviado: true });

    const lead = (await C.leerLead(to)) || { tel: '+' + digitos, seguimientos: [], enviados: [] };
    const nombre = C.nombreCorto(lead) || C.nombreCorto({ nombre: b.nombre }) || 'qué tal';

    // ¿Escribio la persona en las ultimas 24 h?
    let dentro = false;
    try {
      const t = C.twilio();
      const lr = await fetch(t.mensajes + '?PageSize=1&From=' + encodeURIComponent(to), { headers: { Authorization: t.auth } });
      const ld = await lr.json();
      const m = (ld.messages || [])[0];
      const ts = m && (m.date_sent || m.date_created);
      if (ts) dentro = (Date.now() - new Date(ts).getTime()) < VENTANA_MS;
    } catch (_) { dentro = false; }

    const pl = await C.plantillas();
    const aprobada = (n) => (pl[n] && pl[n].aprobada) ? pl[n].sid : '';
    const vars = tipo === 'antes' ? { 1: nombre, 2: hora } : { 1: nombre };
    const conBotones = tipo === 'antes' ? aprobada(PLANTILLAS.antes[0]) : '';

    let envio, via;
    if (conBotones) {
      envio = await C.enviarWhatsApp({ to, contentSid: conBotones, variables: vars }); via = 'plantilla_botones';
    } else if (dentro) {
      envio = await C.enviarWhatsApp({ to, body: (tipo === 'antes' ? TEXTO.antes(nombre, hora) : TEXTO.post(nombre)) + C.BOT_MARK }); via = 'texto';
    } else {
      const sid = PLANTILLAS[tipo].map(aprobada).find(Boolean);
      if (!sid) return fin(200, { ok: false, motivo: 'sin_plantilla_aprobada' });
      envio = await C.enviarWhatsApp({ to, contentSid: sid, variables: vars }); via = 'plantilla';
    }
    if (!envio.ok) return fin(200, { ok: false, motivo: 'twilio_rechazo', detalle: envio.error });

    await C.kvSet(llave, '1', 172800);
    lead.enviados = (lead.enviados || []).concat(envio.sid).slice(-20);
    lead.ultimoOut = Date.now();
    await C.guardarLead(lead);

    // Aviso al equipo con la ficha, para que el asesor llegue preparado a la llamada.
    if (tipo === 'antes') {
      await C.avisar('📞 Llamada en 1 hora (' + hora + ')' + C.NL + C.fichaTexto(lead) + C.NL +
        (lead.confirmo ? '✅ Ya confirmó.' : '⏳ Aún no confirma.') + C.NL + 'Abrir: ' + C.BASE_PUBLICA);
    }
    return fin(200, { ok: true, via });
  } catch (e) {
    return fin(200, { ok: false, motivo: 'error', detalle: String((e && e.message) || e).slice(0, 200) });
  }
};
