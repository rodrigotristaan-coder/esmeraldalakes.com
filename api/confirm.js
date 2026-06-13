// El anfitrión confirma una reserva tocando el link que llega a su Telegram.
// Verifica la firma, guarda las fechas como bloqueadas (web + Airbnb vía .ics).
const { sign, addBlock } = require("./_lib");

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;text-align:center;color:#16231f">` +
  `<h2 style="color:#0a5944">${title}</h2>${body}</div>`;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const { ci, co, sig } = req.query || {};

  if (!ci || !co || !sig || sign(ci + "|" + co) !== sig) {
    return res.status(403).send(page("Enlace inválido o caducado", "<p>No se pudo validar la confirmación.</p>"));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ci) || !/^\d{4}-\d{2}-\d{2}$/.test(co) || co <= ci) {
    return res.status(400).send(page("Fechas inválidas", "<p>Revisa las fechas.</p>"));
  }
  try {
    await addBlock(ci, co);
    return res.status(200).send(
      page("✅ Reserva confirmada", `<p>Bloqueé del <b>${ci}</b> al <b>${co}</b>.</p><p>Ya aparece como ocupado en tu web, y Airbnb lo tomará en su próxima sincronización.</p>`)
    );
  } catch (e) {
    return res.status(500).send(page("Error al guardar", `<p>${e.message}</p>`));
  }
};
