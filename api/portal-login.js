// Portal: paso 1 del magic-link. Recibe {email}; si ese correo tiene al menos una
// reserva confirmada, genera un código de 6 dígitos y lo envía por correo (n8n→M365).
// Respuesta SIEMPRE genérica para no revelar qué correos existen.
const { normEmail, isEmail, readCustomers, issueCode } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const b = req.body || {};
  if (b.company) return res.status(200).json({ ok: true }); // honeypot
  const email = normEmail(b.email);
  const lang = b.lang === "en" ? "en" : "es";
  if (!isEmail(email)) return res.status(422).json({ ok: false, error: "email" });

  const generic = () => res.status(200).json({ ok: true });

  try {
    const customers = await readCustomers();
    if (!customers[email]) return generic(); // sin reserva → no se envía nada, pero no lo revelamos

    const issued = await issueCode(email);
    if (!issued.ok) {
      if (issued.reason === "cooldown") return res.status(429).json({ ok: false, error: "cooldown", wait: issued.wait });
      return generic();
    }

    const url = process.env.N8N_PORTAL_CODE_WEBHOOK;
    if (url) {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: issued.code, name: customers[email].name || "", lang }),
      }).catch((e) => console.error("n8n portal code:", e.message));
    } else {
      console.error("N8N_PORTAL_CODE_WEBHOOK no configurado");
    }
    return generic();
  } catch (e) {
    console.error("portal-login:", e.message);
    return res.status(500).json({ ok: false, error: "server" });
  }
};
