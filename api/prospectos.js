// api/prospectos.js — registro de prospectos para la pagina prospectos.html
// GET -> lista de fichas, la mas reciente primero. Protegido con la clave de la bandeja.

const C = require('../lib/comun');
const { descarte } = require('./tareas');

module.exports = async (req, res) => {
  if (!process.env.INBOX_PASSWORD || (req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  try {
    const ahora = Date.now();
    const leads = (await C.listarLeads()).sort((a, b) => (b.ultimoIn || 0) - (a.ultimoIn || 0));
    res.status(200).json({
      total: leads.length,
      prospectos: leads.map(l => ({
        tel: l.tel,
        nombre: l.nombre || l.perfil || '',
        negocio: l.negocio || '',
        interes: C.INTERES[l.interes] || 'Sin definir',
        etapa: l.cliente ? 'Cliente' : l.llamada ? 'Llamada agendada' : l.asesor ? 'Espera asesor' : (l.interes && l.interes !== 'ninguno') ? 'Interesado' : 'Nuevo',
        llamada: l.llamada || '',
        confirmo: !!l.confirmo,
        anuncio: (l.anuncio && l.anuncio.titulo) || '',
        resumen: l.resumen || '',
        falla: (l.falla && l.falla.motivo) || '',
        mensajes: l.mensajes || 0,
        primer: l.primer || 0,
        ultimo: l.ultimoIn || 0,
        seguimientos: (l.seguimientos || []).length,
        seguimiento: descarte(l, ahora) || 'le_toca'
      }))
    });
  } catch (e) {
    res.status(200).json({ total: 0, prospectos: [], error: String((e && e.message) || e).slice(0, 200) });
  }
};
