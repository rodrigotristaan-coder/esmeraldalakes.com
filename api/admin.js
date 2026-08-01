// Panel de administración (protegido con ADMIN_KEY): fechas, reseñas, clientes y finanzas.
const crypto = require("crypto");
const { safeEqual, readBlocks, addBlock, removeBlock, updateBlock, getAllBlocks, readReviews, writeReviews, readCustomers, writeCustomers, seedCustomer, normEmail, readSession, readFinance, writeFinance, readFinanceDoc, writeFinanceDoc, mutarFinanzas, mutarClientes, sanitizeCliente, notaKey, aplicarNotas, hoyMx } = require("./_lib");

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
  // `notasConocidas`: las notas que ACABAMOS de escribir. Sin esto, note-set
  // guardaba y enseguida releía el blob para responder — traía la copia vieja y
  // el nombre recién puesto no aparecía hasta refrescar.
  const listsFrom = async (direct, notasConocidas) => {
    const today = hoyMx();
    // Las notas ponen nombre a lo que llega de Airbnb (su iCal solo manda fechas)
    let notas = notasConocidas || {};
    if (!notasConocidas) {
      try { notas = (await readFinanceDoc()).notas; } catch { /* sin notas se ve igual, solo sin nombres */ }
    }
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
      const k = notaKey(start, end);
      const nombre = String(q.name || "").trim().slice(0, 80);
      const borra = !nombre && !q.guests && !q.rate;
      const nueva = { name: nombre };
      const g = parseInt(q.guests, 10);
      if (g > 0 && g <= 20) nueva.guests = g;
      const rr = Math.round(Number(q.rate) * 100) / 100;
      if (rr > 0 && rr <= 1000000) nueva.rate = rr;
      const out = await mutarFinanzas(
        (doc) => { if (borra) delete doc.notas[k]; else doc.notas[k] = nueva; },
        (doc) => (borra ? !doc.notas[k] : !!(doc.notas[k] && doc.notas[k].name === nombre))
      );
      if (out.error) return res.status(500).json({ ok: false, error: out.error });
      return res.status(200).json({ ok: true, ...(await listsFrom(await readBlocks(), out.doc.notas)) });
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
    // Ficha del cliente: contacto, notas y el enlace a su INE en Drive.
    // La INE nunca se sube aquí; solo se guarda a dónde está y si ya se revisó.
    if (action === "customer-update") {
      const email = normEmail(q.email);
      if (!email) return res.status(422).json({ ok: false, error: "correo" });
      const campos = sanitizeCliente({ name: q.name, phone: q.phone, notes: q.notes, ineUrl: q.ineUrl });
      const marcaIne = q.ineOk === "1" ? hoyMx() : q.ineOk === "0" ? "" : undefined;
      const out = await mutarClientes(
        (cs) => {
          const c = cs[email];
          if (!c) return { error: "cliente" };
          Object.assign(c, campos);
          if (marcaIne !== undefined) { if (marcaIne) c.ineVerificada = marcaIne; else delete c.ineVerificada; }
        },
        (cs) => {
          const c = cs[email];
          if (!c) return false;
          return Object.keys(campos).every((k) => (c[k] || "") === (campos[k] || ""));
        }
      );
      if (out.error) return res.status(out.error === "cliente" ? 404 : 500).json({ ok: false, error: out.error });
      const lista = Object.values(out.doc).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return res.status(200).json({ ok: true, customers: lista });
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
      const guest = String(q.guest || "").trim().slice(0, 80);
      const mov = { id: crypto.randomBytes(5).toString("hex"), type, date: q.date, concept, category, amount, guest, at: new Date().toISOString() };
      // Escritura verificada: si otra escritura la pisa, se reintenta sobre lo más fresco
      const out = await mutarFinanzas(
        // Idempotente a propósito: si el reintento encuentra que ya se guardó,
        // no lo mete otra vez (si no, un reintento crearía duplicados).
        (doc) => { if (!doc.movs.some((m) => m.id === mov.id)) doc.movs.push(mov); },
        (doc) => doc.movs.some((m) => m.id === mov.id)
      );
      if (out.error) return res.status(500).json({ ok: false, error: out.error });
      const sorted = out.doc.movs.slice().sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
      return res.status(200).json({ ok: true, mov, movs: sorted });
    }
    // Editar un movimiento existente (solo los campos que vengan).
    if (action === "finance-update") {
      const movs = await readFinance();
      const i0 = movs.findIndex((m) => m.id === q.id);
      if (i0 < 0) return res.status(404).json({ ok: false, error: "movimiento" });
      const m = { ...movs[i0] };
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
      const outU = await mutarFinanzas(
        (doc) => { const j = doc.movs.findIndex((x) => x.id === m.id); if (j < 0) return { error: "movimiento" }; doc.movs[j] = m; },
        (doc) => doc.movs.some((x) => x.id === m.id && Number(x.amount) === Number(m.amount) && x.concept === m.concept)
      );
      if (outU.error) return res.status(outU.error === "movimiento" ? 404 : 500).json({ ok: false, error: outU.error });
      const sorted = outU.doc.movs.slice().sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
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
      const nuevo = prontoPago(q, {
        id: crypto.randomBytes(5).toString("hex"), type, concept,
        category: String(q.category || "").trim().slice(0, 40) || "Otro gasto",
        amount, day, activo: true, at: new Date().toISOString(),
      });
      const outR = await mutarFinanzas(
        (doc) => { if (!doc.recurring.some((r) => r.id === nuevo.id)) doc.recurring.push(nuevo); },
        (doc) => doc.recurring.some((r) => r.id === nuevo.id)
      );
      if (outR.error) return res.status(500).json({ ok: false, error: outR.error });
      return res.status(200).json({ ok: true, recurring: outR.doc.recurring });
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
      const actualizado = prontoPago(q, r);
      const outRU = await mutarFinanzas(
        (d) => { const j = d.recurring.findIndex((x) => x.id === actualizado.id); if (j < 0) return { error: "recurrente" }; d.recurring[j] = actualizado; },
        (d) => d.recurring.some((x) => x.id === actualizado.id && Number(x.amount) === Number(actualizado.amount) && x.concept === actualizado.concept)
      );
      if (outRU.error) return res.status(outRU.error === "recurrente" ? 404 : 500).json({ ok: false, error: outRU.error });
      return res.status(200).json({ ok: true, recurring: outRU.doc.recurring });
    }
    if (action === "recurring-del" || action === "recurring-toggle") {
      const doc0 = await readFinanceDoc();
      const prev = doc0.recurring.find((r) => r.id === q.id);
      if (!prev) return res.status(404).json({ ok: false, error: "recurrente" });
      const borrar = action === "recurring-del";
      const nuevoEstado = !prev.activo;
      const outRT = await mutarFinanzas(
        (d) => {
          const j = d.recurring.findIndex((r) => r.id === q.id);
          if (j < 0) return { error: "recurrente" };
          if (borrar) d.recurring.splice(j, 1); else d.recurring[j].activo = nuevoEstado;
        },
        (d) => (borrar ? !d.recurring.some((r) => r.id === q.id)
                       : d.recurring.some((r) => r.id === q.id && r.activo === nuevoEstado))
      );
      if (outRT.error) return res.status(outRT.error === "recurrente" ? 404 : 500).json({ ok: false, error: outRT.error });
      return res.status(200).json({ ok: true, recurring: outRT.doc.recurring });
    }

    if (action === "finance-del") {
      const outD = await mutarFinanzas(
        (doc) => { const n = doc.movs.length; doc.movs = doc.movs.filter((m) => m.id !== q.id); if (n === doc.movs.length) return { error: "movimiento" }; },
        (doc) => !doc.movs.some((m) => m.id === q.id)
      );
      if (outD.error) return res.status(outD.error === "movimiento" ? 404 : 500).json({ ok: false, error: outD.error });
      const sorted = outD.doc.movs.slice().sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
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
