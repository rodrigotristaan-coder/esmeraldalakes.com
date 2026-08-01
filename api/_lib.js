// Utilidades compartidas: almacenamiento de fechas (Vercel Blob), firma HMAC,
// lectura de calendarios iCal y detección de traslapes.
// Archivos con guion bajo NO son rutas en Vercel.
const crypto = require("crypto");
const { put, list } = require("@vercel/blob");

// El depa está en Acapulco. Calcular "hoy" con toISOString() da la fecha en UTC,
// así que a partir de las 18:00 hora local el sistema se adelantaba un día:
// un huésped que salía hoy aparecía como que ya se había ido.
const TZ = "America/Mexico_City";
const hoyMx = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
// Suma días a un YYYY-MM-DD anclando al mediodía, para que el huso no lo mueva.
const masDias = (ds, n) => new Date(new Date(ds + "T12:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

const FILE = "blocks.json";
const REVIEWS = "reviews.json";
const CUSTOMERS = "customers.json";
const CODES = "portal-codes.json";
const FINANCE = "finance.json";

function sign(value) {
  return crypto
    .createHmac("sha256", process.env.CONFIRM_SECRET || "")
    .update(value)
    .digest("hex")
    .slice(0, 32);
}

// Comparación segura para llaves de admin / firmas.
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Lectura del blob con cache-buster: la URL pública pasa por CDN y puede servir
// una copia vieja aunque cacheControlMaxAge sea 0. Sin esto, un read-modify-write
// con copia stale sobreescribe (y pierde) escrituras recientes — pasó con una
// reseña el 25-jul-2026.
const freshUrl = (url) => url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();

// --- Reservas directas guardadas (fechas) ---
async function readBlocks() {
  try {
    const { blobs } = await list({ prefix: FILE });
    if (!blobs.length) return [];
    const r = await fetch(freshUrl(blobs[0].url), { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    console.error("readBlocks:", e.message);
    return [];
  }
}

async function writeBlocks(arr) {
  await put(FILE, JSON.stringify(arr), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0, // sin caché: lecturas siempre frescas (bloqueos inmediatos)
  });
}

// Campos opcionales de una reserva directa (los usa el admin y el bot)
function sanitizeBlockExtra(extra = {}) {
  const out = {};
  if (extra.name) out.name = String(extra.name).slice(0, 80);
  if (extra.guests) out.guests = Number(extra.guests) || undefined;
  if (extra.rate !== undefined && extra.rate !== "") {
    const r = Math.round(Number(extra.rate) * 100) / 100;
    if (r > 0 && r <= 1000000) out.rate = r;
  }
  if (/^\d{1,2}:\d{2}$/.test(String(extra.checkinTime || ""))) out.checkinTime = String(extra.checkinTime).padStart(5, "0");
  if (/^\d{1,2}:\d{2}$/.test(String(extra.checkoutTime || ""))) out.checkoutTime = String(extra.checkoutTime).padStart(5, "0");
  if (extra.referredBy) out.referredBy = String(extra.referredBy).slice(0, 60);
  if (extra.freeNight !== undefined) out.freeNight = extra.freeNight === true || extra.freeNight === "1" || extra.freeNight === "true";
  return out;
}

async function addBlock(start, end, extra) {
  const arr = await readBlocks();
  if (!arr.some((b) => b.start === start && b.end === end)) {
    arr.push({ start, end, source: "directo", ...sanitizeBlockExtra(extra) });
    await writeBlocks(arr);
  }
  return arr;
}

// Edita una reserva directa identificada por sus fechas originales (ostart/oend).
// Puede cambiar fechas y cualquier campo extra; los campos vacíos se borran.
async function updateBlock(ostart, oend, fields = {}) {
  const arr = await readBlocks();
  const i = arr.findIndex((b) => b.start === ostart && b.end === oend);
  if (i === -1) return { ok: false, reason: "no-existe" };
  const b = arr[i];
  const start = fields.start || b.start;
  const end = fields.end || b.end;
  if (!(start < end)) return { ok: false, reason: "fechas" };
  if (arr.some((x, k) => k !== i && x.start === start && x.end === end)) return { ok: false, reason: "duplicado" };
  const extra = sanitizeBlockExtra(fields);
  const next = { start, end, source: b.source || "directo" };
  // conserva lo previo y aplica lo nuevo; string vacío = borrar campo
  for (const k of ["name", "guests", "rate", "checkinTime", "checkoutTime", "referredBy", "freeNight"]) {
    if (extra[k] !== undefined) next[k] = extra[k];
    else if (fields[k] === "" || fields[k] === null) continue; // borrar
    else if (b[k] !== undefined) next[k] = b[k];
  }
  arr[i] = next;
  await writeBlocks(arr);
  return { ok: true, block: next, blocks: arr };
}

async function removeBlock(start, end) {
  const arr = await readBlocks();
  const next = arr.filter((b) => !(b.start === start && b.end === end));
  if (next.length !== arr.length) await writeBlocks(next);
  return next;
}

// --- Reseñas (Vercel Blob) ---
async function readReviews() {
  try {
    const { blobs } = await list({ prefix: REVIEWS });
    if (!blobs.length) return [];
    const r = await fetch(freshUrl(blobs[0].url), { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    console.error("readReviews:", e.message);
    return [];
  }
}
async function writeReviews(arr) {
  await put(REVIEWS, JSON.stringify(arr), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

// --- Calendarios iCal externos (Airbnb / directo extra) ---
function matchDate(block, field) {
  const m = block.match(new RegExp(field + "[^:\\n]*:(\\d{8})"));
  if (!m) return null;
  const d = m[1];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}
// Airbnb exporta su iCal con un SUMMARY genérico ("Reserved", "Not available"…)
// y NO manda el nombre del huésped. Aun así lo leemos: si algún día el feed trae
// algo útil, aparece solo; si es genérico, se ignora y el nombre se pone a mano.
const SUMMARY_GENERICO = /^(reserved|not available|unavailable|blocked|busy|closed|airbnb.*not available.*)$/i;
function matchSummary(blk) {
  const m = blk.match(/\nSUMMARY[^:\n]*:(.*)/);
  if (!m) return null;
  const s = m[1].replace(/\\([,;\\])/g, "$1").trim();
  return !s || SUMMARY_GENERICO.test(s) ? null : s.slice(0, 80);
}

// Airbnb quitó el nombre del huésped del iCal en dic-2019 (privacidad). Lo único
// identificable que queda en la DESCRIPTION es el link a la reserva y los últimos
// 4 dígitos del teléfono; los rescatamos para que el panel lleve directo a ella.
// ⚠️ Estos campos solo salen por /api/admin (con contraseña). El feed público
// (/calendar.ics) se arma aparte y solo dice "No disponible".
function matchReserva(blk) {
  const out = {};
  const u = blk.match(/https:\/\/www\.airbnb\.[a-z.]+\/[^\s"'<>\\]+/i);
  if (u) out.url = u[0];
  const t = blk.match(/Phone\s*Number\s*\(Last\s*4\s*Digits\)\s*:?\s*(\d{4})/i);
  if (t) out.tel4 = t[1];
  return out;
}

function parseICal(text, source) {
  // iCal parte las líneas largas y las continúa con un espacio al inicio;
  // sin volver a unirlas, la DESCRIPTION llega cortada a la mitad.
  const plano = String(text).replace(/\r?\n[ \t]/g, "");
  const out = [];
  for (const blk of plano.split("BEGIN:VEVENT").slice(1)) {
    const start = matchDate(blk, "DTSTART");
    const end = matchDate(blk, "DTEND");
    if (start && end) {
      const b = { start, end, source };
      const n = matchSummary(blk);
      if (n) b.name = n;
      Object.assign(b, matchReserva(blk));
      out.push(b);
    }
  }
  return out;
}
async function fetchIcal(url, source) {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    return parseICal(await r.text(), source);
  } catch {
    return [];
  }
}

// Todos los bloqueos: Airbnb + iCal directo + reservas directas guardadas.
// `known`: arreglo de reservas directas ya en memoria (p. ej. el que acaba de
// escribirse). Se pasa para NO releer el blob justo después de un put —
// esa relectura puede traer una copia vieja y "desaparecer" la reserva recién
// hecha. Sin argumento se comporta como siempre y lee del blob.
async function getAllBlocks(known) {
  const urls = [
    [process.env.AIRBNB_ICAL_URL, "airbnb"],
    [process.env.DIRECT_ICAL_URL, "directo-ical"],
  ].filter(([u]) => Boolean(u));
  const [ical, direct] = await Promise.all([
    Promise.all(urls.map(([u, s]) => fetchIcal(u, s))),
    Array.isArray(known) ? known : readBlocks(),
  ]);
  return [...ical.flat(), ...direct];
}

// ¿El rango [ci, co) se traslapa con algún bloqueo? (end exclusivo, estilo iCal)
function rangeOverlaps(ci, co, blocks) {
  return blocks.some((b) => ci < b.end && co > b.start);
}

// --- Envío de correo (Resend). Best-effort: si no hay API key, no hace nada. ---
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const from = process.env.FROM_EMAIL || "Esmeralda <onboarding@resend.dev>";
  const payload = { from, to, subject, html };
  if (process.env.REPLY_TO) payload.reply_to = process.env.REPLY_TO; // respuestas del huésped van a tu correo
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error("Resend:", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("Resend error:", e.message);
    return false;
  }
}

// ===================== Portal de clientes =====================
// Almacenamiento de clientes (Vercel Blob). Objeto keyed por email (minúsculas):
//   { email, name, refCode, referredBy, freeNights, createdAt, reservations[], credits[] }
const PORTAL_SECRET = () => process.env.PORTAL_SECRET || process.env.CONFIRM_SECRET || "";
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 días
const CODE_TTL = 15 * 60 * 1000;              // código válido 15 min
const CODE_COOLDOWN = 45 * 1000;              // 45 s entre envíos
const CODE_MAX_ATTEMPTS = 5;

const normEmail = (e) => String(e || "").trim().toLowerCase();
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ""));

// HMAC con la llave del portal (firma de cookie de sesión y hash de códigos)
function psign(value) {
  return crypto.createHmac("sha256", PORTAL_SECRET()).update(String(value)).digest("hex");
}

// Lee/escribe un JSON arbitrario en Blob (objeto). Devuelve {} si no existe.
async function readJsonObj(name) {
  try {
    const { blobs } = await list({ prefix: name });
    if (!blobs.length) return {};
    const r = await fetch(freshUrl(blobs[0].url), { cache: "no-store" });
    if (!r.ok) return {};
    const j = await r.json();
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch (e) {
    console.error("readJsonObj " + name + ":", e.message);
    return {};
  }
}
async function writeJsonObj(name, obj) {
  await put(name, JSON.stringify(obj), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

const readCustomers = () => readJsonObj(CUSTOMERS);
const writeCustomers = (o) => writeJsonObj(CUSTOMERS, o);

// --- Finanzas (ingresos y gastos del depa, Vercel Blob) ---
// Movimiento: { id, type: "in"|"out", date: "YYYY-MM-DD", concept, category, amount, guest?, at }
// Recurrente: { id, type, concept, category, amount, day (1-28), activo }
// Los dos viven en el MISMO blob: { movs, recurring }. Por eso writeFinance relee
// el doc antes de escribir — si escribiera solo { movs } borraría los recurrentes.
// `notas`: datos que ponemos a mano sobre una reserva que NO controlamos (las de
// Airbnb llegan por iCal y no traen nombre). Van indexadas por "llegada_salida".
async function readFinanceDoc() {
  const o = await readJsonObj(FINANCE);
  return {
    movs: Array.isArray(o.movs) ? o.movs : [],
    recurring: Array.isArray(o.recurring) ? o.recurring : [],
    notas: o.notas && typeof o.notas === "object" && !Array.isArray(o.notas) ? o.notas : {},
  };
}
const writeFinanceDoc = (doc) =>
  writeJsonObj(FINANCE, { movs: doc.movs || [], recurring: doc.recurring || [], notas: doc.notas || {} });

// Pega las notas encima de los bloqueos: lo que ya trae el bloqueo manda,
// la nota solo rellena lo que falta (así una reserva directa nunca se pisa).
const notaKey = (start, end) => `${start}_${end}`;
function aplicarNotas(blocks, notas) {
  if (!notas) return blocks;
  return blocks.map((b) => {
    const n = notas[notaKey(b.start, b.end)];
    if (!n) return b;
    const out = { ...b };
    for (const k of ["name", "guests", "rate", "checkinTime", "checkoutTime", "pagoHuesped", "pagoAnfitrion", "plataforma"]) {
      if (out[k] === undefined && n[k] !== undefined && n[k] !== "") out[k] = n[k];
    }
    out.anotada = true;
    return out;
  });
}
async function readFinance() { return (await readFinanceDoc()).movs; }
async function writeFinance(movs) {
  const doc = await readFinanceDoc();
  doc.movs = movs;
  await writeFinanceDoc(doc);
}

// Guarda un cambio en el documento de finanzas y COMPRUEBA que quedó.
//
// El blob es eventualmente consistente: dos escrituras seguidas pueden pisarse
// porque la segunda lee una copia vieja del documento. Pasó de verdad el
// 31-jul-2026: se registró un gasto de luz y, en el mismo segundo, tres altas de
// recurrentes; las altas leyeron el documento sin el gasto y lo borraron al
// guardar.
//
// `aplicar(doc)`  muta el documento y devuelve lo que haga falta (o {error}).
// `quedo(doc)`    dice si el cambio ya se ve al releer.
// Si no se ve, se reintenta aplicando el cambio sobre lo MÁS FRESCO que haya.
async function mutarDoc(leer, escribir, aplicar, quedo, etiqueta) {
  let ultimo = null;
  for (let intento = 0; intento < 4; intento++) {
    const doc = await leer();
    const r = aplicar(doc);
    if (r && r.error) return { error: r.error };
    await escribir(doc);
    const check = await leer();
    ultimo = check;
    if (quedo(check)) return { doc: check, r };
    await new Promise((s) => setTimeout(s, 150 * (intento + 1)));
  }
  console.error(etiqueta + ": el cambio no se pudo confirmar tras 4 intentos");
  return { doc: ultimo, error: "no-se-guardo" };
}

const mutarFinanzas = (aplicar, quedo) =>
  mutarDoc(readFinanceDoc, writeFinanceDoc, aplicar, quedo, "mutarFinanzas");

// Los clientes viven en otro blob pero corren el mismo riesgo: dos cambios
// seguidos (p. ej. el huésped acepta el reglamento mientras el admin le pone
// el teléfono) se pisarían.
const mutarClientes = (aplicar, quedo) =>
  mutarDoc(readCustomers, writeCustomers, aplicar, quedo, "mutarClientes");

// Versión del reglamento que se acepta. Si el condominio publica uno nuevo, se
// cambia aquí y las aceptaciones viejas quedan marcadas con la versión anterior.
const REGLAMENTO_VERSION = "2025";

// Campos de contacto que puede llevar la ficha de un cliente.
// ⚠️ La INE NO se guarda aquí: solo el enlace a Drive (ineUrl) y la marca de
// verificada. Guardar identificaciones oficiales en el sitio nos volvería
// custodios de material de robo de identidad.
function sanitizeCliente(campos = {}) {
  const out = {};
  if (campos.name !== undefined) out.name = String(campos.name).trim().slice(0, 80);
  if (campos.phone !== undefined) out.phone = String(campos.phone).replace(/[^\d+()\s-]/g, "").trim().slice(0, 25);
  if (campos.notes !== undefined) out.notes = String(campos.notes).trim().slice(0, 500);
  if (campos.ineUrl !== undefined) {
    const u = String(campos.ineUrl).trim().slice(0, 300);
    out.ineUrl = /^https:\/\//i.test(u) ? u : "";
  }
  return out;
}

// Código de referido tipo ESM-XXXX (alfabeto sin caracteres ambiguos)
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genRefCode(existing) {
  for (let tries = 0; tries < 50; tries++) {
    let s = "";
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) s += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
    const code = "ESM-" + s;
    if (!existing || !existing.has(code)) return code;
  }
  return "ESM-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

// Busca el email dueño de un código de referido
function ownerOfRefCode(customers, refCode) {
  const code = String(refCode || "").trim().toUpperCase();
  if (!code) return null;
  for (const email of Object.keys(customers)) {
    if (customers[email].refCode === code) return email;
  }
  return null;
}

// Crea/actualiza un cliente a partir de una reserva CONFIRMADA (pago recibido).
// Acredita +1 noche gratis al dueño del refCode si éste es el primer hospedaje del nuevo cliente.
async function upsertCustomerFromBooking({ email, name, checkin, checkout, nights, guests, refCode }) {
  const key = normEmail(email);
  if (!isEmail(key)) return { ok: false, reason: "email" };

  const customers = await readCustomers();
  const codes = new Set(Object.values(customers).map((c) => c.refCode).filter(Boolean));
  const isNew = !customers[key];

  if (isNew) {
    customers[key] = {
      email: key,
      name: String(name || "").slice(0, 80),
      refCode: genRefCode(codes),
      referredBy: null,
      freeNights: 0,
      createdAt: new Date().toISOString(),
      reservations: [],
      credits: [],
    };
  } else if (name && !customers[key].name) {
    customers[key].name = String(name).slice(0, 80);
  }

  const c = customers[key];
  const n = Number(nights) || Math.round((new Date(checkout) - new Date(checkin)) / 86400000) || 0;

  // Crédito por referido: solo en la PRIMERA reserva confirmada del cliente, y si el código es de otro.
  const wasFirstStay = c.reservations.length === 0;
  let notifyReferrer = null;
  if (wasFirstStay && refCode) {
    const refOwner = ownerOfRefCode(customers, refCode);
    if (refOwner && refOwner !== key) {
      c.referredBy = customers[refOwner].refCode;
      customers[refOwner].freeNights = (customers[refOwner].freeNights || 0) + 1;
      customers[refOwner].credits.push({
        type: "referral", from: key, nights: 1, at: new Date().toISOString(),
      });
      notifyReferrer = refOwner;
    }
  }

  c.reservations.push({
    checkin, checkout, nights: n, guests: Number(guests) || null, at: new Date().toISOString(),
  });

  await writeCustomers(customers);

  // Aviso al referidor de su noche gratis (n8n → Outlook), después de persistir.
  const hookUrl = process.env.N8N_REFERRAL_WEBHOOK;
  if (notifyReferrer && hookUrl) {
    const r = customers[notifyReferrer];
    await fetch(hookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: r.email, name: r.name || "", friendName: c.name || "",
        freeNights: r.freeNights, refCode: r.refCode,
        secret: process.env.ESM_N8N_SECRET || "",
      }),
    }).catch((e) => console.error("n8n referral notify:", e.message));
  }

  return { ok: true, isNew, email: key, refCode: c.refCode };
}

// Crea una cuenta de cliente "a mano" (admin), sin reserva. Idempotente: si ya
// existe, no la duplica. Opcionalmente añade una reserva de muestra.
async function seedCustomer({ email, name, sampleReservation }) {
  const key = normEmail(email);
  if (!isEmail(key)) return { ok: false, reason: "email" };
  const customers = await readCustomers();
  const codes = new Set(Object.values(customers).map((c) => c.refCode).filter(Boolean));
  if (!customers[key]) {
    customers[key] = {
      email: key,
      name: String(name || "").slice(0, 80),
      refCode: genRefCode(codes),
      referredBy: null,
      freeNights: 0,
      createdAt: new Date().toISOString(),
      reservations: [],
      credits: [],
    };
  } else if (name && !customers[key].name) {
    customers[key].name = String(name).slice(0, 80);
  }
  if (sampleReservation && customers[key].reservations.length === 0) {
    customers[key].reservations.push({ ...sampleReservation, at: new Date().toISOString(), sample: true });
  }
  await writeCustomers(customers);
  // Devuelve el objeto ya en memoria: quien llame NO debe releer el blob
  // (la lectura inmediata después de escribir puede traer la copia vieja).
  return { ok: true, email: key, refCode: customers[key].refCode, customers };
}

// --- Magic-link: códigos de 6 dígitos (Vercel Blob) ---
const genCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

async function issueCode(email) {
  const key = normEmail(email);
  const all = await readJsonObj(CODES);
  const now = Date.now();
  // poda expirados
  for (const k of Object.keys(all)) if ((all[k].exp || 0) < now) delete all[k];

  const prev = all[key];
  if (prev && prev.sent && now - prev.sent < CODE_COOLDOWN) {
    return { ok: false, reason: "cooldown", wait: Math.ceil((CODE_COOLDOWN - (now - prev.sent)) / 1000) };
  }
  const code = genCode();
  // Si había un código vigente, se conserva como "anterior" válido: si el
  // correo tarda y el usuario pide otro, el código del primer correo aún sirve.
  const prevHash = prev && (prev.exp || 0) >= now ? prev.hash : undefined;
  all[key] = { hash: psign(key + "|" + code), prevHash, exp: now + CODE_TTL, sent: now, attempts: prev ? prev.attempts || 0 : 0 };
  await writeJsonObj(CODES, all);
  return { ok: true, code };
}

async function verifyCode(email, code) {
  const key = normEmail(email);
  const all = await readJsonObj(CODES);
  const rec = all[key];
  const now = Date.now();
  if (!rec || (rec.exp || 0) < now) return { ok: false, reason: "expired" };
  if ((rec.attempts || 0) >= CODE_MAX_ATTEMPTS) { delete all[key]; await writeJsonObj(CODES, all); return { ok: false, reason: "attempts" }; }
  const sig = psign(key + "|" + String(code || "").trim());
  const good = safeEqual(rec.hash, sig) || (rec.prevHash && safeEqual(rec.prevHash, sig));
  if (!good) {
    rec.attempts = (rec.attempts || 0) + 1;
    await writeJsonObj(CODES, all);
    return { ok: false, reason: "bad" };
  }
  delete all[key]; // un solo uso
  await writeJsonObj(CODES, all);
  return { ok: true };
}

// --- Admin por magic-link: correos con acceso al panel (/admin.html) ---
const ADMIN_EMAILS = () =>
  String(process.env.ADMIN_EMAILS || "hola@satorimkt.com").split(",").map((s) => normEmail(s)).filter(Boolean);
const isAdminEmail = (email) => ADMIN_EMAILS().includes(normEmail(email));

// --- Sesión: cookie firmada HttpOnly (payload: email|exp|rol) ---
function makeSession(email, role) {
  const key = normEmail(email);
  const exp = Date.now() + SESSION_TTL;
  const payload = Buffer.from(key + "|" + exp + "|" + (role || "")).toString("base64url");
  return payload + "." + psign(payload);
}
function readSession(cookieHeader) {
  const m = String(cookieHeader || "").match(/(?:^|;\s*)esm_portal=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = decodeURIComponent(m[1]).split(".");
  if (!payload || !sig || !safeEqual(sig, psign(payload))) return null;
  const [email, exp, role] = Buffer.from(payload, "base64url").toString("utf8").split("|");
  if (!email || Number(exp) < Date.now()) return null;
  return { email, admin: role === "admin" && isAdminEmail(email) };
}
function sessionCookie(email, role) {
  const v = makeSession(email, role);
  return `esm_portal=${v}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
}
const clearSessionCookie = () => "esm_portal=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

module.exports = {
  sign, safeEqual, readBlocks, addBlock, removeBlock, updateBlock, getAllBlocks, rangeOverlaps, sendEmail, readReviews, writeReviews,
  // portal
  normEmail, isEmail, readCustomers, writeCustomers, upsertCustomerFromBooking, ownerOfRefCode, seedCustomer,
  issueCode, verifyCode, sessionCookie, clearSessionCookie, readSession, isAdminEmail,
  // finanzas
  readFinance, writeFinance, readFinanceDoc, writeFinanceDoc, mutarFinanzas, mutarClientes,
  sanitizeCliente, REGLAMENTO_VERSION,
  // notas sobre reservas que no controlamos (Airbnb)
  notaKey, aplicarNotas,
  // fechas en hora de Acapulco (no UTC)
  hoyMx, masDias,
};
