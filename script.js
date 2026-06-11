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
    ok: "¡Solicitud enviada! Te contactaremos muy pronto para confirmar. 🌴",
    badDates: "Revisa las fechas: la salida debe ser posterior a la llegada.",
    noDates: "Elige tus fechas de llegada y salida en el calendario.",
    fail: "No pudimos enviar tu solicitud ahora. Inténtalo de nuevo o escríbenos directamente.",
    months: ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"],
    dows: ["L","M","M","J","V","S","D"],
    summaryEmpty: "Selecciona tu llegada y salida.",
    nightWord: (n) => `${n} noche${n === 1 ? "" : "s"}`,
    legendFree: "Libre", legendBusy: "Ocupado", legendSel: "Tu estancia",
  },
  en: {
    sending: "Sending your request…",
    ok: "Request sent! We’ll contact you very soon to confirm. 🌴",
    badDates: "Check the dates: check-out must be after check-in.",
    noDates: "Pick your check-in and check-out dates on the calendar.",
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
    if (!res.ok) throw new Error("bad status " + res.status);
    status.className = "book__status book__status--ok";
    status.textContent = tr("ok");
    form.reset();
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
  if (summary) {
    if (CAL.checkin && CAL.checkout) {
      const nights = Math.round((new Date(CAL.checkout) - new Date(CAL.checkin)) / 86400000);
      summary.textContent = `${CAL.checkin} → ${CAL.checkout} · ${t.nightWord(nights)}`;
    } else if (CAL.checkin) {
      summary.textContent = `${CAL.checkin} → …`;
    } else {
      summary.textContent = t.summaryEmpty;
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
    const waFloat = document.getElementById("wa-float");
    if (waFloat) { waFloat.href = waUrl; waFloat.style.display = "inline-flex"; }
    const waBook = document.getElementById("book-wa");
    if (waBook) { waBook.href = waUrl; waBook.style.display = "block"; }
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

  // Calendario de disponibilidad
  wireCalendar();
});
