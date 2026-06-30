// Portal: paso 2 del magic-link. Recibe {email, code}; si el código es válido,
// emite la cookie de sesión firmada (HttpOnly) y devuelve los datos del cliente.
const { normEmail, isEmail, verifyCode, readCustomers, sessionCookie } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const b = req.body || {};
  const email = normEmail(b.email);
  const code = String(b.code || "").trim();
  if (!isEmail(email) || !/^\d{6}$/.test(code)) return res.status(422).json({ ok: false, error: "input" });

  try {
    const v = await verifyCode(email, code);
    if (!v.ok) return res.status(401).json({ ok: false, error: v.reason || "bad" });

    const customers = await readCustomers();
    const c = customers[email];
    if (!c) return res.status(401).json({ ok: false, error: "noaccount" });

    res.setHeader("Set-Cookie", sessionCookie(email));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("portal-verify:", e.message);
    return res.status(500).json({ ok: false, error: "server" });
  }
};
