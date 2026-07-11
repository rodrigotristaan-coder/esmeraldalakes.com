// Panel de administración (protegido con ADMIN_KEY): ver, liberar y bloquear fechas.
const { safeEqual, readBlocks, addBlock, removeBlock, getAllBlocks, readReviews, writeReviews, readCustomers, writeCustomers, seedCustomer, normEmail, readSession } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const q = req.query || {};
  const key = q.key || req.headers["x-admin-key"];

  // Acepta: (a) ADMIN_KEY o PORTAL_SECRET (secretos server-only), o
  // (b) sesión magic-link con rol admin (cookie firmada del portal).
  const adminKey = process.env.ADMIN_KEY || "";
  const portalKey = process.env.PORTAL_SECRET || "";
  const keyAuthed = !!key && ((adminKey && safeEqual(key, adminKey)) || (portalKey && safeEqual(key, portalKey)));
  const sess = readSession(req.headers.cookie);
  const authed = keyAuthed || !!(sess && sess.admin);
  if (!authed) {
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

    // --- Clientes del portal ---
    if (action === "customers") {
      const customers = await readCustomers();
      const list = Object.values(customers).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return res.status(200).json({ ok: true, customers: list });
    }
    // Ajustar noches gratis: delta=-1 redime una noche, delta=1 acredita una manualmente.
    if (action === "customer-nights") {
      const email = normEmail(q.email);
      const delta = parseInt(q.delta, 10);
      if (!email || !delta || Math.abs(delta) > 30) return res.status(422).json({ ok: false, error: "datos" });
      const customers = await readCustomers();
      const c = customers[email];
      if (!c) return res.status(404).json({ ok: false, error: "cliente" });
      const before = c.freeNights || 0;
      if (delta < 0 && before + delta < 0) return res.status(422).json({ ok: false, error: "sin-noches" });
      c.freeNights = before + delta;
      c.credits = c.credits || [];
      c.credits.push({ type: delta < 0 ? "redeem" : "manual", nights: delta, at: new Date().toISOString() });
      await writeCustomers(customers);
      return res.status(200).json({ ok: true, freeNights: c.freeNights });
    }
    if (action === "customer-seed") {
      const sample = q.sci && q.sco
        ? { checkin: q.sci, checkout: q.sco, nights: Number(q.snights) || null, guests: Number(q.sguests) || null }
        : null;
      const r = await seedCustomer({ email: q.email, name: q.name, sampleReservation: sample });
      if (!r.ok) return res.status(422).json({ ok: false, error: r.reason });
      return res.status(200).json({ ok: true, email: r.email, refCode: r.refCode });
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
