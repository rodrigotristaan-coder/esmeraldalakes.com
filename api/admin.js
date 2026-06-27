// Panel de administración (protegido con ADMIN_KEY): ver, liberar y bloquear fechas.
const { safeEqual, readBlocks, addBlock, removeBlock, getAllBlocks, readReviews, writeReviews } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const q = req.query || {};
  const key = q.key || req.headers["x-admin-key"];

  if (!process.env.ADMIN_KEY || !key || !safeEqual(key, process.env.ADMIN_KEY)) {
    return res.status(401).json({ ok: false, error: "no autorizado" });
  }

  const action = q.action || "list";
  const { start, end } = q;
  const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

  try {
    if (action === "release") {
      if (!validDate(start) || !validDate(end)) return res.status(422).json({ ok: false, error: "fechas" });
      await removeBlock(start, end);
      return res.status(200).json({ ok: true });
    }
    if (action === "block") {
      if (!validDate(start) || !validDate(end) || end <= start) return res.status(422).json({ ok: false, error: "fechas" });
      await addBlock(start, end);
      return res.status(200).json({ ok: true });
    }
    // --- Reseñas ---
    if (action === "reviews") {
      const reviews = (await readReviews()).sort((a, b) => b.ts - a.ts);
      return res.status(200).json({ ok: true, reviews });
    }
    if (action === "review-approve" || action === "review-reject") {
      const id = q.id;
      let all = await readReviews();
      if (action === "review-approve") all = all.map((r) => (r.id === id ? { ...r, status: "approved" } : r));
      else all = all.filter((r) => r.id !== id);
      await writeReviews(all);
      return res.status(200).json({ ok: true });
    }

    // list
    const today = new Date().toISOString().slice(0, 10);
    const direct = (await readBlocks()).filter((b) => (b.end || b.start) >= today)
      .sort((a, b) => a.start.localeCompare(b.start));
    const all = (await getAllBlocks()).filter((b) => (b.end || b.start) >= today)
      .sort((a, b) => a.start.localeCompare(b.start));
    return res.status(200).json({ ok: true, direct, all });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
