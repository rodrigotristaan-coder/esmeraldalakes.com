// Función serverless: recibe la solicitud de reserva, valida, re-chequea
// disponibilidad y notifica al anfitrión por Telegram con un link de confirmación.
const { sign, getAllBlocks, rangeOverlaps, sendEmail } = require("./_lib");

const htmlEsc = (s = "") => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])).slice(0, 600);

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

  const host = req.headers.host || "esmeraldalakes.com";
  const sig = sign(b.checkin + "|" + b.checkout);
  const confirmUrl = `https://${host}/api/confirm?ci=${b.checkin}&co=${b.checkout}&sig=${sig}`;

  const text = [
    "🆕 *Nueva solicitud de reserva* (esmeraldalakes.com)",
    conflict ? "⚠️ *OJO: estas fechas ya parecen ocupadas (Airbnb o reserva directa).*" : null,
    "",
    `👤 *Nombre:* ${esc(b.name)}`,
    `✉️ *Correo:* ${esc(b.email)}`,
    b.phone ? `📱 *Tel/WhatsApp:* ${esc(b.phone)}` : null,
    `📅 *Llegada:* ${esc(b.checkin)}   *Salida:* ${esc(b.checkout)}  (${nights} noches)`,
    `👥 *Huéspedes:* ${esc(b.guests)}`,
    b.message ? `📝 *Mensaje:* ${esc(b.message)}` : null,
    "",
    "Cuando lo confirmes con el huésped, bloquea estas fechas (web + Airbnb):",
    confirmUrl,
  ].filter(Boolean).join("\n");

  try {
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
    });
    if (!tg.ok) throw new Error("telegram " + tg.status);

    // Correos (best-effort; solo si RESEND_API_KEY está configurada)
    await sendBookingEmails(b, nights);

    return res.status(200).json({ ok: true, conflict });
  } catch (err) {
    console.error("Error Telegram:", err.message);
    return res.status(500).json({ ok: false, error: "No se pudo notificar" });
  }
};

async function sendBookingEmails(b, nights) {
  const en = b.lang === "en";
  const name = htmlEsc(b.name), ci = htmlEsc(b.checkin), co = htmlEsc(b.checkout), g = htmlEsc(b.guests);
  const wrap = (inner) =>
    `<div style="font-family:system-ui,Arial,sans-serif;max-width:540px;margin:auto;color:#16231f;line-height:1.6">${inner}<p style="color:#5e6e68;font-size:.8rem;margin-top:24px">Esmeralda · Condominio Diamante Lakes · Acapulco<br><a href="https://esmeraldalakes.com" style="color:#0a5944">esmeraldalakes.com</a></p></div>`;

  // 1) Confirmación al huésped
  const guestSubject = en ? "We received your booking request · Esmeralda Acapulco" : "Recibimos tu solicitud de reserva · Esmeralda Acapulco";
  const guestHtml = wrap(
    en
      ? `<h2 style="color:#0a5944">Thank you, ${name}! 🌴</h2><p>We received your booking request for <b>Esmeralda — Diamante Lakes</b>, Acapulco.</p><p><b>Check-in:</b> ${ci}<br><b>Check-out:</b> ${co} (${nights} nights)<br><b>Guests:</b> ${g}</p><p>We'll contact you shortly to confirm availability, price and payment. This is not a final confirmation yet.</p>`
      : `<h2 style="color:#0a5944">¡Gracias, ${name}! 🌴</h2><p>Recibimos tu solicitud de reserva para <b>Esmeralda — Diamante Lakes</b>, Acapulco.</p><p><b>Llegada:</b> ${ci}<br><b>Salida:</b> ${co} (${nights} noches)<br><b>Huéspedes:</b> ${g}</p><p>Te contactaremos muy pronto para confirmar disponibilidad, precio y forma de pago. Aún no es una confirmación final.</p>`
  );
  await sendEmail(b.email, guestSubject, guestHtml);

  // 2) Copia al anfitrión (respaldo del Telegram)
  if (process.env.OWNER_EMAIL) {
    const ownerHtml = wrap(
      `<h2 style="color:#0a5944">Nueva solicitud de reserva</h2><p><b>Nombre:</b> ${name}<br><b>Correo:</b> ${htmlEsc(b.email)}<br>${b.phone ? `<b>Tel:</b> ${htmlEsc(b.phone)}<br>` : ""}<b>Llegada:</b> ${ci} · <b>Salida:</b> ${co} (${nights} noches)<br><b>Huéspedes:</b> ${g}</p>${b.message ? `<p><b>Mensaje:</b> ${htmlEsc(b.message)}</p>` : ""}`
    );
    await sendEmail(process.env.OWNER_EMAIL, `Reserva: ${name} (${ci}→${co})`, ownerHtml);
  }
}
