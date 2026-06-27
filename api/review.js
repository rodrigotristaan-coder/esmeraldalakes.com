// Reseñas: GET devuelve las aprobadas (para la web); POST recibe una nueva (queda pendiente
// hasta que la apruebes en /admin.html). Foto opcional como data URL (redimensionada en el cliente).
const crypto = require("crypto");
const { readReviews, writeReviews } = require("./_lib");

const clean = (s = "", n = 600) =>
  String(s).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  // --- Lista pública (solo aprobadas) ---
  if (req.method === "GET") {
    const approved = (await readReviews())
      .filter((r) => r.status === "approved")
      .sort((a, b) => b.ts - a.ts)
      .map((r) => ({ name: r.name, rating: r.rating, text: r.text, photo: r.photo || null, ts: r.ts }));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ reviews: approved });
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const b = req.body || {};
  if (b.company) return res.status(200).json({ ok: true }); // honeypot anti-bots

  const name = clean(b.name, 60);
  const text = clean(b.text, 800);
  const rating = Math.max(1, Math.min(5, parseInt(b.rating, 10) || 0));
  if (!name || !text || !rating) return res.status(422).json({ ok: false, error: "Faltan campos" });

  // Foto opcional: solo data URL de imagen y con tope de tamaño (~140 KB)
  let photo = null;
  if (typeof b.photo === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(b.photo) && b.photo.length < 140000) {
    photo = b.photo;
  }

  const review = {
    id: crypto.randomBytes(6).toString("hex"),
    name, rating, text, photo,
    status: "pending",
    ts: Date.now(),
  };

  try {
    const all = await readReviews();
    all.push(review);
    await writeReviews(all);
  } catch (e) {
    console.error("review save:", e.message);
    return res.status(500).json({ ok: false, error: "No se pudo guardar" });
  }

  // Aviso por Telegram (best-effort)
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.OWNER_CHAT_ID;
  if (token && chatId) {
    const msg = `📝 *Nueva reseña pendiente* (esmeraldalakes.com)\n\n${"⭐".repeat(rating)} (${rating}/5)\n👤 ${name}\n\n${text}\n\nApruébala o recházala en el panel: /admin.html`;
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown", disable_web_page_preview: true }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true });
};
