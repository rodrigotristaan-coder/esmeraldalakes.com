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
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "es" || saved === "en") return saved;
  return (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
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
    if (window.gtag) gtag("event", "generate_lead", { event_category: "booking", currency: "MXN" });
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
  rateHigh: 3700,      // temporada alta (+85%)
  eventSurcharge: 0.30, // +30% en fechas de eventos de la Arena GNP
  // Temporada alta (MM-DD). El primero cruza fin de año.
  highRanges: [["12-15", "01-06"], ["03-25", "04-15"], ["07-01", "08-18"]],
  // Eventos Arena GNP (rangos YYYY-MM-DD) — conciertos + semana del Abierto de Tenis
  eventRanges: [
    ["2026-07-04", "2026-07-04"], ["2026-08-01", "2026-08-01"], ["2026-09-20", "2026-09-20"],
    ["2026-10-02", "2026-10-02"], ["2026-10-31", "2026-10-31"], ["2026-11-14", "2026-11-14"],
    ["2027-02-22", "2027-02-28"],
  ],
};
function isHighSeason(mmdd) {
  return PRICING.highRanges.some(([a, b]) => (a <= b ? mmdd >= a && mmdd <= b : mmdd >= a || mmdd <= b));
}
function isEventDay(ds) {
  return PRICING.eventRanges.some(([a, b]) => ds >= a && ds <= b);
}
function estimatePrice(ci, co) {
  let total = 0, nights = 0;
  const cur = new Date(ci + "T00:00:00"), end = new Date(co + "T00:00:00");
  while (cur < end && nights < 365) {
    const ds = ymd(cur.getFullYear(), cur.getMonth(), cur.getDate());
    const dow = cur.getDay();
    let rate = isHighSeason(ds.slice(5)) ? PRICING.rateHigh : (dow === 5 || dow === 6 ? PRICING.rateWeekend : PRICING.rateBase);
    if (isEventDay(ds)) rate = Math.round(rate * (1 + PRICING.eventSurcharge));
    total += rate; nights++;
    cur.setDate(cur.getDate() + 1);
  }
  return { total, nights };
}
const TC_USD = 17.2; // tipo de cambio para mostrar precios en USD (versión EN)
const money = (n) => {
  const lang = document.body.dataset.lang || "es";
  return lang === "en"
    ? "$" + Math.round(n / TC_USD).toLocaleString("en-US") + " USD"
    : "$" + n.toLocaleString("es-MX") + " MXN";
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
    html += `<button type="button" class="${cls}" data-ds="${ds}" ${past || busy ? "disabled" : ""}>${d}</button>`;
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
        const { total } = estimatePrice(CAL.checkin, CAL.checkout);
        priceEl.textContent = (lang === "en" ? "Estimate: " : "Estimado: ") + money(total) +
          (lang === "en" ? " · final price confirmed by host" : " · precio final por confirmar");
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
    .then((d) => { CAL.blocked = Array.isArray(d.blocked) ? d.blocked : []; renderCalendar(); })
    .catch(() => {});
  renderCalendar();
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
    for (const rv of reviews || []) list.appendChild(reviewCard(rv));
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
  fig.innerHTML =
    `<div class="review-card__stars">${stars}</div>` +
    `<blockquote class="review-card__quote">${escHtml(rv.text)}</blockquote>` +
    `<figcaption class="review-card__who">${avatar}<span class="review-card__meta"><span class="review-card__name">${escHtml(rv.name)}</span></span></figcaption>`;
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
  applyLang(detectLang());

  document.querySelectorAll(".lang__btn").forEach((b) => {
    b.addEventListener("click", () => { applyLang(b.dataset.lang); renderCalendar(); });
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

  // Calendario de disponibilidad
  wireCalendar();

  // Reseñas (carga aprobadas + formulario para dejar reseña)
  loadReviews();
  wireReviewForm();
});
