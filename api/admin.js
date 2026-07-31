// Panel de administración (protegido con ADMIN_KEY): fechas, reseñas, clientes y finanzas.
const crypto = require("crypto");
const { safeEqual, readBlocks, addBlock, removeBlock, updateBlock, getAllBlocks, readReviews, writeReviews, readCustomers, writeCustomers, seedCustomer, normEmail, readSession, readFinance, writeFinance, readFinanceDoc, writeFinanceDoc } = require("./_lib");

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
      await addBlock(start, end, {
        name: q.name, guests: q.guests, rate: q.rate,
        checkinTime: q.checkinTime, checkoutTime: q.checkoutTime,
        referredBy: q.referredBy, freeNight: q.freeNight,
      });
      return res.status(200).json({ ok: true });
    }
    if (action === "block-update") {
      if (!validDate(q.ostart) || !validDate(q.oend)) return res.status(422).json({ ok: false, error: "fechas" });
      if ((q.start && !validDate(q.start)) || (q.end && !validDate(q.end))) return res.status(422).json({ ok: false, error: "fechas" });
      const r = await updateBlock(q.ostart, q.oend, {
        start: q.start, end: q.end, name: q.name, guests: q.guests, rate: q.rate,
        checkinTime: q.checkinTime, checkoutTime: q.checkoutTime,
        referredBy: q.referredBy, freeNight: q.freeNight,
      });
      if (!r.ok) return res.status(422).json({ ok: false, error: r.reason });
      return res.status(200).json({ ok: true, block: r.block });
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
    // --- Finanzas (ingresos y gastos) ---
    if (action === "finance-list") {
      const movs = (await readFinance()).sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
      return res.status(200).json({ ok: true, movs });
    }
    if (action === "finance-add") {
      const type = q.type === "out" ? "out" : q.type === "in" ? "in" : null;
      const amount = Math.round(Number(q.amount) * 100) / 100;
      const concept = String(q.concept || "").trim().slice(0, 120);
      const category = String(q.category || "").trim().slice(0, 40) || (type === "in" ? "Otro ingreso" : "Otro gasto");
      if (!type || !validDate(q.date) || !concept || !(amount > 0) || amount > 5000000) {
        return res.status(422).json({ ok: false, error: "datos" });
      }
      const movs = await readFinance();
      const guest = String(q.guest || "").trim().slice(0, 80);
      const mov = { id: crypto.randomBytes(5).toString("hex"), type, date: q.date, concept, category, amount, guest, at: new Date().toISOString() };
      movs.push(mov);
      await writeFinance(movs);
      // Devuelve la lista autoritativa (ya en memoria tras el put): el cliente la
      // usa directo y NO relee el blob (evita read-after-write stale = mov "perdido").
      const sorted = movs.slice().sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
      return res.status(200).json({ ok: true, mov, movs: sorted });
    }
    // Editar un movimiento existente (solo los campos que vengan).
    if (action === "finance-update") {
      const movs = await readFinance();
      const i = movs.findIndex((m) => m.id === q.id);
      if (i < 0) return res.status(404).json({ ok: false, error: "movimiento" });
      const m = { ...movs[i] };
      if (q.type === "in" || q.type === "out") m.type = q.type;
      if (q.date !== undefined) { if (!validDate(q.date)) return res.status(422).json({ ok: false, error: "fecha" }); m.date = q.date; }
      if (q.concept !== undefined) { const c = String(q.concept).trim().slice(0, 120); if (!c) return res.status(422).json({ ok: false, error: "concepto" }); m.concept = c; }
      if (q.category !== undefined) m.category = String(q.category).trim().slice(0, 40);
      if (q.guest !== undefined) m.guest = String(q.guest).trim().slice(0, 80);
      if (q.amount !== undefined) {
        const a = Math.round(Number(q.amount) * 100) / 100;
        if (!(a > 0) || a > 5000000) return res.status(422).json({ ok: false, error: "monto" });
        m.amount = a;
      }
      movs[i] = m;
      await writeFinance(movs);
      const sorted = movs.slice().sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
      return res.status(200).json({ ok: true, mov: m, movs: sorted });
    }

    // --- Gastos recurrentes (internet, luz, gas, jardín, limpieza...) ---
    if (action === "recurring-list") {
      const doc = await readFinanceDoc();
      return res.status(200).json({ ok: true, recurring: doc.recurring });
    }
    if (action === "recurring-add") {
      const type = q.type === "in" ? "in" : "out";
      const amount = Math.round(Number(q.amount) * 100) / 100;
      const concept = String(q.concept || "").trim().slice(0, 120);
      const day = Math.min(28, Math.max(1, parseInt(q.day, 10) || 1));
      if (!concept || !(amount > 0) || amount > 5000000) return res.status(422).json({ ok: false, error: "datos" });
      const doc = await readFinanceDoc();
      doc.recurring.push({
        id: crypto.randomBytes(5).toString("hex"), type, concept,
        category: String(q.category || "").trim().slice(0, 40) || "Otro gasto",
        amount, day, activo: true, at: new Date().toISOString(),
      });
      await writeFinanceDoc(doc);
      return res.status(200).json({ ok: true, recurring: doc.recurring });
    }
    if (action === "recurring-del" || action === "recurring-toggle") {
      const doc = await readFinanceDoc();
      const i = doc.recurring.findIndex((r) => r.id === q.id);
      if (i < 0) return res.status(404).json({ ok: false, error: "recurrente" });
      if (action === "recurring-del") doc.recurring.splice(i, 1);
      else doc.recurring[i].activo = !doc.recurring[i].activo;
      await writeFinanceDoc(doc);
      return res.status(200).json({ ok: true, recurring: doc.recurring });
    }

    if (action === "finance-del") {
      const movs = await readFinance();
      const next = movs.filter((m) => m.id !== q.id);
      if (next.length === movs.length) return res.status(404).json({ ok: false, error: "movimiento" });
      await writeFinance(next);
      const sorted = next.slice().sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
      return res.status(200).json({ ok: true, movs: sorted });
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
