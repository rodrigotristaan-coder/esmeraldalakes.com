// Función serverless de Vercel: lee el calendario iCal de Airbnb en vivo
// (del lado del servidor, sin problemas de CORS) y devuelve las fechas ocupadas.
// El enlace iCal vive en las variables de entorno de Vercel.

function matchDate(block, field) {
  const re = new RegExp(field + "[^:\\n]*:(\\d{8})");
  const m = block.match(re);
  if (!m) return null;
  const d = m[1];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function parseICal(text) {
  const out = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const blk of blocks) {
    const start = matchDate(blk, "DTSTART");
    const end = matchDate(blk, "DTEND");
    if (start && end) out.push({ start, end, source: "airbnb" });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  // Cachea 1h en el borde de Vercel para no golpear a Airbnb en cada visita.
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

  const url = process.env.AIRBNB_ICAL_URL;
  if (!url) return res.status(200).json({ blocked: [] });

  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("airbnb " + r.status);
    const text = await r.text();
    return res.status(200).json({ blocked: parseICal(text) });
  } catch (err) {
    console.error("Error leyendo iCal:", err.message);
    return res.status(200).json({ blocked: [] });
  }
};
