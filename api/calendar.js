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
//    · &png=1 → imagen del calendario (acepta &months=2..12)
//
// 3) ?view=html&key=CAL_FEED_KEY — landing interna VIVA con los próximos 12
//    meses (se regenera en cada visita). URL bonita: /calendario?key=...
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

// Página HTML interna con el calendario vivo (12 meses). Sin JS (CSP-safe);
// cada visita regenera los datos y la página se auto-refresca cada 15 min.
function htmlEsc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml(blocks, customers, feedKey) {
  const { sourceFor, guestNameMap: nameMap, todayAcapulco, ymd, fmtCorto, MESES, DOWS } = require("./_calimg");
  const now = todayAcapulco();
  const Y = now.getUTCFullYear(), M = now.getUTCMonth();
  const todayDs = ymd(Y, M, now.getUTCDate());
  const months = [];
  for (let k = 0; k < 12; k++) months.push([Y + Math.floor((M + k) / 12), (M + k) % 12]);
  const [lastY, lastM] = months[11];
  const windowEnd = ymd(lastM === 11 ? lastY + 1 : lastY, (lastM + 1) % 12, 1);

  const names = nameMap(customers);
  const rows = blocks
    .filter((b) => b.start < windowEnd && b.end > ymd(Y, M, 1))
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((b) => {
      const nights = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
      const direct = b.source !== "airbnb";
      const name = direct ? (b.name || names[`${b.start}|${b.end}`] || "Reserva directa") : "Airbnb";
      return { name, direct, start: b.start, end: b.end, nights };
    });

  let cards = "";
  for (const [my, mm] of months) {
    const first = new Date(Date.UTC(my, mm, 1));
    const startDow = (first.getUTCDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(Date.UTC(my, mm + 1, 0)).getUTCDate();
    let cells = DOWS.map((d) => `<span class="dow">${d}</span>`).join("");
    for (let i = 0; i < startDow; i++) cells += `<span></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = ymd(my, mm, d);
      const src = sourceFor(ds, blocks);
      const cls = ["day", src === "directo" ? "dir" : src === "airbnb" ? "abb" : "", ds < todayDs ? "past" : "", ds === todayDs ? "today" : ""].filter(Boolean).join(" ");
      cells += `<span class="${cls}">${d}</span>`;
    }
    cards += `<section class="card"><h2>${MESES[mm]} ${my}</h2><div class="grid">${cells}</div></section>`;
  }

  const list = rows.length
    ? rows.map((r) => `<li><span class="dot ${r.direct ? "dir" : "abb"}"></span><strong>${htmlEsc(r.name)}</strong><span class="fechas">${fmtCorto(r.start)} - ${fmtCorto(r.end)} · ${r.nights} noche${r.nights === 1 ? "" : "s"}</span></li>`).join("")
    : `<li class="vacio">Sin reservas en estos 12 meses — calendario libre</li>`;

  const pngHref = `/reservas.ics?key=${encodeURIComponent(feedKey)}&png=1`;
  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="900">
<title>Esmeralda · Calendario de reservas</title>
<style>
  :root { --glass: rgba(255,255,255,.09); --borde: rgba(255,255,255,.28); --verde: #06d67e; --ambar: #f5b301; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, "Inter", "Segoe UI", sans-serif; color: #fff; min-height: 100vh;
    background: linear-gradient(160deg, #052620 0%, #0a5944 55%, #0f7a5f 100%); background-attachment: fixed; padding: 28px clamp(16px, 4vw, 56px) 64px; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px 24px; margin-bottom: 26px; }
  .marca { color: var(--verde); font-weight: 600; letter-spacing: 4px; font-size: 15px; }
  h1 { font-family: Georgia, "Fraunces", serif; font-size: clamp(26px, 4vw, 40px); width: 100%; }
  .meta { opacity: .75; font-size: 14px; }
  .meta a { color: #fff; }
  .leyenda { display: flex; gap: 22px; align-items: center; margin: 0 0 22px; font-size: 14px; opacity: .95; }
  .dot { display: inline-block; width: 13px; height: 13px; border-radius: 50%; margin-right: 7px; vertical-align: -1px; }
  .dot.dir { background: var(--verde); } .dot.abb { background: var(--ambar); }
  .dot.hoy { background: none; border: 2px solid #fff; border-radius: 5px; }
  .meses { display: grid; grid-template-columns: repeat(auto-fill, minmax(285px, 1fr)); gap: 20px; }
  .card { background: var(--glass); border: 1px solid var(--borde); border-radius: 28px; padding: 20px 18px; backdrop-filter: blur(6px); }
  .card h2 { font-family: Georgia, "Fraunces", serif; font-size: 19px; text-align: center; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .dow { font-size: 11px; font-weight: 600; opacity: .65; text-align: center; padding: 2px 0 6px; }
  .day { aspect-ratio: 1 / .82; display: flex; align-items: center; justify-content: center; font-size: 13.5px;
    border-radius: 9px; background: rgba(255,255,255,.06); color: #eaf6f0; }
  .day.dir { background: var(--verde); color: #062c22; font-weight: 600; }
  .day.abb { background: var(--ambar); color: #3a2c00; font-weight: 600; }
  .day.past { opacity: .35; }
  .day.today { outline: 2.5px solid #fff; outline-offset: -2.5px; }
  .huespedes { margin-top: 34px; }
  .huespedes h2 { font-family: Georgia, "Fraunces", serif; font-size: 24px; margin-bottom: 14px; }
  .huespedes ul { list-style: none; display: flex; flex-direction: column; gap: 10px; max-width: 720px; }
  .huespedes li { background: var(--glass); border: 1px solid var(--borde); border-radius: 18px; padding: 12px 18px;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 15px; }
  .huespedes .fechas { margin-left: auto; opacity: .85; }
  .huespedes .vacio { opacity: .8; }
</style></head>
<body>
<header>
  <span class="marca">◆ ESMERALDA</span>
  <span class="meta">esmeraldalakes.com · al ${fmtCorto(todayDs)} ${Y} · se actualiza solo</span>
  <h1>Calendario de reservas</h1>
</header>
<div class="leyenda">
  <span><span class="dot dir"></span>Reserva directa</span>
  <span><span class="dot abb"></span>Airbnb</span>
  <span><span class="dot hoy"></span>Hoy</span>
  <span class="meta"><a href="${pngHref}">Descargar imagen</a></span>
</div>
<div class="meses">${cards}</div>
<div class="huespedes"><h2>Huéspedes</h2><ul>${list}</ul></div>
</body></html>`;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const full = q.full === "1" || q.full === "true";
  const wantsHtml = q.view === "html";

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");

  if (full || wantsHtml) {
    // Feed completo / vista interna con nombres → requiere llave
    const key = process.env.CAL_FEED_KEY || "";
    if (!key || !safeEqual(String(q.key || ""), key)) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(401).send("No autorizado");
    }
    // ?png=1 → la imagen del calendario (la misma que llega por Telegram), bajo demanda
    if (q.png === "1" || q.png === "true") {
      const { renderCalendarPng } = require("./_calimg");
      const png = await renderCalendarPng({ months: q.months ? Number(q.months) : 12 });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(png);
    }
    // ?view=html → landing interna viva (12 meses)
    if (wantsHtml) {
      const [blocks, customers] = await Promise.all([getAllBlocks(), readCustomers()]);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      return res.status(200).send(buildHtml(blocks, customers, String(q.key)));
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
