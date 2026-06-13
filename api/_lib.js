// Utilidades compartidas: almacenamiento de fechas bloqueadas (Vercel Blob)
// y firma HMAC para confirmar reservas de forma segura.
// Archivos con guion bajo NO son rutas en Vercel.
const crypto = require("crypto");
const { put, list } = require("@vercel/blob");

const FILE = "blocks.json";

// Firma de confirmación (evita que cualquiera bloquee fechas).
function sign(value) {
  return crypto
    .createHmac("sha256", process.env.CONFIRM_SECRET || "")
    .update(value)
    .digest("hex")
    .slice(0, 32);
}

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

module.exports = { sign, readBlocks, addBlock };
