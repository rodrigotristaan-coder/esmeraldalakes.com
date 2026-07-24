// Registra el webhook de Telegram (una sola vez). Protegido con ADMIN_KEY.
// Usa el token del servidor (nunca se expone). Hit: /api/setup-webhook?key=ADMIN_KEY
const { safeEqual } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const key = (req.query || {}).key;
  if (!process.env.ADMIN_KEY || !key || !safeEqual(key, process.env.ADMIN_KEY)) {
    return res.status(401).json({ ok: false, error: "no autorizado" });
  }
  const url = `https://${req.headers.host}/api/telegram`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["callback_query", "message"],
      }),
    });
    const j = await r.json();
    // Menú de comandos del bot (autocompletado al escribir "/")
    const rc = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "calendario", description: "Foto del calendario al día" },
          { command: "ingreso", description: "Registrar ingreso: /ingreso 4500 Reserva María" },
          { command: "gasto", description: "Registrar gasto: /gasto 650 Limpieza" },
        ],
      }),
    });
    const jc = await rc.json();
    return res.status(200).json({ ok: j.ok, url, telegram: j, commands: jc.ok });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
