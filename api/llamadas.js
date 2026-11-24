// api/llamadas.js — Tablero de las llamadas de confirmacion que hace Lia.
// La bandeja no guarda nada de esto: solo le pasa el pedido a Lia
// (cita.kromagrupo.com/api/llamadas-panel) con el secreto del puente.
//   GET                                   -> interruptor, resumen de hoy, cola e historial
//   POST { accion:'interruptor', activo } -> prende o apaga las llamadas automaticas
//   POST { accion:'llamar', contactId }   -> llamada manual a ese paciente
// Env: INBOX_PASSWORD, PUENTE_SECRET, LIA_URL (opcional)
const LIA_URL = (process.env.LIA_URL || 'https://cita.kromagrupo.com').replace(/\/+$/, '');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.INBOX_PASSWORD || (req.headers['x-inbox-pass'] || '') !== process.env.INBOX_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  if (!process.env.PUENTE_SECRET) {
    res.status(200).json({ ok: false, motivo: 'Esta bandeja no esta conectada con Lia.' }); return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ ok: false, motivo: 'metodo no permitido' }); return; }

  let cuerpo;
  if (req.method === 'POST') {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
    b = b || {};
    // Solo pasan las dos acciones conocidas, con sus campos y nada mas.
    if (b.accion === 'interruptor' && typeof b.activo === 'boolean') cuerpo = { accion: 'interruptor', activo: b.activo, cual: /^[a-z_]{3,20}$/.test(String(b.cual || '')) ? b.cual : 'confirmacion' };
    else if (b.accion === 'llamar' && typeof b.contactId === 'string') cuerpo = { accion: 'llamar', contactId: b.contactId.slice(0, 60) };
    else if (b.accion === 'buscar' && typeof b.texto === 'string') cuerpo = { accion: 'buscar', texto: b.texto.slice(0, 60) };
    else { res.status(400).json({ ok: false, motivo: 'pedido no reconocido' }); return; }
  }

  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), 28000);
  try {
    const r = await fetch(LIA_URL + '/api/llamadas-panel', {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'x-puente-secret': process.env.PUENTE_SECRET },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => null);
    if (!j) { res.status(200).json({ ok: false, motivo: 'Lia no respondio (' + r.status + '). Intenta de nuevo.' }); return; }
    res.status(200).json(j);
  } catch (e) {
    res.status(200).json({ ok: false, motivo: 'No pude hablar con Lia. Intenta de nuevo.' });
  } finally { clearTimeout(reloj); }
};
