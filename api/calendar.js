// Calendario iCal de la web (reservas directas confirmadas).
// Este es el enlace que se importa en Airbnb para que también bloquee tus fechas.
// URL pública: https://esmeraldalakes.com/calendar.ics  (rewrite en vercel.json)
const { readBlocks } = require("./_lib");

module.exports = async (req, res) => {
  const blocks = await readBlocks();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ev = (uid, s, e) =>
    [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${s.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${e.replace(/-/g, "")}`,
      "SUMMARY:No disponible",
      "END:VEVENT",
    ].join("\r\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Esmeralda//Reservas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Esmeralda Reservas directas",
    "NAME:Esmeralda Reservas directas",
  ];
  // Evento semilla (pasado) para que el calendario nunca esté vacío; no afecta disponibilidad.
  lines.push(ev("seed@esmeralda", "2020-01-01", "2020-01-02"));
  blocks.forEach((b, i) => lines.push(ev(`d${i}-${b.start}@esmeralda`, b.start, b.end)));
  lines.push("END:VCALENDAR");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
  res.status(200).send(lines.join("\r\n"));
};
