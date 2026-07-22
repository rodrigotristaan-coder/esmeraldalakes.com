// Calendario iCal de la web. Dos modos:
//
// 1) SIN parámetros — https://esmeraldalakes.com/calendar.ics (rewrite en vercel.json)
//    Solo reservas directas, SUMMARY "No disponible" (sin nombres). Este es el
//    enlace que importa AIRBNB para bloquear fechas — no cambiarle el contenido.
//
// 2) ?full=1&key=CAL_FEED_KEY — feed COMPLETO para los calendarios personales
//    (Google/Apple/Outlook): Airbnb + directas, con nombre del huésped en las
//    directas. Protegido con llave porque lleva datos personales.
//    URL bonita: https://esmeraldalakes.com/reservas.ics?key=... (rewrite)
const { readBlocks, getAllBlocks, readCustomers, safeEqual } = require("./_lib");

const icsDate = (s) => s.replace(/-/g, "");
const icsEsc = (s = "") => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");

const TZID = "America/Mexico_City"; // UTC-6 fijo (México sin horario de verano desde 2022)

function calendarLines(name, events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Esmeralda//Reservas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEsc(name)}`,
    `NAME:${icsEsc(name)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  if (events.some((ev) => ev.dtstart)) {
    lines.push(
      "BEGIN:VTIMEZONE",
      `TZID:${TZID}`,
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:-0600",
      "TZOFFSETTO:-0600",
      "TZNAME:CST",
      "END:STANDARD",
      "END:VTIMEZONE"
    );
  }
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      ev.dtstart ? `DTSTART;TZID=${TZID}:${ev.dtstart}` : `DTSTART;VALUE=DATE:${icsDate(ev.start)}`,
      ev.dtstart ? `DTEND;TZID=${TZID}:${ev.dtend}` : `DTEND;VALUE=DATE:${icsDate(ev.end)}`,
      `SUMMARY:${icsEsc(ev.summary)}`,
      ev.description ? `DESCRIPTION:${icsEsc(ev.description)}` : null,
      "END:VEVENT"
    );
  }
  return lines.filter(Boolean).concat("END:VCALENDAR");
}

// Nombres de clientes del portal por fechas exactas (para bloqueos viejos sin nombre)
function guestNameMap(customers) {
  const map = {};
  for (const email of Object.keys(customers || {})) {
    const c = customers[email];
    for (const r of c.reservations || []) {
      if (r.checkin && r.checkout && c.name) map[`${r.checkin}|${r.checkout}`] = c.name;
    }
  }
  return map;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const full = q.full === "1" || q.full === "true";

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");

  if (full) {
    // Feed completo con nombres → requiere llave
    const key = process.env.CAL_FEED_KEY || "";
    if (!key || !safeEqual(String(q.key || ""), key)) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(401).send("No autorizado");
    }
    // ?png=1 → la imagen del calendario (la misma que llega por Telegram), bajo demanda
    if (q.png === "1" || q.png === "true") {
      const { renderCalendarPng } = require("./_calimg");
      const png = await renderCalendarPng();
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(png);
    }

    const [blocks, customers] = await Promise.all([getAllBlocks(), readCustomers()]);
    const names = guestNameMap(customers);
    const events = [];
    blocks
      .sort((a, b) => (a.start < b.start ? -1 : 1))
      .forEach((b, i) => {
        const nights = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
        const direct = b.source !== "airbnb";
        const name = direct ? (b.name || names[`${b.start}|${b.end}`] || "Reserva directa") : "Airbnb";
        const detail =
          (direct ? "Reserva directa" : "Reserva de Airbnb") +
          ` · ${nights} noche${nights === 1 ? "" : "s"}` +
          (b.guests ? ` · ${b.guests} huéspedes` : "") +
          " · esmeraldalakes.com";
        // Evento all-day que cubre la estancia
        events.push({
          uid: `${direct ? "d" : "a"}${i}-${b.start}@esmeralda-full`,
          start: b.start,
          end: b.end,
          summary: (direct ? "🏠 " : "🅰️ ") + name,
          description: detail + ` · check-in ${b.start} 12:00 · check-out ${b.end} 11:00`,
        });
        // Check-in 12:00 y check-out 11:00 como eventos con hora (para recordatorios)
        events.push(
          {
            uid: `ci${i}-${b.start}@esmeralda-full`,
            dtstart: `${icsDate(b.start)}T120000`,
            dtend: `${icsDate(b.start)}T130000`,
            summary: `🔑 Check-in · ${name}`,
            description: detail,
          },
          {
            uid: `co${i}-${b.end}@esmeralda-full`,
            dtstart: `${icsDate(b.end)}T110000`,
            dtend: `${icsDate(b.end)}T120000`,
            summary: `🧳 Check-out · ${name}`,
            description: detail,
          }
        );
      });
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1800");
    return res.status(200).send(calendarLines("Esmeralda · Reservas", events).join("\r\n"));
  }

  // Modo Airbnb (histórico): solo directas, sin nombres
  const blocks = await readBlocks();
  const events = [
    // Evento semilla (pasado) para que el calendario nunca esté vacío; no afecta disponibilidad.
    { uid: "seed@esmeralda", start: "2020-01-01", end: "2020-01-02", summary: "No disponible" },
    ...blocks.map((b, i) => ({ uid: `d${i}-${b.start}@esmeralda`, start: b.start, end: b.end, summary: "No disponible" })),
  ];
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
  return res.status(200).send(calendarLines("Esmeralda Reservas directas", events).join("\r\n"));
};
