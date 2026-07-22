/* ===================================================================
   Esmeralda · Diamante Lakes — idioma (ES/EN) + reserva por la página
   =================================================================== */

// Las funciones viven en el mismo dominio (Vercel) → rutas relativas.
const API_BASE = "";

const CONFIG = {
  bookingEndpoint: API_BASE + "/api/booking",
  availabilityEndpoint: API_BASE + "/api/availability",

  // 📱 WhatsApp con lada de México (52) + 10 dígitos.
  whatsappNumber: "525650058363",
};

// ---------- Internacionalización ----------
const STORAGE_KEY = "esmeralda_lang";

function detectLang() {
  // Página con idioma fijo (p. ej. /en/ indexable): body[data-page-lang] manda.
  const fixed = document.body.dataset.pageLang;
  if (fixed === "es" || fixed === "en") return fixed;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "es" || saved === "en") return saved;
  return (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
}

// Si existe una URL propia para el idioma pedido (hreflang), navegamos a ella
// en lugar de solo cambiar textos — así el usuario queda en la versión indexable.
function langUrl(lang) {
  const sel = `link[rel="alternate"][hreflang^="${lang}"]`;
  const alt = document.querySelector(sel);
  if (!alt) return null;
  const url = new URL(alt.href, location.href);
  return url.pathname === location.pathname ? null : url.pathname;
}

function applyLang(lang) {
  document.documentElement.lang = lang;
  // Cada elemento con data-es / data-en cambia su contenido (admite HTML simple).
  document.querySelectorAll("[data-es]").forEach((el) => {
    const val = el.getAttribute("data-" + lang);
    if (val != null) el.innerHTML = val;
  });
  // Estado visual de los botones de idioma.
  document.querySelectorAll(".lang__btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.lang === lang);
  });
  localStorage.setItem(STORAGE_KEY, lang);
  document.body.dataset.lang = lang;
}

// ---------- Reserva ----------
const T = {
  es: {
    sending: "Enviando tu solicitud…",
    ok: "✅ ¡Solicitud recibida! En breve te contactamos para confirmar disponibilidad, precio y forma de pago. ¡Gracias! 🌴",
    badDates: "Revisa las fechas: la salida debe ser posterior a la llegada.",
    noDates: "Elige tus fechas de llegada y salida en el calendario.",
    consent: "Por favor acepta el aviso de privacidad para continuar.",
    minNights: "La estancia mínima es de 2 noches.",
    fail: "No pudimos enviar tu solicitud ahora. Inténtalo de nuevo o escríbenos directamente.",
    months: ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"],
    dows: ["L","M","M","J","V","S","D"],
    summaryEmpty: "Selecciona tu llegada y salida.",
    nightWord: (n) => `${n} noche${n === 1 ? "" : "s"}`,
    legendFree: "Libre", legendBusy: "Ocupado", legendSel: "Tu estancia",
  },
  en: {
    sending: "Sending your request…",
    ok: "✅ Request received! We’ll contact you shortly to confirm availability, price and payment. Thank you! 🌴",
    badDates: "Check the dates: check-out must be after check-in.",
    noDates: "Pick your check-in and check-out dates on the calendar.",
    consent: "Please accept the privacy notice to continue.",
    minNights: "Minimum stay is 2 nights.",
    fail: "We couldn’t send your request right now. Please try again or contact us directly.",
    months: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    dows: ["M","T","W","T","F","S","S"],
    summaryEmpty: "Select your check-in and check-out.",
    nightWord: (n) => `${n} night${n === 1 ? "" : "s"}`,
    legendFree: "Free", legendBusy: "Booked", legendSel: "Your stay",
  },
};
const tr = (key) => (T[document.body.dataset.lang || "es"] || T.es)[key];

async function submitBooking(e) {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("booking-status");
  const data = Object.fromEntries(new FormData(form).entries());

  if (!data.checkin || !data.checkout) {
    status.className = "book__status book__status--err";
    status.textContent = tr("noDates");
    return;
  }
  if (data.checkout <= data.checkin) {
    status.className = "book__status book__status--err";
    status.textContent = tr("badDates");
    return;
  }
  // Mínimo de noches (2)
  const nights = Math.round((new Date(data.checkout) - new Date(data.checkin)) / 86400000);
  if (nights < 2) {
    status.className = "book__status book__status--err";
    status.textContent = tr("minNights");
    return;
  }
  // Consentimiento de privacidad
  const consent = document.getElementById("bf-consent");
  if (consent && !consent.checked) {
    status.className = "book__status book__status--err";
    status.textContent = tr("consent");
    return;
  }

  status.className = "book__status";
  status.textContent = tr("sending");
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;

  try {
    const res = await fetch(CONFIG.bookingEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, lang: document.body.dataset.lang }),
    });
    if (res.status === 422) {
      const j = await res.json().catch(() => ({}));
      status.className = "book__status book__status--err";
      status.textContent = j.error === "min_nights" ? tr("minNights") : tr("fail");
      return;
    }
    if (!res.ok) throw new Error("bad status " + res.status);
    status.className = "book__status book__status--ok";
    status.textContent = tr("ok");
    if (window.gtag) {
      // Valor estimado de la reserva + idioma/página, para segmentar campañas EN y medir ROAS.
      let leadValue = 0;
      try { if (CAL.checkin && CAL.checkout) leadValue = estimatePrice(CAL.checkin, CAL.checkout).total; } catch (_) {}
      gtag("event", "generate_lead", {
        event_category: "booking",
        currency: "MXN",
        value: leadValue,
        language: document.body.dataset.lang || "es",
        page_variant: document.body.dataset.pageLang === "en" ? "en-indexed" : "es-default",
      });
    }
    form.reset();
    // Redirige a la página de gracias (deja ~700ms para que el evento de conversión se envíe).
    setTimeout(function () { window.location.href = "/gracias.html"; }, 700);
  } catch (err) {
    status.className = "book__status book__status--err";
    status.textContent = tr("fail");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Calendario de disponibilidad ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------- Calculadora de precios (MXN) ----------
const PRICING = {
  rateBase: 2000,      // entre semana, temporada baja (precio "desde")
  rateWeekend: 2700,   // viernes y sábado (+35%)
  rateMedia: 2400,     // puentes (temporada media): sube la noche entre semana, respeta vie/sáb
  rateHigh: 4200,      // temporada alta (estudio de mercado 2026-07: comps de alta en $4,500–5,500)
  rateSpecial: 5000,   // fechas especiales: Navidad y Año Nuevo (MM-DD, cada año)
  specialDates: ["12-24", "12-25", "12-31", "01-01"],
  eventSurcharge: 0.40, // +40% en fechas de eventos de la Arena GNP (estudio 2026-07)
  // Temporada alta (MM-DD). El primero cruza fin de año. Verano hasta el fin real de
  // vacaciones SEP (23 ago); primavera desde el arranque de Semana Santa (19 mar).
  highRanges: [["12-15", "01-06"], ["03-19", "04-15"], ["07-01", "08-23"]],
  // Puentes oficiales (YYYY-MM-DD, noches incluidas)
  mediaRanges: [
    ["2026-11-13", "2026-11-15"],  // Revolución (sáb 14 – lun 16)
    ["2027-01-29", "2027-02-01"],  // Constitución (lun 1 feb)
    ["2027-03-12", "2027-03-15"],  // Benito Juárez (lun 15 mar)
  ],
  // Eventos Arena GNP / Mundo Imperial (rangos YYYY-MM-DD)
  eventRanges: [
    ["2026-07-04", "2026-07-04"], ["2026-08-01", "2026-08-01"], ["2026-09-14", "2026-09-14"],
    ["2026-09-20", "2026-09-20"], ["2026-10-02", "2026-10-02"], ["2026-10-31", "2026-10-31"],
    ["2026-11-06", "2026-11-06"], ["2026-11-14", "2026-11-14"],
    ["2026-11-23", "2026-11-29"],  // GNP México Major Premier Padel (semana completa)
    ["2027-02-19", "2027-02-28"],  // Abierto Mexicano de Tenis (20–27 feb + día previo)
  ],
  // Precio dinámico por ocupación (estudio 2026-07). Solo sobre base/finde/puente.
  dynamic: { floor: 1600, promoOff: 0.15, lastMinOff: 0.20, lastMinOffWknd: 0.10, surgeUp: 0.10 },
};
function isHighSeason(mmdd) {
  return PRICING.highRanges.some(([a, b]) => (a <= b ? mmdd >= a && mmdd <= b : mmdd >= a || mmdd <= b));
}
function isEventDay(ds) {
  return PRICING.eventRanges.some(([a, b]) => ds >= a && ds <= b);
}
function isMediaSeason(ds) {
  return PRICING.mediaRanges.some(([a, b]) => ds >= a && ds <= b);
}
// % de noches ocupadas del mes de `ds`, según la disponibilidad ya cargada (CAL.blocked).
function monthOccupancy(ds) {
  const y = +ds.slice(0, 4), m = +ds.slice(5, 7);
  const days = new Date(y, m, 0).getDate();
  let busy = 0;
  for (let d = 1; d <= days; d++) if (calBlocked(`${ds.slice(0, 7)}-${pad(d)}`)) busy++;
  return busy / days;
}
function daysUntil(ds) {
  return Math.round((new Date(ds + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 86400000);
}
// Tarifa de una noche concreta + etiqueta de por qué (para el desglose)
function dailyRate(ds) {
  const mmdd = ds.slice(5);
  // Fechas especiales (Navidad, Año Nuevo): tarifa fija tope, sin recargos encima
  if (PRICING.specialDates.includes(mmdd)) return { rate: PRICING.rateSpecial, kind: "special" };
  const dow = new Date(ds + "T00:00:00").getDay();
  let rate, kind;
  if (isHighSeason(mmdd)) { rate = PRICING.rateHigh; kind = "high"; }
  else if (dow === 5 || dow === 6) { rate = PRICING.rateWeekend; kind = "weekend"; }
  else { rate = PRICING.rateBase; kind = "base"; }
  // Puentes: sube la noche entre semana a tarifa media (nunca baja la de vie/sáb)
  if (kind !== "high" && isMediaSeason(ds) && rate < PRICING.rateMedia) { rate = PRICING.rateMedia; kind = "media"; }
  if (isEventDay(ds)) { rate = Math.round(rate * (1 + PRICING.eventSurcharge)); kind = "event"; return { rate, kind }; }
  // Precio dinámico por ocupación — solo base/finde/puente (nunca alta/evento/especial)
  if (kind === "base" || kind === "weekend" || kind === "media") {
    const D = PRICING.dynamic, occ = monthOccupancy(ds), dU = daysUntil(ds);
    if (occ >= 0.60 && dU <= 30) {
      rate = Math.round(rate * (1 + D.surgeUp)); // Regla C: alta demanda, sin promos
    } else {
      let off = 0;
      if (dU >= 0 && dU <= 21 && occ < 0.20) off = D.promoOff;                      // Regla A
      if (dU >= 0 && dU <= 7) off = Math.max(off, (dow === 5 || dow === 6) ? D.lastMinOffWknd : D.lastMinOff); // Regla B
      if (off > 0) { rate = Math.max(D.floor, Math.round(rate * (1 - off))); kind = "offer"; }
    }
  }
  return { rate, kind };
}
function estimatePrice(ci, co) {
  let total = 0, nights = 0;
  const byKind = {}; // kind → { rate, count } (para el desglose)
  const cur = new Date(ci + "T00:00:00"), end = new Date(co + "T00:00:00");
  while (cur < end && nights < 365) {
    const ds = ymd(cur.getFullYear(), cur.getMonth(), cur.getDate());
    const { rate, kind } = dailyRate(ds);
    const key = kind + rate;
    byKind[key] = byKind[key] || { kind, rate, count: 0 };
    byKind[key].count++;
    total += rate; nights++;
    cur.setDate(cur.getDate() + 1);
  }
  // Descuento por estancia larga (estudio 2026-07): 7+ noches −12%, 28+ noches −30%
  let discount = 0, discountKind = null;
  if (nights >= 28) { discount = Math.round(total * 0.30); discountKind = "monthly"; }
  else if (nights >= 7) { discount = Math.round(total * 0.12); discountKind = "weekly"; }
  return { total: total - discount, subtotal: total, discount, discountKind, nights, lines: Object.values(byKind).sort((a, b) => a.rate - b.rate) };
}
const TC_USD = 17.2; // tipo de cambio para mostrar precios en USD (versión EN)
const money = (n) => {
  const lang = document.body.dataset.lang || "es";
  return lang === "en"
    ? "$" + Math.round(n / TC_USD).toLocaleString("en-US") + " USD"
    : "$" + n.toLocaleString("es-MX") + " MXN";
};
// Versión compacta para las celdas del calendario ("$2,000" / "$116")
const moneyShort = (n) => {
  const lang = document.body.dataset.lang || "es";
  return lang === "en" ? "$" + Math.round(n / TC_USD) : "$" + n.toLocaleString("es-MX");
};

const CAL = {
  view: new Date(),         // mes mostrado
  blocked: [],              // [{start, end}] end exclusivo (estilo iCal)
  checkin: null,
  checkout: null,
};

function calBlocked(ds) {
  return CAL.blocked.some((b) => ds >= b.start && ds < b.end);
}
// ¿hay algún día ocupado dentro de [a, b)?
function rangeHasBlocked(a, b) {
  const cur = new Date(a + "T00:00:00");
  const end = new Date(b + "T00:00:00");
  while (cur < end) {
    const ds = ymd(cur.getFullYear(), cur.getMonth(), cur.getDate());
    if (calBlocked(ds)) return true;
    cur.setDate(cur.getDate() + 1);
  }
  return false;
}

function onDayClick(ds) {
  if (!CAL.checkin || (CAL.checkin && CAL.checkout)) {
    CAL.checkin = ds; CAL.checkout = null;
  } else if (ds > CAL.checkin && !rangeHasBlocked(CAL.checkin, ds)) {
    CAL.checkout = ds;
  } else {
    CAL.checkin = ds; CAL.checkout = null;
  }
  document.getElementById("bf-checkin").value = CAL.checkin || "";
  document.getElementById("bf-checkout").value = CAL.checkout || "";
  renderCalendar();
}

function renderCalendar() {
  const root = document.getElementById("calendar");
  if (!root) return;
  const t = T[document.body.dataset.lang || "es"] || T.es;
  const y = CAL.view.getFullYear(), m = CAL.view.getMonth();
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();

  const atMinMonth = y === new Date().getFullYear() && m === new Date().getMonth();

  let html = `<div class="cal__head">
    <button type="button" class="cal__nav" data-cal="prev" ${atMinMonth ? "disabled" : ""}>‹</button>
    <span class="cal__month">${t.months[m]} ${y}</span>
    <button type="button" class="cal__nav" data-cal="next">›</button>
  </div><div class="cal__grid">`;
  for (const d of t.dows) html += `<div class="cal__dow">${d}</div>`;
  for (let i = 0; i < startDow; i++) html += `<span class="cal__day cal__day--empty"></span>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = ymd(y, m, d);
    const past = ds < today;
    const busy = calBlocked(ds);
    let cls = "cal__day";
    if (ds === CAL.checkin) cls += " cal__day--in";
    else if (ds === CAL.checkout) cls += " cal__day--out";
    else if (CAL.checkin && CAL.checkout && ds > CAL.checkin && ds < CAL.checkout) cls += " cal__day--range";
    // Precio de la noche visible en cada día disponible
    const price = past || busy ? "" : `<i class="cal__rate">${moneyShort(dailyRate(ds).rate)}</i>`;
    html += `<button type="button" class="${cls}" data-ds="${ds}" ${past || busy ? "disabled" : ""}><span>${d}</span>${price}</button>`;
  }
  html += `</div><div class="cal__legend">
    <span><i class="cal__dot cal__dot--free"></i>${t.legendFree}</span>
    <span><i class="cal__dot cal__dot--busy"></i>${t.legendBusy}</span>
    <span><i class="cal__dot cal__dot--sel"></i>${t.legendSel}</span>
  </div>`;
  root.innerHTML = html;

  // Resumen
  const summary = document.getElementById("cal-summary");
  const priceEl = document.getElementById("book-price");
  const lang = document.body.dataset.lang || "es";
  if (summary) {
    if (CAL.checkin && CAL.checkout) {
      const nights = Math.round((new Date(CAL.checkout) - new Date(CAL.checkin)) / 86400000);
      summary.textContent = `${CAL.checkin} → ${CAL.checkout} · ${t.nightWord(nights)}`;
      if (priceEl) {
        const { total, subtotal, discount, discountKind, lines } = estimatePrice(CAL.checkin, CAL.checkout);
        const KIND = {
          es: { base: "entre semana", weekend: "vie y sáb", media: "puente", high: "temporada alta", event: "evento Arena GNP", special: "fecha especial", offer: "oferta" },
          en: { base: "weeknight", weekend: "Fri & Sat", media: "long weekend", high: "high season", event: "Arena GNP event", special: "holiday", offer: "special offer" },
        }[lang === "en" ? "en" : "es"];
        const DISC = {
          es: { weekly: "Descuento 7+ noches (−12%)", monthly: "Descuento 28+ noches (−30%)" },
          en: { weekly: "7+ night discount (−12%)", monthly: "28+ night discount (−30%)" },
        }[lang === "en" ? "en" : "es"];
        let rows = lines.map((l) =>
          `<div class="quote__row"><span>${l.count} × ${moneyShort(l.rate)} <em>(${KIND[l.kind]})</em></span><span>${moneyShort(l.rate * l.count)}</span></div>`
        ).join("");
        if (discount > 0) {
          rows += `<div class="quote__row quote__row--disc"><span>${DISC[discountKind]}</span><span>−${moneyShort(discount)}</span></div>`;
        }
        priceEl.innerHTML = `<div class="book__quote">${rows}
          <div class="quote__row quote__row--total"><span>${lang === "en" ? "Estimated total" : "Total estimado"}</span><span>${money(total)}</span></div>
          <div class="quote__note">${lang === "en" ? "Final price confirmed by the host. Direct booking — no platform fees." : "Precio final por confirmar con el anfitrión. Reserva directa, sin comisiones de plataforma."}</div></div>`;
      }
    } else {
      summary.textContent = CAL.checkin ? `${CAL.checkin} → …` : t.summaryEmpty;
      if (priceEl) priceEl.textContent = "";
    }
  }
}

function wireCalendar() {
  const root = document.getElementById("calendar");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-cal]");
    if (nav) {
      CAL.view.setMonth(CAL.view.getMonth() + (nav.dataset.cal === "next" ? 1 : -1));
      return renderCalendar();
    }
    const day = e.target.closest("[data-ds]");
    if (day && !day.disabled) onDayClick(day.dataset.ds);
  });
  // Carga las fechas ocupadas (Airbnb + manuales). Si falla, el calendario sigue usable.
  fetch(CONFIG.availabilityEndpoint)
    .then((r) => r.json())
    .then((d) => { CAL.blocked = Array.isArray(d.blocked) ? d.blocked : []; CAL.loaded = true; renderCalendar(); renderHeroAvail(); })
    .catch(() => {});
  renderCalendar();
}

// ---------- Próximas fechas libres en el hero (siguientes 3 meses) ----------
const HERO_MES = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

// Corridas de noches libres consecutivas empezando mañana, hasta +92 días.
function heroFreeRanges() {
  const MIN = 2; // estancia mínima
  const base = new Date(todayStr() + "T00:00:00");
  const ranges = [];
  let runStart = null, runNights = 0;
  for (let i = 1; i <= 92; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    const ds = ymd(d.getFullYear(), d.getMonth(), d.getDate());
    if (!calBlocked(ds)) {
      if (!runStart) { runStart = ds; runNights = 0; }
      runNights++;
    } else if (runStart) {
      if (runNights >= MIN) ranges.push({ checkin: runStart, checkout: ds, nights: runNights });
      runStart = null;
    }
  }
  if (runStart && runNights >= MIN) {
    const d = new Date(base); d.setDate(base.getDate() + 93);
    ranges.push({ checkin: runStart, checkout: ymd(d.getFullYear(), d.getMonth(), d.getDate()), nights: runNights });
  }
  return ranges;
}

// "24–30 jul" / "28 jul – 2 ago" (EN: "Jul 24–30" / "Jul 28 – Aug 2")
function fmtRange(a, b, lang) {
  const M = HERO_MES[lang === "en" ? "en" : "es"];
  const [ , am, ad ] = a.split("-").map(Number);
  const [ , bm, bd ] = b.split("-").map(Number);
  if (lang === "en") {
    return am === bm ? `${M[am - 1]} ${ad}–${bd}` : `${M[am - 1]} ${ad} – ${M[bm - 1]} ${bd}`;
  }
  return am === bm ? `${ad}–${bd} ${M[am - 1]}` : `${ad} ${M[am - 1]} – ${bd} ${M[bm - 1]}`;
}

function renderHeroAvail() {
  const wraps = document.querySelectorAll(".js-hero-avail");
  if (!wraps.length || !CAL.loaded) return;
  const lang = document.body.dataset.lang || "es";
  const ranges = heroFreeRanges().slice(0, 3);
  wraps.forEach((w) => {
    const pills = w.querySelector(".hero__avail-pills");
    if (!pills) return;
    if (!ranges.length) { w.hidden = true; return; }
    pills.innerHTML = ranges
      .map((r) => `<a href="#reservar">${fmtRange(r.checkin, r.checkout, lang)}</a>`)
      .join("");
    w.hidden = false;
  });
}

// ---------- Reseñas ----------
const escHtml = (s = "") => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const escAttr = (s = "") => escHtml(s).replace(/"/g, "&quot;");

async function loadReviews() {
  const list = document.getElementById("reviews-list");
  if (!list) return;
  try {
    const r = await fetch(API_BASE + "/api/review");
    const { reviews } = await r.json();
    // No duplicar reseñas que ya están fijas en el HTML (p. ej. Paulina)
    const staticNames = new Set([...list.querySelectorAll("[data-review-name]")].map((el) => el.dataset.reviewName));
    for (const rv of reviews || []) {
      if (staticNames.has(rv.name)) continue;
      list.appendChild(reviewCard(rv));
    }
  } catch {}
}

function reviewCard(rv) {
  const fig = document.createElement("figure");
  fig.className = "review-card";
  const rating = Math.max(1, Math.min(5, rv.rating || 5));
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const initials = (rv.name || "?").trim().slice(0, 1).toUpperCase();
  const avatar = rv.photo
    ? `<img class="review-card__avatar" src="${escAttr(rv.photo)}" alt="${escAttr(rv.name)}" width="52" height="52" loading="lazy" />`
    : `<span class="review-card__avatar" aria-hidden="true">${initials}</span>`;
  const date = rv.ts
    ? `<time class="review-card__date" datetime="${new Date(rv.ts).toISOString().slice(0, 10)}">${new Date(rv.ts).toLocaleDateString(document.documentElement.lang === "en" ? "en-US" : "es-MX", { year: "numeric", month: "long" })}</time>`
    : "";
  fig.innerHTML =
    `<figcaption class="review-card__who">${avatar}<span class="review-card__meta"><span class="review-card__name">${escHtml(rv.name)}</span></span><span class="review-card__stars">${stars}</span></figcaption>` +
    `<blockquote class="review-card__quote">${escHtml(rv.text)}</blockquote>` +
    date;
  return fig;
}

// Redimensiona la foto elegida (File) a un cuadrado pequeño → data URL JPEG (ligero).
function fileToAvatarDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, sx, sy, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
    img.src = url;
  });
}

function wireReviewForm() {
  const form = document.getElementById("review-form");
  if (!form) return;

  // El formulario aparece solo al tocar "Dejar una reseña".
  const toggle = document.getElementById("review-toggle");
  const wrap = document.getElementById("review-form-wrap");
  if (toggle && wrap) {
    toggle.addEventListener("click", () => {
      wrap.hidden = false;
      toggle.style.display = "none";
      const nm = document.getElementById("rv-name");
      if (nm) nm.focus();
      wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  const starsBox = document.getElementById("rv-stars");
  const ratingInput = document.getElementById("rv-rating");
  const paint = (v) => starsBox.querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) <= v));
  paint(Number(ratingInput.value) || 5);
  starsBox.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    ratingInput.value = b.dataset.v;
    paint(Number(b.dataset.v));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("review-status");
    const en = (document.body.dataset.lang || "es") === "en";
    const name = document.getElementById("rv-name").value.trim();
    const text = document.getElementById("rv-text").value.trim();
    if (!name || !text) {
      status.style.color = "#b23b3b";
      status.textContent = en ? "Please add your name and review." : "Completa tu nombre y reseña.";
      return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    status.style.color = "";
    status.textContent = en ? "Sending…" : "Enviando…";
    let photo = null;
    const f = document.getElementById("rv-photo").files[0];
    try { if (f) photo = await fileToAvatarDataUrl(f); } catch {}
    try {
      const res = await fetch(API_BASE + "/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, text, rating: Number(ratingInput.value) || 5, photo, company: document.getElementById("rv-company").value }),
      });
      if (!res.ok) throw new Error("bad");
      status.style.color = "#0a5944";
      status.textContent = en
        ? "Thank you! Your review will appear after a quick check. 🌴"
        : "¡Gracias! Tu reseña aparecerá tras una breve revisión. 🌴";
      form.reset();
      ratingInput.value = "5";
      paint(5);
    } catch {
      status.style.color = "#b23b3b";
      status.textContent = en ? "Couldn't send. Please try again." : "No se pudo enviar. Intenta de nuevo.";
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Arranque ----------
document.addEventListener("DOMContentLoaded", () => {
  const lang0 = detectLang();
  // Si el usuario prefiere EN y esta página tiene versión /en/ propia, redirigimos
  // para que URL y contenido siempre coincidan. Solo desde la página genérica
  // (sin data-page-lang); /en/ nunca auto-redirige (elección explícita).
  if (lang0 === "en" && !document.body.dataset.pageLang) {
    const dest = langUrl("en");
    if (dest) { location.replace(dest); return; }
  }
  applyLang(lang0);

  document.querySelectorAll(".lang__btn").forEach((b) => {
    b.addEventListener("click", () => {
      const target = b.dataset.lang;
      const dest = langUrl(target);
      if (dest) { localStorage.setItem(STORAGE_KEY, target); location.href = dest; return; }
      applyLang(target); renderCalendar(); renderHeroAvail();
    });
  });

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const nav = document.getElementById("nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("nav--scrolled", window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Botones de WhatsApp (flotante + dentro del formulario)
  if (CONFIG.whatsappNumber) {
    const lang = document.body.dataset.lang || "es";
    const msg = lang === "en"
      ? "Hi! I'm interested in the Esmeralda apartment at Diamante Lakes, Acapulco. Is it available?"
      : "¡Hola! Me interesa el departamento Esmeralda en Diamante Lakes, Acapulco. ¿Está disponible?";
    const waUrl = `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(msg)}`;
    const waEvent = () => { if (window.gtag) gtag("event", "contact", { method: "WhatsApp" }); };
    const waFloat = document.getElementById("wa-float");
    if (waFloat) { waFloat.href = waUrl; waFloat.style.display = "inline-flex"; waFloat.addEventListener("click", waEvent); }
    const waBook = document.getElementById("book-wa");
    if (waBook) { waBook.href = waUrl; waBook.style.display = "block"; waBook.addEventListener("click", waEvent); }
  }

  // Galería: botón "ver más / ver menos"
  const moreBtn = document.getElementById("gallery-more");
  const grid = document.getElementById("gallery-grid");
  if (moreBtn && grid) {
    moreBtn.addEventListener("click", () => {
      const collapsed = grid.classList.toggle("is-collapsed");
      moreBtn.setAttribute("data-es", collapsed ? "Ver más fotos" : "Ver menos");
      moreBtn.setAttribute("data-en", collapsed ? "See more photos" : "See less");
      moreBtn.innerHTML = moreBtn.getAttribute("data-" + (document.body.dataset.lang || "es"));
    });
  }

  const form = document.getElementById("booking-form");
  if (form) form.addEventListener("submit", submitBooking);
  const tsEl = document.getElementById("bf-ts");
  if (tsEl) tsEl.value = String(Date.now());

  // Link de referido: ?ref=ESM-XXXX precarga el campo del formulario
  const ref = new URLSearchParams(location.search).get("ref");
  const refEl = document.getElementById("bf-refcode");
  if (ref && refEl) {
    const clean = ref.trim().toUpperCase().match(/^ESM-[A-Z0-9]{4,8}$/);
    if (clean) {
      refEl.value = clean[0];
      try { sessionStorage.setItem("esm_ref", clean[0]); } catch {}
    }
  } else if (refEl) {
    try { const saved = sessionStorage.getItem("esm_ref"); if (saved) refEl.value = saved; } catch {}
  }

  // Calendario de disponibilidad
  wireCalendar();

  // Reseñas (carga aprobadas + formulario para dejar reseña)
  loadReviews();
  wireReviewForm();
});
