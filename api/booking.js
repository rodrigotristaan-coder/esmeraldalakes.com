// Función serverless: recibe la solicitud de reserva, valida, re-chequea
// disponibilidad y notifica al anfitrión por Telegram con un link de confirmación.
const { getAllBlocks, rangeOverlaps } = require("./_lib");

const esc = (s = "") =>
  String(s)
    .replace(/[*_`\[\]]/g, "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .trim()
    .slice(0, 500);

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const b = req.body || {};

  // Anti-bots: honeypot + trampa de tiempo (envío demasiado rápido).
  if (b.company) return res.status(200).json({ ok: true });
  const ts = Number(b.ts || 0);
  if (ts && Date.now() - ts < 2500) return res.status(200).json({ ok: true });

  if (!b.name || !b.email || !b.checkin || !b.checkout) {
    return res.status(422).json({ ok: false, error: "Faltan campos" });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(b.checkin)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(b.checkout)) ||
      b.checkout <= b.checkin) {
    return res.status(422).json({ ok: false, error: "Datos inválidos" });
  }

  // Mínimo de noches
  const MIN = Number(process.env.MIN_NIGHTS || 2);
  const nights = Math.round((new Date(b.checkout) - new Date(b.checkin)) / 86400000);
  if (nights < MIN) {
    return res.status(422).json({ ok: false, error: `min_nights`, min: MIN });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OWNER_CHAT_ID;
  if (!token || !chatId) return res.status(500).json({ ok: false, error: "config" });

  // Re-chequeo de disponibilidad del lado del servidor
  let conflict = false;
  try { conflict = rangeOverlaps(b.checkin, b.checkout, await getAllBlocks()); } catch {}

  // Código de referido (opcional): ESM-XXXX. Se normaliza y se incluye en el mensaje
  // para que el handler de confirmación acredite la noche gratis al dueño del código.
  const refcode = (String(b.refcode || "").trim().toUpperCase().match(/^ESM-[A-Z0-9]{4,8}$/) || [])[0] || "";

  const text = [
    "🆕 *Nueva solicitud de reserva* (esmeraldalakes.com)",
    conflict ? "⚠️ *OJO: estas fechas ya parecen ocupadas (Airbnb o reserva directa).*" : null,
    "",
    `👤 *Nombre:* ${esc(b.name)}`,
    `✉️ *Correo:* ${esc(b.email)}`,
    b.phone ? `📱 *Tel/WhatsApp:* ${esc(b.phone)}` : null,
    `📅 *Llegada:* ${esc(b.checkin)}   *Salida:* ${esc(b.checkout)}  (${nights} noches)`,
    `👥 *Huéspedes:* ${esc(b.guests)}`,
    b.country ? `🌎 *País:* ${esc(b.country)}` : null,
    refcode ? `🎟 *Código ref:* ${refcode}` : null,
    b.message ? `📝 *Mensaje:* ${esc(b.message)}` : null,
    "",
    "Cuando recibas el pago, márcalo con el botón 👇 — bloquea las fechas, manda la confirmación al huésped y crea el evento en tu calendario (te pedirá confirmar para no hacerlo por error).",
    process.env.EXCEL_VIEW_URL ? `\n📊 Reservas (solo lectura): ${process.env.EXCEL_VIEW_URL}` : null,
  ].filter(Boolean).join("\n");

  const reply_markup = {
    inline_keyboard: [[{ text: "💰 Pago recibido", callback_data: `ask|${b.checkin}|${b.checkout}|${b.lang || "es"}` }]],
  };

  try {
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true, reply_markup }),
    });
    if (!tg.ok) throw new Error("telegram " + tg.status);

    // Bitácora en Excel (OneDrive) + correo a anfitriones y acuse al huésped, vía n8n→M365 (best-effort)
    await notifyN8n(b, nights);

    return res.status(200).json({ ok: true, conflict });
  } catch (err) {
    console.error("Error Telegram:", err.message);
    return res.status(500).json({ ok: false, error: "No se pudo notificar" });
  }
};

// Envía la solicitud a n8n: registra fila en "Reservas Esmeralda.xlsx" (OneDrive) y
// notifica por correo a los anfitriones desde hola@satorimkt.com (M365). Best-effort.
async function notifyN8n(b, nights) {
  const url = process.env.N8N_BOOKING_WEBHOOK;
  if (!url) return;
  const payload = {
    fecha: new Date().toISOString().slice(0, 10),
    name: b.name, email: b.email, phone: b.phone || "",
    checkin: b.checkin, checkout: b.checkout, nights,
    guests: b.guests, message: b.message || "", country: b.country || "", lang: b.lang || "es",
    secret: process.env.ESM_N8N_SECRET || "",
  };
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch (e) {
    console.error("n8n notify:", e.message);
  }
}
