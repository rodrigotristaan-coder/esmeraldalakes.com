// Función serverless de Vercel: lee uno o varios calendarios iCal en vivo
// (Airbnb + tu calendario de "Reservas directas") y devuelve TODAS las fechas
// ocupadas combinadas, para que el calendario de la web no permita dobles reservas.
// Los enlaces iCal viven en variables de entorno de Vercel.

function matchDate(block, field) {
  const re = new RegExp(field + "[^:\\n]*:(\\d{8})");
  const m = block.match(re);
  if (!m) return null;
  const d = m[1];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function parseICal(text, source) {
  const out = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const blk of blocks) {
    const start = matchDate(blk, "DTSTART");
    const end = matchDate(blk, "DTEND");
    if (start && end) out.push({ start, end, source });
  }
  return out;
}

async function fetchBlocks(url, source) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(source + " " + r.status);
    return parseICal(await r.text(), source);
  } catch (err) {
    console.error("iCal error:", err.message);
    return [];
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");

  const sources = [
    [process.env.AIRBNB_ICAL_URL, "airbnb"],
    [process.env.DIRECT_ICAL_URL, "directo"], // tu calendario de reservas directas
  ].filter(([url]) => Boolean(url));

  const { readBlocks } = require("./_lib");
  const [icalResults, directBlocks] = await Promise.all([
    Promise.all(sources.map(([url, src]) => fetchBlocks(url, src))),
    readBlocks(), // reservas directas confirmadas (guardadas en la web)
  ]);
  return res.status(200).json({ blocked: [...icalResults.flat(), ...directBlocks] });
};
