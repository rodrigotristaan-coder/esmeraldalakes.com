// Face ID / huella para el panel (passkeys WebAuthn). Vive en /api/portal-verify
// con `op`, para no gastar otra de las 12 funciones del plan Hobby (este archivo
// lleva guion bajo: no cuenta como función).
//
// POST { op: "reto", para: "entrar" }  → opciones para entrar (sin sesión)
// POST { op: "reto", para: "alta" }    → opciones para registrar este dispositivo (con sesión admin)
// POST { op: "entrar", respuesta }     → verifica la firma y abre la sesión admin
// POST { op: "alta", respuesta, apodo } → guarda la llave de este dispositivo (con sesión admin)
// POST { op: "llaves" }                → las llaves de quien tiene la sesión
// POST { op: "baja", credencial }      → quita una llave propia
//
// La validación (CBOR, COSE, rpIdHash, banderas, origen y firma) la hace
// @simplewebauthn/server, la misma versión que ya corre en el portal de Paramita.
// Una llave solo se da de alta desde una sesión que ya entró por correo, y solo
// abre sesión si su correo sigue en ADMIN_EMAILS: sacar a alguien de la lista
// también le quita el Face ID.
const crypto = require("crypto");
const { mutarDoc, leerDoc, psign, readSession, sessionCookie, isAdminEmail } = require("./_lib");

const LLAVES = "llaves.json"; // { [credencial]: { email, publicKey, counter, transports, apodo, creado, ultimoUso } }
const RP_ID = "esmeraldalakes.com";
const ORIGENES = ["https://esmeraldalakes.com", "https://www.esmeraldalakes.com"];
const RETO_TTL_S = 300;

const normLlaves = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});
const leerLlaves = async () => normLlaves((await leerDoc(LLAVES)).valor);

// El reto viaja en una cookie firmada (HttpOnly, 5 min): así no hay que guardarlo.
function cookieReto(datos) {
  const payload = Buffer.from(JSON.stringify({ ...datos, exp: Date.now() + RETO_TTL_S * 1000 })).toString("base64url");
  return `esm_reto=${payload}.${psign("reto|" + payload)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${RETO_TTL_S}`;
}
const borrarReto = () => "esm_reto=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0";
function leerReto(req) {
  const m = String(req.headers.cookie || "").match(/(?:^|;\s*)esm_reto=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = decodeURIComponent(m[1]).split(".");
  if (!payload || !sig) return null;
  const esperada = psign("reto|" + payload);
  if (sig.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperada))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return d && d.exp > Date.now() ? d : null;
  } catch { return null; }
}

// Origen real de la página que pide (producción con o sin www). Cualquier otro
// cae a producción: la verificación fallará en vez de aceptar un sitio ajeno.
function origen(req) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const o = `https://${host}`;
  return ORIGENES.includes(o) ? o : ORIGENES[0];
}

// userID opaco y estable por correo: no expone el correo dentro de la llave.
const userIdDe = (email) => new TextEncoder().encode("esm-" + psign("uid|" + email).slice(0, 24));

async function handle(req, res, b) {
  const wa = await import("@simplewebauthn/server");
  const ses = readSession(req.headers.cookie);
  const conSesion = !!(ses && ses.admin);

  switch (b.op) {
    case "reto": {
      if (b.para === "alta") {
        if (!conSesion) return res.status(401).json({ ok: false, error: "sin_sesion" });
        const propias = Object.entries(await leerLlaves()).filter(([, l]) => l.email === ses.email);
        const opciones = await wa.generateRegistrationOptions({
          rpName: "Esmeralda · Panel", rpID: RP_ID,
          userID: userIdDe(ses.email), userName: ses.email, userDisplayName: ses.email,
          attestationType: "none",
          excludeCredentials: propias.map(([id]) => ({ id })),
          // Descubrible (entra sin escribir el correo) y con verificación real:
          // Face ID o huella, no solo el teléfono desbloqueado.
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
        });
        res.setHeader("Set-Cookie", cookieReto({ c: opciones.challenge, a: "alta", e: ses.email }));
        return res.status(200).json(opciones);
      }
      const opciones = await wa.generateAuthenticationOptions({ rpID: RP_ID, userVerification: "required" });
      res.setHeader("Set-Cookie", cookieReto({ c: opciones.challenge, a: "entrar" }));
      return res.status(200).json(opciones);
    }

    case "entrar": {
      const reto = leerReto(req);
      if (!reto || reto.a !== "entrar") return res.status(400).json({ ok: false, error: "reto" });
      const r = b.respuesta || {};
      const cred = typeof r.id === "string" ? r.id : "";
      const llaves = await leerLlaves();
      const l = cred && llaves[cred];
      // Mismo error si la llave no existe, si ya no es admin o si la firma no
      // cuadra: no se confirma qué llaves hay.
      if (!l || !isAdminEmail(l.email)) return res.status(401).json({ ok: false, error: "llave" });
      let v;
      try {
        v = await wa.verifyAuthenticationResponse({
          response: r, expectedChallenge: reto.c, expectedOrigin: origen(req), expectedRPID: RP_ID,
          requireUserVerification: true,
          credential: { id: cred, publicKey: new Uint8Array(Buffer.from(l.publicKey, "base64url")), counter: Number(l.counter) || 0, transports: l.transports },
        });
      } catch (e) { console.error("faceid entrar:", e && e.message); return res.status(401).json({ ok: false, error: "llave" }); }
      if (!v.verified) return res.status(401).json({ ok: false, error: "llave" });
      // Los passkeys sincronizados de Apple reportan contador 0: se guarda, no se rechaza.
      await mutarDoc(LLAVES, normLlaves, (doc) => {
        if (doc[cred]) { doc[cred].counter = v.authenticationInfo.newCounter; doc[cred].ultimoUso = new Date().toISOString(); }
      }, null, "faceid-uso");
      res.setHeader("Set-Cookie", [sessionCookie(l.email, "admin"), borrarReto()]);
      return res.status(200).json({ ok: true, admin: true });
    }

    case "alta": {
      if (!conSesion) return res.status(401).json({ ok: false, error: "sin_sesion" });
      const reto = leerReto(req);
      if (!reto || reto.a !== "alta" || reto.e !== ses.email) return res.status(400).json({ ok: false, error: "reto" });
      let v;
      try {
        v = await wa.verifyRegistrationResponse({
          response: b.respuesta, expectedChallenge: reto.c, expectedOrigin: origen(req), expectedRPID: RP_ID,
          requireUserVerification: true,
        });
      } catch (e) { console.error("faceid alta:", e && e.message); return res.status(400).json({ ok: false, error: "verificacion" }); }
      if (!v.verified || !v.registrationInfo) return res.status(400).json({ ok: false, error: "verificacion" });
      const c = v.registrationInfo.credential;
      const apodo = String(b.apodo || "").trim().slice(0, 60) || "Este dispositivo";
      const out = await mutarDoc(LLAVES, normLlaves, (doc) => {
        if (doc[c.id] && doc[c.id].email !== ses.email) return { error: "ajena" };
        doc[c.id] = {
          email: ses.email, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter,
          transports: c.transports || [], apodo, creado: (doc[c.id] && doc[c.id].creado) || new Date().toISOString(),
        };
      }, null, "faceid-alta");
      if (out.error) return res.status(out.error === "ajena" ? 409 : 500).json({ ok: false, error: out.error });
      res.setHeader("Set-Cookie", borrarReto());
      return res.status(200).json({ ok: true, apodo });
    }

    case "llaves": {
      if (!conSesion) return res.status(401).json({ ok: false, error: "sin_sesion" });
      const propias = Object.entries(await leerLlaves())
        .filter(([, l]) => l.email === ses.email)
        .map(([id, l]) => ({ credencial: id, apodo: l.apodo, creado: l.creado, ultimoUso: l.ultimoUso || null }));
      return res.status(200).json({ ok: true, llaves: propias });
    }

    case "baja": {
      if (!conSesion) return res.status(401).json({ ok: false, error: "sin_sesion" });
      const cred = String(b.credencial || "");
      const out = await mutarDoc(LLAVES, normLlaves, (doc) => {
        if (!doc[cred] || doc[cred].email !== ses.email) return { error: "no" };
        delete doc[cred];
      }, null, "faceid-baja");
      return res.status(out.error ? 404 : 200).json({ ok: !out.error });
    }
  }
  return res.status(400).json({ ok: false, error: "op" });
}

module.exports = { handle };
