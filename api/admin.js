// Panel de administración (protegido con ADMIN_KEY): fechas, reseñas, clientes y finanzas.
const crypto = require("crypto");
const { safeEqual, readBlocks, addBlock, removeBlock, updateBlock, getAllBlocks, readReviews, writeReviews, readCustomers, writeCustomers, seedCustomer, normEmail, readSession, readFinance, writeFinance, readFinanceDoc, writeFinanceDoc, notaKey, aplicarNotas } = require("./_lib");

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

  // Arma las listas que pinta el panel a partir de las reservas directas que YA
  // están en memoria. Se usa después de escribir para devolver la lista
  // autoritativa: si el panel volviera a pedir "list", esa relectura puede traer
  // una copia vieja del blob y la reserva recién hecha "desaparece" hasta el
  // siguiente refresh. Mismo arreglo que ya llevan finanzas, reseñas y clientes.
  const upcoming = (arr, today) => arr.filter((b) => (b.end || b.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
  // Estancias que ya terminaron, de la más reciente hacia atrás. Sin esto el panel
  // solo enseñaba el futuro y los huéspedes anteriores desaparecían del todo.
  // Ojo: de Airbnb no habrá historial — su iCal solo exporta fechas futuras.
  const pasadas = (arr, today) => arr.filter((b) => (b.end || b.start) < today)
    .sort((a, b) => b.start.localeCompare(a.start)).slice(0, 80);
  const listsFrom = async (direct) => {
    const today = new Date().toISOString().slice(0, 10);
    // Las notas ponen nombre a lo que llega de Airbnb (su iCal solo manda fechas)
    let notas = {};
    try { notas = (await readFinanceDoc()).notas; } catch { /* sin notas se ve igual, solo sin nombres */ }
    const todos = aplicarNotas(await getAllBlocks(direct), notas);
    return {
      direct: upcoming(aplicarNotas(direct, notas), today),
      all: upcoming(todos, today),
      pasadas: pasadas(todos, today),
    };
  };

  try {
    if (action === "release") {
      if (!validDate(start) || !validDate(end)) return res.status(422).json({ ok: false, error: "fechas" });
      const blocks = await removeBlock(start, end);
      return res.status(200).json({ ok: true, ...(await listsFrom(blocks)) });
    }
    if (action === "block") {
      if (!validDate(start) || !validDate(end) || end <= start) return res.status(422).json({ ok: false, error: "fechas" });
      const blocks = await addBlock(start, end, {
        name: q.name, guests: q.guests, rate: q.rate,
        checkinTime: q.checkinTime, checkoutTime: q.checkoutTime,
        referredBy: q.referredBy, freeNight: q.freeNight,
      });
      return res.status(200).json({ ok: true, ...(await listsFrom(blocks)) });
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
      return res.status(200).json({ ok: true, block: r.block, ...(await listsFrom(r.blocks)) });
    }
    // Ponerle nombre (y datos) a una reserva que llega de Airbnb: su iCal solo
    // manda fechas, así que lo demás se anota a mano y se guarda aparte.
    if (action === "note-set") {
      if (!validDate(start) || !validDate(end) || end <= start) return res.status(422).json({ ok: false, error: "fechas" });
      const doc = await readFinanceDoc();
      const k = notaKey(start, end);
      const nombre = String(q.name || "").trim().slice(0, 80);
      if (!nombre && !q.guests && !q.rate) {
        delete doc.notas[k];
      } else {
        const n = { name: nombre };
        const g = parseInt(q.guests, 10);
        if (g > 0 && g <= 20) n.guests = g;
        const r = Math.round(Number(q.rate) * 100) / 100;
        if (r > 0 && r <= 1000000) n.rate = r;
        doc.notas[k] = n;
      }
      await writeFinanceDoc(doc);
      return res.status(200).json({ ok: true, ...(await listsFrom(await readBlocks())) });
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
      // Lista autoritativa (ya en memoria): el cliente la aplica sin releer el blob.
      return res.status(200).json({ ok: true, reviews: all.slice().sort((a, b) => b.ts - a.ts) });
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
      const lista = Object.values(customers).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return res.status(200).json({ ok: true, freeNights: c.freeNights, customers: lista });
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
    // Pronto pago: algunos cobros (la cuota del condominio) valen menos si se
    // pagan antes de cierto día del mes y suben después. dayLimit = último día
    // con el precio bajo; amountLate = lo que cuesta a partir del día siguiente.
    const prontoPago = (q, destino) => {
      if (q.dayLimit !== undefined) {
        const d = parseInt(q.dayLimit, 10);
        if (d >= 1 && d <= 28) destino.dayLimit = d; else delete destino.dayLimit;
      }
      if (q.amountLate !== undefined) {
        const a = Math.round(Number(q.amountLate) * 100) / 100;
        if (a > 0 && a <= 5000000) destino.amountLate = a; else delete destino.amountLate;
      }
      // Sin los dos campos no hay recargo que aplicar
      if (destino.dayLimit === undefined || destino.amountLate === undefined) {
        delete destino.dayLimit; delete destino.amountLate;
      }
      // Cada cuántos meses se cobra (la luz de CFE es bimestral)
      if (q.cadaMeses !== undefined) {
        const c = parseInt(q.cadaMeses, 10);
        if (c >= 2 && c <= 12) destino.cadaMeses = c; else delete destino.cadaMeses;
      }
      // Cobro de monto variable que corresponde al consumo del mes anterior (gas)
      if (q.periodoAnterior !== undefined) {
        if (q.periodoAnterior === "1" || q.periodoAnterior === "true") destino.periodoAnterior = true;
        else delete destino.periodoAnterior;
      }
      return destino;
    };

    if (action === "recurring-add") {
      const type = q.type === "in" ? "in" : "out";
      const amount = Math.round(Number(q.amount) * 100) / 100;
      const concept = String(q.concept || "").trim().slice(0, 120);
      const day = Math.min(28, Math.max(1, parseInt(q.day, 10) || 1));
      if (!concept || !(amount > 0) || amount > 5000000) return res.status(422).json({ ok: false, error: "datos" });
      const doc = await readFinanceDoc();
      doc.recurring.push(prontoPago(q, {
        id: crypto.randomBytes(5).toString("hex"), type, concept,
        category: String(q.category || "").trim().slice(0, 40) || "Otro gasto",
        amount, day, activo: true, at: new Date().toISOString(),
      }));
      await writeFinanceDoc(doc);
      return res.status(200).json({ ok: true, recurring: doc.recurring });
    }
    // Editar un recurrente (antes solo se podía borrar y volver a crear)
    if (action === "recurring-update") {
      const doc = await readFinanceDoc();
      const i = doc.recurring.findIndex((r) => r.id === q.id);
      if (i < 0) return res.status(404).json({ ok: false, error: "recurrente" });
      const r = { ...doc.recurring[i] };
      if (q.concept !== undefined) { const c = String(q.concept).trim().slice(0, 120); if (!c) return res.status(422).json({ ok: false, error: "concepto" }); r.concept = c; }
      if (q.category !== undefined) r.category = String(q.category).trim().slice(0, 40);
      if (q.day !== undefined) r.day = Math.min(28, Math.max(1, parseInt(q.day, 10) || 1));
      if (q.amount !== undefined) {
        const a = Math.round(Number(q.amount) * 100) / 100;
        if (!(a > 0) || a > 5000000) return res.status(422).json({ ok: false, error: "monto" });
        r.amount = a;
      }
      doc.recurring[i] = prontoPago(q, r);
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
      const lista = Object.values(r.customers || {}).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return res.status(200).json({ ok: true, email: r.email, refCode: r.refCode, customers: lista });
    }

    // list (una sola lectura del blob: la comparten "direct" y "all")
    return res.status(200).json({ ok: true, ...(await listsFrom(await readBlocks())) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
