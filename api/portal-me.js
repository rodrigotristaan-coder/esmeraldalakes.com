// Portal: datos del cliente autenticado (lee la cookie de sesión).
// Aquí viven TODAS las acciones del huésped sobre su propia ficha: el plan Hobby
// de Vercel permite 12 funciones y ya estamos en 12, así que no se puede crear un
// endpoint nuevo y se distinguen con ?action=.
const { readSession, readCustomers, mutarClientes, sanitizeCliente, REGLAMENTO_VERSION } = require("./_lib");

const SITE = "https://esmeraldalakes.com";

// Documentos que el huésped puede subir desde el portal.
const TIPOS_DOC = { ine: "identificación", pulseras: "pulseras" };
const MIMES_DOC = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

// Lo que el huésped ve de sus propios documentos: si ya lo mandó y cuándo.
// El enlace de OneDrive NO se devuelve — es una ruta interna del cliente y el
// huésped no tiene nada que hacer con ella.
const docsPublicos = (c) => {
  const d = (c && c.docs) || {};
  const out = {};
  for (const k of Object.keys(TIPOS_DOC)) out[k] = d[k] ? { at: d[k].at } : null;
  return out;
};

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

    // --- El huésped sube un documento (identificación o pulseras) ---
    // El archivo NO se guarda en el sitio: se pasa al puente de n8n, que lo
    // escribe en el OneDrive del cliente y devuelve el enlace. Aquí solo queda
    // ese enlace. Guardar identificaciones oficiales en un almacenamiento
    // público nos volvería custodios de material de robo de identidad.
    if (action === "documento") {
      const url = process.env.N8N_DOCS_WEBHOOK;
      if (!url) return res.status(503).json({ ok: false, error: "sin-puente" });
      const body = req.body || {};
      const tipo = TIPOS_DOC[String(body.tipo || "")] ? String(body.tipo) : "";
      const mime = MIMES_DOC.includes(body.mime) ? body.mime : "";
      const data = String(body.data || "");
      if (!tipo || !mime) return res.status(422).json({ ok: false, error: "tipo" });
      // El base64 abulta un tercio más que el archivo; 11 MB de texto son ~8 MB de foto.
      if (!data || data.length > 11000000) return res.status(422).json({ ok: false, error: "tamano" });

      let enlace = "";
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: sess.email, tipo, mime, data, secret: process.env.ESM_N8N_SECRET || "" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || `puente ${r.status}`);
        enlace = String(j.url || "");
      } catch (e) {
        console.error("documento:", e.message);
        return res.status(502).json({ ok: false, error: "subida" });
      }

      const ficha = { at: new Date().toISOString(), url: enlace };
      const out = await mutarClientes(
        (cs) => {
          const x = cs[sess.email];
          if (!x) return { error: "cliente" };
          if (!x.docs) x.docs = {};
          x.docs[tipo] = ficha;
          // El panel ya sabe pintar `ineUrl` en la ficha del cliente; lo llenamos
          // solo para que el enlace aparezca ahí sin tocar el panel.
          if (tipo === "ine" && enlace) x.ineUrl = enlace;
        },
        (cs) => { const x = cs[sess.email]; return !!(x && x.docs && x.docs[tipo] && x.docs[tipo].at === ficha.at); }
      );
      if (out.error) return res.status(500).json({ ok: false, error: out.error });
      return res.status(200).json({ ok: true, docs: docsPublicos(out.doc[sess.email]) });
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
      docs: docsPublicos(c),
    });
  } catch (e) {
    console.error("portal-me:", e.message);
    return res.status(500).json({ ok: false, error: "server" });
  }
};
