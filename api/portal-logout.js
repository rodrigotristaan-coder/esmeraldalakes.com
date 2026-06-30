// Portal: cierra sesión (borra la cookie).
const { clearSessionCookie } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Set-Cookie", clearSessionCookie());
  return res.status(200).json({ ok: true });
};
