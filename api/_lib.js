// Utilidades compartidas: almacenamiento de fechas (Vercel Blob), firma HMAC,
// lectura de calendarios iCal y detección de traslapes.
// Archivos con guion bajo NO son rutas en Vercel.
const crypto = require("crypto");
const { put, list } = require("@vercel/blob");

const FILE = "blocks.json";
const REVIEWS = "reviews.json";
const CUSTOMERS = "customers.json";
const CODES = "portal-codes.json";

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

// --- Reservas directas guardadas (fechas) ---
async function readBlocks() {
  try {
    const { blobs } = await list({ prefix: FILE });
    if (!blobs.length) return [];
    const r = await fetch(blobs[0].url, { cache: "no-store" });
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

async function addBlock(start, end) {
  const arr = await readBlocks();
  if (!arr.some((b) => b.start === start && b.end === end)) {
    arr.push({ start, end, source: "directo" });
    await writeBlocks(arr);
  }
  return arr;
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
    const r = await fetch(blobs[0].url, { cache: "no-store" });
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
function parseICal(text, source) {
  const out = [];
  for (const blk of text.split("BEGIN:VEVENT").slice(1)) {
    const start = matchDate(blk, "DTSTART");
    const end = matchDate(blk, "DTEND");
    if (start && end) out.push({ start, end, source });
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
async function getAllBlocks() {
  const urls = [
    [process.env.AIRBNB_ICAL_URL, "airbnb"],
    [process.env.DIRECT_ICAL_URL, "directo-ical"],
  ].filter(([u]) => Boolean(u));
  const [ical, direct] = await Promise.all([
    Promise.all(urls.map(([u, s]) => fetchIcal(u, s))),
    readBlocks(),
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
const CODE_TTL = 10 * 60 * 1000;              // código válido 10 min
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
    const r = await fetch(blobs[0].url, { cache: "no-store" });
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
  if (wasFirstStay && refCode) {
    const refOwner = ownerOfRefCode(customers, refCode);
    if (refOwner && refOwner !== key) {
      c.referredBy = customers[refOwner].refCode;
      customers[refOwner].freeNights = (customers[refOwner].freeNights || 0) + 1;
      customers[refOwner].credits.push({
        type: "referral", from: key, nights: 1, at: new Date().toISOString(),
      });
    }
  }

  c.reservations.push({
    checkin, checkout, nights: n, guests: Number(guests) || null, at: new Date().toISOString(),
  });

  await writeCustomers(customers);
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
  return { ok: true, email: key, refCode: customers[key].refCode };
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
  all[key] = { hash: psign(key + "|" + code), exp: now + CODE_TTL, sent: now, attempts: 0 };
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
  const good = safeEqual(rec.hash, psign(key + "|" + String(code || "").trim()));
  if (!good) {
    rec.attempts = (rec.attempts || 0) + 1;
    await writeJsonObj(CODES, all);
    return { ok: false, reason: "bad" };
  }
  delete all[key]; // un solo uso
  await writeJsonObj(CODES, all);
  return { ok: true };
}

// --- Sesión: cookie firmada HttpOnly ---
function makeSession(email) {
  const key = normEmail(email);
  const exp = Date.now() + SESSION_TTL;
  const payload = Buffer.from(key + "|" + exp).toString("base64url");
  return payload + "." + psign(payload);
}
function readSession(cookieHeader) {
  const m = String(cookieHeader || "").match(/(?:^|;\s*)esm_portal=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = decodeURIComponent(m[1]).split(".");
  if (!payload || !sig || !safeEqual(sig, psign(payload))) return null;
  const [email, exp] = Buffer.from(payload, "base64url").toString("utf8").split("|");
  if (!email || Number(exp) < Date.now()) return null;
  return { email };
}
function sessionCookie(email) {
  const v = makeSession(email);
  return `esm_portal=${v}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
}
const clearSessionCookie = () => "esm_portal=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

module.exports = {
  sign, safeEqual, readBlocks, addBlock, removeBlock, getAllBlocks, rangeOverlaps, sendEmail, readReviews, writeReviews,
  // portal
  normEmail, isEmail, readCustomers, writeCustomers, upsertCustomerFromBooking, ownerOfRefCode, seedCustomer,
  issueCode, verifyCode, sessionCookie, clearSessionCookie, readSession,
};
