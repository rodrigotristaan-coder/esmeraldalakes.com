// Imagen del calendario de reservas (PNG) para Telegram: próximos 2 meses con
// diseño Esmeralda (gradiente esmeralda + tarjetas de vidrio) y lista de huéspedes.
// Archivos con guion bajo NO son rutas en Vercel.
const fs = require("fs");
const path = require("path");
const { getAllBlocks, readCustomers } = require("./_lib");

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MES_CORTO = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const DOWS = ["L","M","M","J","V","S","D"];

// "Hoy" en horario de Acapulco (UTC-6, sin DST desde 2022)
function todayAcapulco() {
  return new Date(Date.now() - 6 * 3600e3);
}
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const fmtCorto = (ds) => {
  const [, m, d] = ds.split("-");
  return `${Number(d)} ${MES_CORTO[Number(m) - 1]}`;
};
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Fuente del bloqueo para un día-noche ds: "directo" gana sobre "airbnb"
function sourceFor(ds, blocks) {
  let src = null;
  for (const b of blocks) {
    if (ds >= b.start && ds < b.end) {
      if (b.source === "directo") return "directo";
      src = src || "airbnb";
    }
  }
  return src;
}

// Nombre a mostrar por reserva: el guardado en el bloqueo, o el del cliente del
// portal cuya reserva coincide en fechas, o un genérico.
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

function buildSvg(blocks, customers) {
  const now = todayAcapulco();
  const Y = now.getUTCFullYear(), M = now.getUTCMonth();
  const todayDs = ymd(Y, M, now.getUTCDate());
  const months = [[Y, M], [M === 11 ? Y + 1 : Y, (M + 1) % 12]];
  const windowStart = ymd(Y, M, 1);
  const lastY = months[1][0], lastM = months[1][1];
  const windowEnd = ymd(lastM === 11 ? lastY + 1 : lastY, (lastM + 1) % 12, 1);

  // Reservas que tocan la ventana de 2 meses, ordenadas
  const names = guestNameMap(customers);
  const inWindow = blocks
    .filter((b) => b.start < windowEnd && b.end > windowStart)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  const rows = inWindow.map((b) => {
    const nights = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
    const direct = b.source !== "airbnb";
    const name = direct ? (b.name || names[`${b.start}|${b.end}`] || "Reserva directa") : "Airbnb";
    return { name, direct, start: b.start, end: b.end, nights };
  });

  const W = 1440, MARGIN = 56, GAP = 36;
  const cardW = (W - MARGIN * 2 - GAP) / 2; // 646
  const pad = 34;
  const cellW = Math.floor((cardW - pad * 2) / 7); // 82
  const cellH = 66, cellGap = 6;
  const gridW = cellW * 7;
  const cardTop = 168;
  const cardH = 60 /*mes*/ + 36 /*dows*/ + 6 * (cellH + cellGap) + pad + 10;
  const listTop = cardTop + cardH + 46;
  const MAX_ROWS = 9;
  const shown = rows.slice(0, MAX_ROWS);
  const extra = rows.length - shown.length;
  const listH = (shown.length ? shown.length : 1) * 46 + (extra > 0 ? 40 : 0) + 66;
  const H = listTop + listH + 64;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#052620"/><stop offset="0.55" stop-color="#0a5944"/><stop offset="1" stop-color="#0f7a5f"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <polygon points="${MARGIN + 11},52 ${MARGIN + 22},63 ${MARGIN + 11},74 ${MARGIN},63" fill="#06d67e"/>
  <text x="${MARGIN + 34}" y="74" font-family="Inter" font-weight="600" font-size="26" fill="#06d67e" letter-spacing="4">ESMERALDA</text>
  <text x="${MARGIN}" y="128" font-family="Fraunces" font-weight="700" font-size="52" fill="#ffffff">Calendario de reservas</text>
  <text x="${W - MARGIN}" y="74" text-anchor="end" font-family="Inter" font-size="22" fill="#ffffff" opacity="0.75">esmeraldalakes.com</text>
  <text x="${W - MARGIN}" y="126" text-anchor="end" font-family="Inter" font-size="22" fill="#ffffff" opacity="0.75">al ${fmtCorto(todayDs)} ${Y}</text>`;

  months.forEach(([my, mm], i) => {
    const x0 = MARGIN + i * (cardW + GAP);
    s += `<rect x="${x0}" y="${cardTop}" width="${cardW}" height="${cardH}" rx="40" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.28"/>`;
    s += `<text x="${x0 + cardW / 2}" y="${cardTop + 52}" text-anchor="middle" font-family="Fraunces" font-weight="700" font-size="30" fill="#ffffff">${MESES[mm]} ${my}</text>`;
    const gx = x0 + (cardW - gridW) / 2;
    DOWS.forEach((d, k) => {
      s += `<text x="${gx + k * cellW + cellW / 2}" y="${cardTop + 88}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="18" fill="#ffffff" opacity="0.65">${d}</text>`;
    });
    const first = new Date(Date.UTC(my, mm, 1));
    const startDow = (first.getUTCDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(Date.UTC(my, mm + 1, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const idx = startDow + d - 1;
      const row = Math.floor(idx / 7), col = idx % 7;
      const cx = gx + col * cellW, cy = cardTop + 104 + row * (cellH + cellGap);
      const ds = ymd(my, mm, d);
      const src = sourceFor(ds, blocks);
      const isPast = ds < todayDs;
      let fill = "#ffffff", fillOp = "0.06", txt = "#eaf6f0", txtOp = isPast ? "0.35" : "0.92", weight = 400;
      if (src === "directo") { fill = "#06d67e"; fillOp = isPast ? "0.35" : "1"; txt = "#062c22"; txtOp = "1"; weight = 600; }
      else if (src === "airbnb") { fill = "#f5b301"; fillOp = isPast ? "0.35" : "1"; txt = "#3a2c00"; txtOp = "1"; weight = 600; }
      s += `<rect x="${cx + 3}" y="${cy}" width="${cellW - 6}" height="${cellH}" rx="16" fill="${fill}" fill-opacity="${fillOp}"/>`;
      if (ds === todayDs) s += `<rect x="${cx + 3}" y="${cy}" width="${cellW - 6}" height="${cellH}" rx="16" fill="none" stroke="#ffffff" stroke-width="3"/>`;
      s += `<text x="${cx + cellW / 2}" y="${cy + cellH / 2 + 8}" text-anchor="middle" font-family="Inter" font-weight="${weight}" font-size="22" fill="${txt}" fill-opacity="${txtOp}">${d}</text>`;
    }
  });

  // Leyenda
  const legY = cardTop + cardH + 6;
  s += `<circle cx="${MARGIN + 10}" cy="${legY}" r="10" fill="#06d67e"/>
  <text x="${MARGIN + 30}" y="${legY + 7}" font-family="Inter" font-size="20" fill="#ffffff" opacity="0.9">Reserva directa</text>
  <circle cx="${MARGIN + 230}" cy="${legY}" r="10" fill="#f5b301"/>
  <text x="${MARGIN + 250}" y="${legY + 7}" font-family="Inter" font-size="20" fill="#ffffff" opacity="0.9">Airbnb</text>
  <rect x="${MARGIN + 352}" y="${legY - 10}" width="20" height="20" rx="6" fill="none" stroke="#ffffff" stroke-width="3"/>
  <text x="${MARGIN + 382}" y="${legY + 7}" font-family="Inter" font-size="20" fill="#ffffff" opacity="0.9">Hoy</text>`;

  // Lista de huéspedes
  let ly = listTop + 20;
  s += `<text x="${MARGIN}" y="${ly}" font-family="Fraunces" font-weight="700" font-size="28" fill="#ffffff">Huéspedes</text>`;
  ly += 18;
  if (!shown.length) {
    ly += 30;
    s += `<text x="${MARGIN}" y="${ly}" font-family="Inter" font-size="22" fill="#ffffff" opacity="0.8">Sin reservas en estos 2 meses — calendario libre 🌴</text>`;
  }
  for (const r of shown) {
    ly += 46;
    const color = r.direct ? "#06d67e" : "#f5b301";
    s += `<circle cx="${MARGIN + 10}" cy="${ly - 7}" r="9" fill="${color}"/>
    <text x="${MARGIN + 32}" y="${ly}" font-family="Inter" font-weight="600" font-size="23" fill="#ffffff">${esc(r.name)}</text>
    <text x="${MARGIN + 470}" y="${ly}" font-family="Inter" font-size="23" fill="#ffffff" opacity="0.85">${fmtCorto(r.start)} - ${fmtCorto(r.end)} · ${r.nights} noche${r.nights === 1 ? "" : "s"}</text>`;
  }
  if (extra > 0) {
    ly += 42;
    s += `<text x="${MARGIN + 32}" y="${ly}" font-family="Inter" font-size="21" fill="#ffffff" opacity="0.7">+ ${extra} más…</text>`;
  }

  s += `</svg>`;
  return s;
}

async function renderCalendarPng() {
  const { Resvg } = require("@resvg/resvg-js");
  const [blocks, customers] = await Promise.all([getAllBlocks(), readCustomers()]);
  const svg = buildSvg(blocks, customers);
  // fs.readFileSync con __dirname para que Vercel (nft) incluya los TTF en el bundle
  const resvg = new Resvg(svg, {
    background: "#0a5944",
    font: {
      fontBuffers: [
        fs.readFileSync(path.join(__dirname, "_fonts", "inter-400.ttf")),
        fs.readFileSync(path.join(__dirname, "_fonts", "inter-600.ttf")),
        fs.readFileSync(path.join(__dirname, "_fonts", "fraunces-700.ttf")),
      ],
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
    },
  });
  return Buffer.from(resvg.render().asPng());
}

// Manda el calendario como foto al chat del anfitrión. Best-effort: nunca truena.
async function sendCalendarPhoto(caption) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.OWNER_CHAT_ID;
    if (!token || !chatId) return false;
    const png = await renderCalendarPng();
    const fd = new FormData();
    fd.append("chat_id", String(chatId));
    fd.append("photo", new Blob([png], { type: "image/png" }), "calendario-esmeralda.png");
    if (caption) fd.append("caption", caption);
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: fd });
    if (!r.ok) console.error("sendPhoto:", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("sendCalendarPhoto:", e.message);
    return false;
  }
}

module.exports = { renderCalendarPng, sendCalendarPhoto, buildSvg };
