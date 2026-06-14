// Utilidades compartidas: almacenamiento de fechas (Vercel Blob), firma HMAC,
// lectura de calendarios iCal y detección de traslapes.
// Archivos con guion bajo NO son rutas en Vercel.
const crypto = require("crypto");
const { put, list } = require("@vercel/blob");

const FILE = "blocks.json";

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
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) console.error("Resend:", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("Resend error:", e.message);
    return false;
  }
}

module.exports = { sign, safeEqual, readBlocks, addBlock, removeBlock, getAllBlocks, rangeOverlaps, sendEmail };
