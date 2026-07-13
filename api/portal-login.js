// Portal: paso 1 del magic-link. Recibe {email}; si ese correo tiene al menos una
// reserva confirmada, genera un código de 6 dígitos y lo envía por correo (n8n→M365).
// Respuesta SIEMPRE genérica para no revelar qué correos existen.
const { normEmail, isEmail, readCustomers, issueCode, isAdminEmail } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const b = req.body || {};
  if (b.company) return res.status(200).json({ ok: true }); // honeypot
  const email = normEmail(b.email);
  const lang = b.lang === "en" ? "en" : "es";
  if (!isEmail(email)) return res.status(422).json({ ok: false, error: "email" });

  try {
    const customers = await readCustomers();
    const admin = isAdminEmail(email);
    // Sin cuenta: se avisa al usuario (se obtiene tras la 1ª reserva con el socio).
    // Los correos admin siempre pasan (entran al panel, no al portal de cliente).
    if (!customers[email] && !admin) return res.status(200).json({ ok: true, exists: false });

    const issued = await issueCode(email);
    if (!issued.ok) {
      if (issued.reason === "cooldown") return res.status(429).json({ ok: false, error: "cooldown", wait: issued.wait });
      return res.status(200).json({ ok: true, exists: true }); // no se pudo emitir, pero la cuenta existe
    }

    const url = process.env.N8N_PORTAL_CODE_WEBHOOK;
    if (url) {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: issued.code, name: admin ? "Admin" : (customers[email].name || ""), lang, secret: process.env.ESM_N8N_SECRET || "" }),
      }).catch((e) => console.error("n8n portal code:", e.message));
    } else {
      console.error("N8N_PORTAL_CODE_WEBHOOK no configurado");
    }
    return res.status(200).json({ ok: true, exists: true });
  } catch (e) {
    console.error("portal-login:", e.message);
    return res.status(500).json({ ok: false, error: "server" });
  }
};
