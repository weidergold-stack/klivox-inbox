// api/tareas.js — seguimiento automatico a prospectos que dejaron de responder
//
// Lo llama el reloj del script "Agenda Klivox" cada 10 minutos. Recorre el registro de
// prospectos y le escribe a quien mostro interes, no agendo y lleva mas de 24 h callado.
//
// REGLAS (todas en codigo; no dependen del modelo):
//  - Maximo 2 mensajes por prospecto en toda su vida: el 1.º tras 24 h de silencio,
//    el 2.º 72 h despues del primero, solo si no respondio.
//  - Solo de lunes a sabado, entre 9:00 a. m. y 6:00 p. m. hora de Colombia.
//  - Nunca a: quien ya tiene llamada agendada, clientes, contactos que existian antes de
//    activar esto, quien pidio no ser contactado, chats con el bot en pausa, ni chats
//    donde una persona del equipo escribio en los ultimos 14 dias.
//  - Si el interruptor general del bot esta en pausa, no se envia nada.
//  - Maximo 5 envios por pasada, para no soltar una rafaga.
//  - Solo plantillas ya aprobadas por Meta (fuera de 24 h no se puede otra cosa).
//
// POST { clave }            -> ejecuta.
// POST { clave, simular:1 } -> dice a quien le escribiria, sin enviar nada.

const C = require('../lib/comun');

const H = 3600000;
const MAX_POR_PASADA = 5;

// Que plantilla toca. Devuelve '' si no hay nada que enviar.
function plantillaPara(lead) {
  const hechos = (lead.seguimientos || []).length;
  if (hechos === 0) return lead.interes === 'clinify' ? 'klivox_recordatorio_clinify' : 'klivox_reenganche_general';
  if (hechos === 1) {
    if (lead.asesor) return 'klivox_seguimiento_asesoria';
    if (lead.seguimientos[0].plantilla === 'klivox_recordatorio_clinify') return 'klivox_reenganche_general';
  }
  return '';
}

// Devuelve el motivo por el que NO se le escribe, o '' si le toca.
function descarte(lead, ahora) {
  if (lead.antiguo) return 'contacto_anterior';
  if (lead.cliente) return 'es_cliente';
  if (lead.noSeguir) return 'pidio_no_contactar';
  if (lead.llamada) return 'tiene_llamada';
  const hechos = lead.seguimientos || [];
  if (hechos.length >= 2) return 'ya_recibio_dos';
  if (!(lead.mensajes >= 2) && (!lead.interes || lead.interes === 'ninguno')) return 'sin_interes_claro';
  if (!lead.ultimoOut) return 'el_bot_no_le_respondio';
  if (ahora - (lead.ultimoIn || 0) < 24 * H) return 'escribio_hace_menos_de_24h';
  if (hechos.length === 1) {
    if ((lead.ultimoIn || 0) > hechos[0].ts) return 'respondio_al_primero';
    if (ahora - hechos[0].ts < 72 * H) return 'faltan_72h_desde_el_primero';
  }
  if (!plantillaPara(lead)) return 'sin_plantilla_que_aplique';
  return '';
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
    if (!process.env.AGENDA_CLAVE || b.clave !== process.env.AGENDA_CLAVE) { res.status(401).json({ ok: false, motivo: 'no_autorizado' }); return; }
    const simular = !!b.simular;

    const ahora = Date.now();
    const reloj = C.bogota(ahora);
    if (!simular && (reloj.dow === 7 || reloj.hora < 9 || reloj.hora >= 18)) { res.status(200).json({ ok: true, motivo: 'fuera_de_horario', enviados: 0 }); return; }
    if ((await C.kvGet('klivox_bot_paused')) === '1') { res.status(200).json({ ok: true, motivo: 'bot_en_pausa', enviados: 0 }); return; }

    const leads = await C.listarLeads();
    const candidatos = leads.filter(l => !descarte(l, ahora)).sort((a, b2) => (a.ultimoIn || 0) - (b2.ultimoIn || 0));
    const pl = candidatos.length ? await C.plantillas() : {};
    const hechos = [], saltados = [];

    for (const lead of candidatos) {
      if (hechos.length >= MAX_POR_PASADA) break;
      const nombrePl = plantillaPara(lead);
      const sid = pl[nombrePl] && pl[nombrePl].aprobada ? pl[nombrePl].sid : '';
      if (!sid) { saltados.push({ tel: lead.tel, motivo: 'plantilla_no_aprobada' }); continue; }

      // Chat con el bot en pausa: lo atiende una persona.
      if ((await C.kvGet('klivox_paused:' + C.tel10(lead.tel))) === '1') { saltados.push({ tel: lead.tel, motivo: 'chat_en_pausa' }); continue; }

      // ¿Escribio alguien del equipo en los ultimos 14 dias? Entonces no es del bot.
      const to = C.aWhatsApp(lead.tel);
      const ult = await C.mensajesCon(to, 10);
      const propios = lead.enviados || [];
      const humano = ult.some(m => (m.direction || '').startsWith('outbound') && !(m.body || '').includes(C.BOT_MARK) &&
        !propios.includes(m.sid) && (ahora - new Date(m.date_sent || m.date_created || 0).getTime()) < 14 * 24 * H);
      if (humano) { saltados.push({ tel: lead.tel, motivo: 'lo_atiende_una_persona' }); continue; }
      // Por si la ficha quedo atrasada: si escribio hace menos de 24 h, no se le escribe.
      const entro = ult.find(m => (m.direction || '').startsWith('inbound'));
      if (entro && (ahora - new Date(entro.date_sent || entro.date_created || 0).getTime()) < 24 * H) { saltados.push({ tel: lead.tel, motivo: 'escribio_hace_poco' }); continue; }

      const nombre = C.nombreCorto(lead) || 'qué tal';
      if (simular) { hechos.push({ tel: lead.tel, plantilla: nombrePl, nombre }); continue; }

      const envio = await C.enviarWhatsApp({ to, contentSid: sid, variables: { 1: nombre } });
      if (!envio.ok) { saltados.push({ tel: lead.tel, motivo: 'twilio_rechazo: ' + envio.error }); continue; }
      lead.seguimientos = (lead.seguimientos || []).concat({ ts: ahora, plantilla: nombrePl });
      lead.enviados = (lead.enviados || []).concat(envio.sid).slice(-20);
      lead.ultimoOut = ahora;
      await C.guardarLead(lead);
      hechos.push({ tel: lead.tel, plantilla: nombrePl });
    }

    res.status(200).json({ ok: true, simular, prospectos: leads.length, enviados: simular ? 0 : hechos.length, lista: hechos, saltados });
  } catch (e) {
    res.status(200).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};

module.exports.descarte = descarte;
module.exports.plantillaPara = plantillaPara;
