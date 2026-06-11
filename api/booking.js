// Función serverless de Vercel: recibe la solicitud de reserva de la web
// y la notifica al anfitrión por Telegram. El token vive solo en las variables
// de entorno de Vercel (nunca en el código del sitio).

const esc = (s = "") =>
  String(s)
    .replace(/[*_`\[\]]/g, "")          // neutraliza Markdown
    .replace(/[\u0000-\u001f]+/g, " ")  // quita caracteres de control
    .trim()
    .slice(0, 500);

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const b = req.body || {};

  // Honeypot anti-bots: si llenaron el campo oculto, fingimos éxito y descartamos.
  if (b.company) return res.status(200).json({ ok: true });

  if (!b.name || !b.email || !b.checkin || !b.checkout) {
    return res.status(422).json({ ok: false, error: "Faltan campos" });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(b.checkin)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(b.checkout))) {
    return res.status(422).json({ ok: false, error: "Datos inválidos" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OWNER_CHAT_ID;
  if (!token || !chatId) {
    console.error("Faltan TELEGRAM_BOT_TOKEN u OWNER_CHAT_ID");
    return res.status(500).json({ ok: false, error: "config" });
  }

  const text = [
    "🆕 *Nueva solicitud de reserva* (esmeraldalakes.com)",
    "",
    `👤 *Nombre:* ${esc(b.name)}`,
    `✉️ *Correo:* ${esc(b.email)}`,
    b.phone ? `📱 *Tel/WhatsApp:* ${esc(b.phone)}` : null,
    `📅 *Llegada:* ${esc(b.checkin)}   *Salida:* ${esc(b.checkout)}`,
    `👥 *Huéspedes:* ${esc(b.guests)}`,
    b.message ? `📝 *Mensaje:* ${esc(b.message)}` : null,
    "",
    "_Responde al huésped para confirmar disponibilidad y precio._",
  ].filter(Boolean).join("\n");

  try {
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
    });
    if (!tg.ok) throw new Error("telegram " + tg.status);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error enviando a Telegram:", err.message);
    return res.status(500).json({ ok: false, error: "No se pudo notificar" });
  }
};
