// Portal: datos del cliente autenticado (lee la cookie de sesión).
// Aquí viven TODAS las acciones del huésped sobre su propia ficha: el plan Hobby
// de Vercel permite 12 funciones y ya estamos en 12, así que no se puede crear un
// endpoint nuevo y se distinguen con ?action=.
const { readSession, readCustomers, mutarClientes, sanitizeCliente, REGLAMENTO_VERSION } = require("./_lib");

const SITE = "https://esmeraldalakes.com";

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const sess = readSession(req.headers.cookie);
  if (!sess) return res.status(401).json({ ok: false, error: "auth" });
  // Sesión admin: no hay dashboard de cliente; el front redirige a /admin.html.
  if (sess.admin) return res.status(200).json({ ok: true, admin: true });

  const q = req.query || {};
  const action = q.action || "me";

  try {
    const customers = await readCustomers();
    const c = customers[sess.email];
    if (!c) return res.status(401).json({ ok: false, error: "noaccount" });

    // --- El huésped completa sus datos de contacto ---
    if (action === "perfil") {
      const campos = sanitizeCliente({ name: q.name, phone: q.phone });
      if (!campos.name && !campos.phone) return res.status(422).json({ ok: false, error: "datos" });
      const out = await mutarClientes(
        (cs) => { const x = cs[sess.email]; if (!x) return { error: "cliente" }; Object.assign(x, campos); },
        (cs) => { const x = cs[sess.email]; return !!x && Object.keys(campos).every((k) => (x[k] || "") === campos[k]); }
      );
      if (out.error) return res.status(500).json({ ok: false, error: out.error });
      const y = out.doc[sess.email];
      return res.status(200).json({ ok: true, name: y.name || "", phone: y.phone || "" });
    }

    // --- El huésped acepta el reglamento del condominio ---
    // Se guarda constancia (quién, cuándo, con qué nombre y qué versión) en vez
    // de una foto del papel firmado: queda fechada, no se puede rehacer después
    // y no obliga a almacenar documentos.
    if (action === "reglamento") {
      const nombre = String(q.nombre || "").trim().slice(0, 80);
      if (nombre.length < 5 || !nombre.includes(" ")) {
        return res.status(422).json({ ok: false, error: "nombre-completo" });
      }
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim().slice(0, 45);
      const constancia = {
        version: REGLAMENTO_VERSION,
        at: new Date().toISOString(),
        nombre,
        ip,
        ua: String(req.headers["user-agent"] || "").slice(0, 120),
      };
      const out = await mutarClientes(
        (cs) => { const x = cs[sess.email]; if (!x) return { error: "cliente" }; x.reglamento = constancia; },
        (cs) => { const x = cs[sess.email]; return !!(x && x.reglamento && x.reglamento.at === constancia.at); }
      );
      if (out.error) return res.status(500).json({ ok: false, error: out.error });
      return res.status(200).json({ ok: true, reglamento: { version: constancia.version, at: constancia.at, nombre: constancia.nombre } });
    }

    // --- Datos del cliente (acción por defecto) ---
    const referrals = (c.credits || []).filter((x) => x.type === "referral").length;
    const reservations = (c.reservations || [])
      .slice()
      .sort((a, z) => (z.checkin || "").localeCompare(a.checkin || ""));

    return res.status(200).json({
      ok: true,
      name: c.name || "",
      email: c.email,
      phone: c.phone || "",
      refCode: c.refCode,
      referralLink: `${SITE}/?ref=${c.refCode}`,
      freeNights: c.freeNights || 0,
      referrals,
      reservations,
      reglamentoVigente: REGLAMENTO_VERSION,
      // Solo lo necesario para pintar el estado; sin IP ni user-agent.
      reglamento: c.reglamento ? { version: c.reglamento.version, at: c.reglamento.at, nombre: c.reglamento.nombre } : null,
    });
  } catch (e) {
    console.error("portal-me:", e.message);
    return res.status(500).json({ ok: false, error: "server" });
  }
};
