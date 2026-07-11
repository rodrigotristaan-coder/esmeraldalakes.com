// Portal: datos del cliente autenticado (lee la cookie de sesión).
const { readSession, readCustomers } = require("./_lib");

const SITE = "https://esmeraldalakes.com";

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const sess = readSession(req.headers.cookie);
  if (!sess) return res.status(401).json({ ok: false, error: "auth" });
  // Sesión admin: no hay dashboard de cliente; el front redirige a /admin.html.
  if (sess.admin) return res.status(200).json({ ok: true, admin: true });

  try {
    const customers = await readCustomers();
    const c = customers[sess.email];
    if (!c) return res.status(401).json({ ok: false, error: "noaccount" });

    const referrals = (c.credits || []).filter((x) => x.type === "referral").length;
    const reservations = (c.reservations || [])
      .slice()
      .sort((a, z) => (z.checkin || "").localeCompare(a.checkin || ""));

    return res.status(200).json({
      ok: true,
      name: c.name || "",
      email: c.email,
      refCode: c.refCode,
      referralLink: `${SITE}/?ref=${c.refCode}`,
      freeNights: c.freeNights || 0,
      referrals,
      reservations,
    });
  } catch (e) {
    console.error("portal-me:", e.message);
    return res.status(500).json({ ok: false, error: "server" });
  }
};
