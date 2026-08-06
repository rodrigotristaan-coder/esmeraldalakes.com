// Lógica del panel de administración (cliente).
const $ = (id) => document.getElementById(id);

// Versión de este archivo. Debe coincidir con el ?v= del <script> en admin.html.
// Sirve para detectar que el panel abierto quedó viejo: con la pestaña abierta el
// navegador nunca vuelve a pedir el JS y los cambios no llegan nunca.
const VERSION = "20260806-1";

// Pregunta al servidor qué versión está publicada y avisa si la abierta quedó atrás
async function revisarVersion() {
  try {
    const html = await fetch("/admin.html", { cache: "no-store" }).then((r) => r.text());
    const m = html.match(/admin-app\.js\?v=([\w.-]+)/);
    if (m && m[1] && m[1] !== VERSION) $("nueva-version").classList.remove("hidden");
  } catch { /* sin conexión: no molestamos */ }
}

// El depa está en Acapulco: "hoy" se calcula en su huso, no en UTC ni en el del
// navegador. Con toISOString() la fecha saltaba al día siguiente a partir de las
// 18:00 hora local, y el panel mostraba mañana como si ya fuera hoy.
const TZ_MX = "America/Mexico_City";
const hoyMx = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ_MX });
// Suma días a un YYYY-MM-DD anclando al mediodía para que el huso no lo mueva.
const masDias = (ds, n) => new Date(new Date(ds + "T12:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const KEY_STORE = "esmeralda_admin_key";
let KEY = localStorage.getItem(KEY_STORE) || "";

function msg(t, ok = true) {
  const el = $("msg");
  el.textContent = t;
  el.style.color = ok ? "#8effcd" : "#ff8f8f";
}

async function api(params) {
  const url = "/api/admin?key=" + encodeURIComponent(KEY) + params;
  const r = await fetch(url);
  if (r.status === 401) throw new Error("401");
  return r.json();
}

// Igual que api(), pero manda un cuerpo JSON. La foto del ticket no cabe en la
// dirección: tiene que viajar en el cuerpo de la petición.
async function apiPost(params, body) {
  const url = "/api/admin?key=" + encodeURIComponent(KEY) + params;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new Error("401");
  return r.json();
}

// ===================== Pantallas y ventanas =====================
// El panel es una pantalla a la vez (antes era un solo scroll de 5 pantallas).
// El menú vive en el riel de la izquierda en escritorio y en la barra de abajo
// en celular; los dos se pintan de esta misma lista.
const VISTAS = [
  { id: "hoy",         nombre: "Hoy",         corto: "Hoy",     ico: "◆",  accion: { txt: "+ Nueva reserva",        mini: "+ Reserva",    fn: () => nuevaReserva() } },
  { id: "calendario",  nombre: "Calendario",  corto: "Calend.", ico: "🗓", accion: { txt: "+ Nueva reserva",        mini: "+ Reserva",    fn: () => nuevaReserva() } },
  { id: "dinero",      nombre: "Dinero",      corto: "Dinero",  ico: "💰", accion: { txt: "+ Registrar movimiento", mini: "+ Movimiento", fn: () => nuevoMov() } },
  { id: "recurrentes", nombre: "Recurrentes", corto: "Recurr.", ico: "🔁", accion: { txt: "+ Nuevo recurrente",     mini: "+ Recurrente", fn: () => nuevoRecurrente() } },
  { id: "gente",       nombre: "Huéspedes",   corto: "Gente",   ico: "👤", accion: { txt: "+ Dar de alta cliente",  mini: "+ Cliente",    fn: () => abrir("dlg-cliente") } },
];
let VISTA = "hoy";
let RV_PEND = 0; // reseñas esperando aprobación (para el globito del menú)

// Cuántas cosas piden atención en cada sección
function cuentas() {
  const rec = typeof pendientesDelMes === "function" ? pendientesDelMes().length : 0;
  const res = typeof pendientesDeReservas === "function" ? pendientesDeReservas().length : 0;
  return { hoy: rec + res + RV_PEND, recurrentes: rec + res, gente: RV_PEND };
}

function pintarMenu() {
  const c = cuentas();
  const rail = $("rail-nav"), tabs = $("tabs");
  if (rail) {
    rail.innerHTML = "";
    for (const v of VISTAS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "navlink";
      if (v.id === VISTA) b.setAttribute("aria-current", "page");
      b.innerHTML = `<span class="ico" aria-hidden="true">${v.ico}</span><span>${v.nombre}</span>` +
        (c[v.id] ? `<span class="pip">${c[v.id]}</span>` : "");
      b.addEventListener("click", () => irA(v.id));
      rail.appendChild(b);
    }
  }
  if (tabs) {
    tabs.innerHTML = "";
    for (const v of VISTAS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tab";
      if (v.id === VISTA) b.setAttribute("aria-current", "page");
      b.innerHTML = `<span class="ico" aria-hidden="true">${v.ico}</span><span>${v.corto}</span>` +
        (c[v.id] ? `<span class="pip">${c[v.id]}</span>` : "");
      b.addEventListener("click", () => irA(v.id));
      tabs.appendChild(b);
    }
  }
  const v = VISTAS.find((x) => x.id === VISTA);
  const acc = $("rail-accion");
  if (acc && v) { acc.textContent = v.accion.txt; acc.onclick = v.accion.fn; }
  const fab = $("fab");
  if (fab && v) { fab.textContent = v.accion.mini; fab.setAttribute("aria-label", v.accion.txt.replace("+ ", "")); fab.onclick = v.accion.fn; }
}

function irA(id) {
  VISTA = id;
  for (const v of VISTAS) {
    const el = $("v-" + v.id);
    if (el) el.hidden = v.id !== id;
  }
  pintarMenu();
  prepararPlegables();
  msg("");
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

// Bloques plegables en celular: los marcados con data-cerrado arrancan cerrados
// y el título los abre. En escritorio no aplica (sobra el espacio).
const esCelular = () => window.matchMedia("(max-width: 939px)").matches;
function prepararPlegables() {
  document.querySelectorAll(".bloque[data-plegable]").forEach((b) => {
    const h = b.querySelector("h2");
    if (!h || h.dataset.listo) return;
    h.dataset.listo = "1";
    h.setAttribute("role", "button");
    h.setAttribute("tabindex", "0");
    const alternar = () => {
      if (!esCelular()) return;
      b.dataset.tocado = "1";
      const cerrado = b.classList.toggle("plegado");
      h.setAttribute("aria-expanded", String(!cerrado));
    };
    h.addEventListener("click", alternar);
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); } });
  });
  // estado inicial: solo en celular, y solo la primera vez
  document.querySelectorAll(".bloque[data-cerrado]").forEach((b) => {
    if (b.dataset.tocado) return;
    b.classList.toggle("plegado", esCelular());
    b.querySelector("h2")?.setAttribute("aria-expanded", String(!esCelular()));
  });
}

const abrir = (id) => { const d = $(id); if (d && !d.open) d.showModal(); };
const cerrar = (id) => { const d = $(id); if (d && d.open) d.close(); };

// Fechas visibles siempre en dd-mmm-aaaa (los <input type=date> siguen en ISO)
const MABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtD(ds) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ds || "")) return ds || "";
  const [y, m, d] = ds.split("-");
  return `${d}-${MABBR[Number(m) - 1]}-${y}`;
}
function fmt(b) {
  return `${fmtD(b.start)} → ${fmtD(b.end)}`;
}

// ---- Mini calendario interactivo (elige llegada y salida tocando días) ----
let BLOCKS = [];
let SEL = { start: null, end: null };
const DOWS_MC = ["L", "M", "M", "J", "V", "S", "D"];
const MESES_MC = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const isoDay = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// El día anterior en ISO (cruza mes y año sin problema). Sirve para saber quién
// durmió la noche de ayer, que es quien sale en la mañana de hoy.
const prevDs = (ds) => {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};
// Los mismos colores del pantallazo: verde = directa, ámbar = Airbnb
const COLOR_MC = { dir: "#06d67e", abb: "#f5b301" };

// TODAS las reservas: las próximas Y las que ya pasaron.
// ⚠️ El servidor las manda en dos arreglos distintos — `all` trae SOLO las
// futuras y el historial va en `pasadas`. El calendario tiene que mirar los dos
// o los meses anteriores salen vacíos aunque sí hubiera huéspedes.
const todasReservas = () => BLOCKS.concat(PASADAS);

function srcFor(ds) {
  let src = null;
  for (const b of todasReservas()) {
    if (ds >= b.start && ds < b.end) {
      if (b.source !== "airbnb") return "dir";
      src = src || "abb";
    }
  }
  return src;
}

// Quién ocupa un día (para el hover y el clic)
function whoOn(ds) {
  for (const b of todasReservas()) {
    if (ds >= b.start && ds < b.end) {
      const quien = b.name || (b.source === "airbnb" ? "Reserva de Airbnb" : "Reserva directa");
      return { quien, b };
    }
  }
  return null;
}

// Meses visibles del calendario (0 = el mes en curso; negativo = pasado).
// En pantalla chica, 1.
let CAL_OFFSET = 0;
const CAL_MESES = window.matchMedia("(min-width: 700px)").matches ? 2 : 1;

// Hasta dónde deja retroceder el calendario: 36 meses fijos.
// Antes esto se calculaba desde el primer mes "con historia" — y salió mal: el
// servidor manda las reservas pasadas en OTRO arreglo (`pasadas`), así que el
// cálculo casi siempre daba 0 y la flecha de atrás quedaba muerta. Un tope fijo
// es más tonto y funciona siempre; un mes sin nada simplemente se ve vacío.
const calMinOffset = () => -36;

function renderMiniCal() {
  const box = $("minical");
  if (!box) return;
  // El mes que abre el calendario y el día marcado como "hoy" salen de la fecha
  // de Acapulco, no de la del navegador ni de UTC.
  const todayDs = hoyMx();
  const [Y, Mnum] = todayDs.split("-").map(Number);
  const M = Mnum - 1;
  box.innerHTML = "";
  for (let k = CAL_OFFSET; k < CAL_OFFSET + CAL_MESES; k++) {
    const my = Y + Math.floor((M + k) / 12), mm = ((M + k) % 12 + 12) % 12;
    const daysIn = new Date(my, mm + 1, 0).getDate();
    let sold = 0;
    for (let d = 1; d <= daysIn; d++) if (srcFor(isoDay(my, mm, d))) sold++;
    const sec = document.createElement("div");
    sec.className = "mc-month";
    sec.innerHTML = `<h4>${MESES_MC[mm]} ${my}<span class="pct">${Math.round((sold / daysIn) * 100)}%</span></h4>`;
    const grid = document.createElement("div");
    grid.className = "mc-grid";
    DOWS_MC.forEach((d) => grid.insertAdjacentHTML("beforeend", `<span class="mc-dow">${d}</span>`));
    const startDow = (new Date(my, mm, 1).getDay() + 6) % 7; // lunes = 0
    for (let i = 0; i < startDow; i++) grid.insertAdjacentHTML("beforeend", "<span></span>");
    for (let d = 1; d <= daysIn; d++) {
      const ds = isoDay(my, mm, d);
      const cls = ["mc-day"];
      // Cada celda son dos mitades, igual que el pantallazo de Telegram:
      // izquierda = mañana (la noche de ayer, o sea quién SALE ese día) y
      // derecha = noche (quién ENTRA y duerme). Estancia continua = celda llena.
      const eSrc = srcFor(ds);            // noche de hoy
      const mSrc = srcFor(prevDs(ds));    // noche de ayer
      let mitades = null;
      if (eSrc && mSrc === eSrc) cls.push(eSrc);           // llena, como siempre
      else if (mSrc || eSrc) { cls.push("mitades"); mitades = { mSrc, eSrc }; }
      if (ds < todayDs) cls.push("past");
      if (ds === todayDs) cls.push("today");
      if (ds === SEL.start || ds === SEL.end) cls.push("sel");
      else if (SEL.start && SEL.end && ds > SEL.start && ds < SEL.end) cls.push("inrange");
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = cls.join(" ");
      // Los colores de cada mitad van inline: el CSS los lee como gradiente.
      if (mitades) {
        cell.style.setProperty("--mit-izq", mitades.mSrc ? COLOR_MC[mitades.mSrc] : "transparent");
        cell.style.setProperty("--mit-der", mitades.eSrc ? COLOR_MC[mitades.eSrc] : "transparent");
      }
      cell.textContent = d;
      const w = whoOn(ds);
      // El detalle del día (quién está, quién llega o sale, y cuánto entró o salió)
      const detalle = detalleDia(ds);
      cell.title = detalle;
      cell.addEventListener("mouseenter", () => { const e = $("cal-who"); if (e) e.textContent = detalle; });
      cell.addEventListener("focus", () => { const e = $("cal-who"); if (e) e.textContent = detalle; });
      // Días futuros: eligen fechas de reserva o dicen quién está. Días
      // pasados: solo consulta — se ve quién estuvo y qué se movió ese día,
      // pero no se pueden elegir para una reserva nueva.
      cell.addEventListener("click", () => {
        if (ds < todayDs) { const e = $("cal-who"); if (e) e.textContent = detalle; return; }
        return w ? showWho(ds) : pickDay(ds);
      });
      grid.appendChild(cell);
    }
    sec.appendChild(grid);
    box.appendChild(sec);
  }
  const t = $("cal-title");
  if (t) {
    const a = new Date(Y, M + CAL_OFFSET, 1), b = new Date(Y, M + CAL_OFFSET + CAL_MESES - 1, 1);
    t.textContent = CAL_MESES === 1 || a.getTime() === b.getTime()
      ? `${MESES_MC[a.getMonth()]} ${a.getFullYear()}`
      : `${MESES_MC[a.getMonth()]} – ${MESES_MC[b.getMonth()]} ${b.getFullYear()}`;
  }
  // Las flechas se apagan al llegar al límite, y "Hoy" solo aparece si te fuiste
  const prev = $("cal-prev"), next = $("cal-next"), hoyBtn = $("cal-hoy");
  if (prev) prev.disabled = CAL_OFFSET <= calMinOffset();
  if (next) next.disabled = CAL_OFFSET >= 24 - CAL_MESES;
  if (hoyBtn) hoyBtn.hidden = CAL_OFFSET === 0;
}

function showWho(ds) {
  const w = whoOn(ds);
  const el = $("cal-who");
  if (!w) { if (el) el.textContent = ""; return; }
  const n = Math.round((new Date(w.b.end) - new Date(w.b.start)) / 86400000);
  const extras = [w.b.guests ? `${w.b.guests} pax` : null, w.b.rate ? `$${Number(w.b.rate).toLocaleString("es-MX")}/noche` : null].filter(Boolean).join(" · ");
  if (el) el.textContent = `👤 ${w.quien} · ${fmtD(w.b.start)} → ${fmtD(w.b.end)} (${n} noche${n === 1 ? "" : "s"})${extras ? " · " + extras : ""}`;
  msg(`Ese día está ocupado por ${w.quien}.`);
}

function calMove(delta) {
  CAL_OFFSET = Math.max(calMinOffset(), Math.min(24 - CAL_MESES, CAL_OFFSET + delta * CAL_MESES));
  const e = $("cal-who"); if (e) e.textContent = "";
  renderMiniCal();
}

// Volver al mes en curso de un toque (si te fuiste lejos hacia atrás o adelante)
function calHoy() {
  CAL_OFFSET = 0;
  const e = $("cal-who"); if (e) e.textContent = "";
  renderMiniCal();
}

function pickDay(ds) {
  if (!SEL.start || (SEL.start && SEL.end)) SEL = { start: ds, end: null };
  else if (ds > SEL.start) SEL.end = ds;
  else SEL = { start: ds, end: null };
  $("bstart").value = SEL.start || "";
  $("bend").value = SEL.end || "";
  renderMiniCal();
  // Con las dos fechas puestas ya no hay nada más que hacer en el calendario:
  // abrimos la ventana de reserva para completar los datos.
  if (SEL.end) { msg(`${fmtD(SEL.start)} → ${fmtD(SEL.end)}`); nuevaReserva(); }
  else msg(`Llegada: ${fmtD(SEL.start)} — ahora toca el día de salida.`);
}

function syncSelFromInputs() {
  SEL = { start: $("bstart").value || null, end: $("bend").value || null };
  if (SEL.start && SEL.end && SEL.end <= SEL.start) SEL.end = null;
  renderMiniCal();
}

// Ocupación de los próximos 365 días a partir de los bloqueos (noches vendidas / totales)
let OCC = null;
function calcOccupancy(blocks) {
  const today = hoyMx();
  const end = masDias(today, 365);
  let sold = 0;
  for (const b of blocks) {
    const s = b.start > today ? b.start : today;
    const e = b.end < end ? b.end : end;
    if (e > s) sold += Math.round((new Date(e) - new Date(s)) / 86400000);
  }
  return { sold: Math.min(sold, 365), pct: Math.round((Math.min(sold, 365) / 365) * 100) };
}

async function load() {
  let data;
  try {
    data = await api("&action=list");
  } catch (e) {
    showLogin();
    msg("Contraseña incorrecta.", false);
    return;
  }
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  applyBlocks(data);

  loadReviews();
  loadCustomers();
  loadFinance();
  loadRecurring();
}

// Pinta calendario y reservas con la lista que mande el servidor. Se llama
// también después de agregar/editar/liberar, con la lista que devuelve esa misma
// llamada: volver a pedir "list" ahí puede traer el blob viejo y perder el cambio.
function applyBlocks(data) {
  OCC = calcOccupancy(data.all || []);
  $("logout").classList.remove("hidden");

  // Mini calendario interactivo + link a la vista completa
  BLOCKS = data.all || [];
  renderMiniCal();
  const open = $("cal-open");
  if (open) open.href = "/calendario" + (KEY ? "?adminkey=" + encodeURIComponent(KEY) : "");

  // Reservas directas (editar / liberar / registrar ingreso)
  const direct = data.direct || [];
  const d = $("direct");
  d.innerHTML = direct.length ? "" : '<p class="muted">Sin reservas directas próximas.</p>';
  for (const b of direct) {
    const nights = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
    const div = document.createElement("div");
    div.className = "card";
    const who = b.name ? `<b>${escHtml(b.name)}</b> · ` : "";
    const extras = [
      `${nights} noche${nights === 1 ? "" : "s"}`,
      b.guests ? `${b.guests} pax` : null,
      b.rate ? `$${Number(b.rate).toLocaleString("es-MX")}/noche (≈$${(b.rate * nights).toLocaleString("es-MX")})` : null,
      `in ${b.checkinTime || "14:00"} · out ${b.checkoutTime || "10:00"}`,
      b.referredBy ? `🎟 ref: ${escHtml(b.referredBy)}` : null,
      b.freeNight ? "🌙 noche abonada" : null,
    ].filter(Boolean).join(" · ");
    div.innerHTML = `<span style="text-align:left">${who}${fmt(b)}<br><span class="muted">${extras}</span></span>`;
    const wrap = document.createElement("span");
    wrap.className = "row";
    const edit = document.createElement("button");
    edit.className = "quiet";
    edit.textContent = "Editar";
    edit.setAttribute("aria-label", `Editar la reserva de ${b.name || fmt(b)}`);
    edit.addEventListener("click", () => startEdit(b));
    wrap.appendChild(edit);
    const inc = document.createElement("button");
    inc.className = "quiet";
    inc.textContent = "Cobrar";
    inc.title = "Registrar el cobro de esta reserva en Dinero";
    inc.setAttribute("aria-label", `Registrar el cobro de ${b.name || fmt(b)}`);
    inc.addEventListener("click", () => quickIncome(b));
    wrap.appendChild(inc);
    const btn = document.createElement("button");
    btn.className = "quiet peligro";
    btn.textContent = "Liberar";
    btn.setAttribute("aria-label", `Liberar las fechas de ${b.name || fmt(b)}`);
    btn.addEventListener("click", () => release(b.start, b.end));
    wrap.appendChild(btn);
    div.appendChild(wrap);
    d.appendChild(div);
  }

  // Todas (read-only)
  const all = data.all || [];
  const a = $("all");
  a.innerHTML = all.length ? "" : '<p class="muted">Sin fechas ocupadas.</p>';
  const TOPE_ALL = 12;
  const verAll = a.dataset.todos === "1";
  for (const b of (verAll ? all : all.slice(0, TOPE_ALL))) {
    const div = document.createElement("div");
    div.className = "card";
    const quien = b.name ? `<b>${escHtml(b.name)}</b>` : '<span class="muted">sin nombre</span>';
    div.innerHTML = `<span style="text-align:left">${quien}<br><span class="muted">${fmt(b)} · ${escHtml(b.source)}` +
      `${b.guests ? " · " + b.guests + " pax" : ""}${b.rate ? " · " + money(b.rate) + "/noche" : ""}</span></span>`;
    // Datos que ponemos a mano: el nombre (Airbnb no lo manda) y el desglose de
    // cobro. Va en TODAS las reservas, no solo las de Airbnb: las estancias
    // pasadas de plataforma hay que crearlas a mano y quedan como directas.
    {
      const wrap = document.createElement("span");
      wrap.className = "row";
      // Airbnb sí manda el link a la reserva y los últimos 4 del teléfono:
      // con un clic ves ahí el nombre y el pago, y regresas a escribirlos.
      if (b.url) {
        const a2 = document.createElement("a");
        a2.href = b.url;
        a2.target = "_blank";
        a2.rel = "noopener";
        a2.className = "quiet";
        a2.style.cssText = "text-decoration:none;display:inline-block";
        a2.textContent = "Ver en Airbnb ↗";
        a2.title = "Abre esta reserva en Airbnb, donde sí están el nombre y el pago";
        wrap.appendChild(a2);
      }
      if (b.tel4) {
        const t = document.createElement("span");
        t.className = "muted";
        t.textContent = `tel …${b.tel4}`;
        wrap.appendChild(t);
      }
      const btn = document.createElement("button");
      btn.className = "quiet";
      btn.textContent = !b.name && b.source === "airbnb" ? "Poner nombre" : "Datos de cobro";
      btn.title = "Nombre, plataforma y desglose de lo que pagó el huésped";
      btn.addEventListener("click", () => editarNota(b));
      wrap.appendChild(btn);
      div.appendChild(wrap);
    }
    a.appendChild(div);
  }
  recortar(a, all.length, TOPE_ALL, "fechas", () => applyBlocks(data));
  PASADAS = data.pasadas || [];
  renderPasadas();
  renderHoy();
  renderResPend(); // las reservas cambiaron: recepción y limpieza también
}

// Estancias que ya terminaron. El panel solo mostraba el futuro, así que los
// huéspedes anteriores no aparecían por ningún lado.
let PASADAS = [];
function renderPasadas() {
  const box = $("pasadas");
  if (!box) return;
  box.innerHTML = "";
  if (!PASADAS.length) {
    box.innerHTML = '<div class="vacio"><b>Sin estancias anteriores</b>' +
      'Aquí caen las reservas cuya fecha de salida ya pasó, con lo que dejó cada huésped. ' +
      'Está vacío porque todas las reservas guardadas siguen vigentes. ' +
      'Si quieres ver aquí a huéspedes de antes, agrégalos en Calendario con sus fechas reales.</div>';
    return;
  }
  const TOPE_PAS = 10;
  const verPas = box.dataset.todos === "1";
  for (const b of (verPas ? PASADAS : PASADAS.slice(0, TOPE_PAS))) {
    const n = noches(b);
    // Lo que dejó: los movimientos que lleven su nombre
    const g = (b.name || "").trim().toLowerCase();
    let ing = 0, gas = 0;
    if (g) for (const m of FIN) {
      if ((m.guest || "").trim().toLowerCase() !== g) continue;
      const v = Number(m.amount) || 0;
      if (m.type === "in") ing += v; else gas += v;
    }
    const dejo = ing - gas;
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<span style="text-align:left"><b>${escHtml(quienDe(b))}</b><br>` +
      `<span class="muted">${fmtD(b.start)} → ${fmtD(b.end)} · ${n} noche${n === 1 ? "" : "s"}` +
      `${b.guests ? " · " + b.guests + " pax" : ""} · ${b.source === "airbnb" ? "Airbnb" : "directa"}</span></span>` +
      (ing || gas
        ? `<span class="muted num">pagó <b class="pos">${money(ing)}</b> · costó <b class="neg">${money(gas)}</b> · dejó <b class="${dejo >= 0 ? "pos" : "neg"}">${money(dejo)}</b></span>`
        : '<span class="muted">sin movimientos a su nombre</span>');
    const wrap = document.createElement("span");
    wrap.className = "row";
    const btn = document.createElement("button");
    btn.className = "quiet";
    btn.textContent = "Datos de cobro";
    btn.addEventListener("click", () => editarNota(b));
    wrap.appendChild(btn);
    div.appendChild(wrap);
    box.appendChild(div);
  }
  recortar(box, PASADAS.length, TOPE_PAS, "estancias", renderPasadas);
}

// Corta una lista larga y deja un botón para desplegar el resto. Sin esto, con
// el tiempo cada sección se vuelve un scroll infinito.
function recortar(box, total, mostrados, etiqueta, repintar) {
  if (total <= mostrados) return;
  const b = document.createElement("button");
  b.className = "vermas";
  const abierto = box.dataset.todos === "1";
  b.textContent = abierto ? `Mostrar solo ${mostrados}` : `Ver ${total - mostrados} ${etiqueta} más`;
  b.addEventListener("click", () => { box.dataset.todos = abierto ? "0" : "1"; repintar(); });
  box.appendChild(b);
}

const escHtml = (s = "") => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

// ===================== Costos por reserva =====================
// Cada huésped cuesta recibirlo y cuesta dejar el depa limpio cuando se va.
// Estos son los montos que se proponen; siempre se pueden ajustar antes de confirmar.
const COSTO_RECEPCION = 100;
const COSTO_LIMPIEZA = 400;

const quienDe = (b) => b.name || (b.source === "airbnb" ? "Airbnb" : "Reserva directa");
const conceptoRecepcion = (b) => `Recepción — ${quienDe(b)} ${fmtD(b.start)}`;
const conceptoLimpieza = (b) => `Limpieza — ${quienDe(b)} ${fmtD(b.end)}`;

// Cuando un huésped alarga su estancia, las noches extra pueden quedar como una
// reserva pegada a la anterior (con Airbnb no hay de otra: su reserva no se
// puede mover desde aquí). Eso NO es una llegada nueva ni una salida: no se le
// recibe otra vez ni se limpia el depa con él adentro. Se reconoce por lo único
// que se puede saber sin inventar campos: mismo nombre y fechas pegadas.
const mismaReserva = (a, b) => a.start === b.start && a.end === b.end;
const mismoHuesped = (a, b) => {
  const n = (a.name || "").trim().toLowerCase();
  return !!n && n === (b.name || "").trim().toLowerCase();
};
// ¿Esta reserva continúa una anterior del mismo huésped? (no hubo llegada)
const esContinuacion = (b) => todasReservas().some((x) => !mismaReserva(x, b) && x.end === b.start && mismoHuesped(x, b));
// ¿Al terminar esta reserva el huésped se queda? (no hubo salida)
const sigueDespues = (b) => todasReservas().some((x) => !mismaReserva(x, b) && x.start === b.end && mismoHuesped(x, b));

// Propone recepción y limpieza de cada reserva que no esté ya registrada.
// Ventana: de 60 días atrás a 7 adelante, para que la de mañana ya aparezca.
function pendientesDeReservas() {
  const hoyDs = hoyMx();
  const desde = masDias(hoyDs, -60);
  const hasta = masDias(hoyDs, 7);
  const yaHay = new Set(FIN.map((m) => (m.concept || "").trim().toLowerCase()));
  const out = [];
  // ⚠️ Con BLOCKS solo (que son las FUTURAS) esta ventana de 60 días atrás no
  // veía nada del pasado: las recepciones y limpiezas de huéspedes que ya se
  // fueron jamás aparecían como pendientes de registrar.
  for (const b of todasReservas()) {
    const items = [];
    // Una continuación no se cobra como llegada nueva ni como salida: el huésped
    // ni se fue ni volvió a llegar, solo se quedó más noches.
    if (!esContinuacion(b)) items.push({ tipo: "recepcion", date: b.start, amount: COSTO_RECEPCION, concept: conceptoRecepcion(b), etiqueta: "Recepción", categoria: "Recepción" });
    if (!sigueDespues(b)) items.push({ tipo: "limpieza", date: b.end, amount: COSTO_LIMPIEZA, concept: conceptoLimpieza(b), etiqueta: "Limpieza", categoria: "Limpieza" });
    for (const it of items) {
      if (it.date < desde || it.date > hasta) continue;
      if (yaHay.has(it.concept.trim().toLowerCase())) continue;
      out.push({ ...it, b, futuro: it.date > hoyDs });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ¿Qué pasa un día concreto? Se usa en el calendario y en la cinta de Hoy.
function dineroDelDia(ds) {
  let ing = 0, gas = 0;
  for (const m of FIN) {
    if (m.date !== ds) continue;
    const v = Number(m.amount) || 0;
    if (m.type === "in") ing += v; else gas += v;
  }
  return { ing, gas };
}

function detalleDia(ds) {
  const partes = [];
  const w = whoOn(ds);
  const llega = todasReservas().filter((b) => b.start === ds);
  const sale = todasReservas().filter((b) => b.end === ds);
  if (w) partes.push(`👤 ${w.quien}`);
  for (const b of llega) partes.push(`🛬 llega ${quienDe(b)} · recepción ${money(COSTO_RECEPCION)}`);
  for (const b of sale) partes.push(`🧹 sale ${quienDe(b)} · limpieza ${money(COSTO_LIMPIEZA)}`);
  if (!partes.length) partes.push("libre");
  const { ing, gas } = dineroDelDia(ds);
  if (ing) partes.push(`entra ${money(ing)}`);
  if (gas) partes.push(`sale ${money(gas)}`);
  if (!ing && !gas) partes.push("sin movimientos");
  return `${fmtD(ds)} · ${partes.join(" · ")}`;
}

// ===================== Pantalla HOY =====================
// Responde de un vistazo: ¿quién está en el depa?, ¿qué me falta hacer?,
// ¿quién llega? La cinta muestra los próximos 30 días de un solo golpe.
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function fechaLarga(ds) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ds || "")) return ds || "";
  const [y, m, d] = ds.split("-").map(Number);
  return `${d} de ${MES_LARGO[m - 1]}`;
}
const noches = (b) => Math.round((new Date(b.end) - new Date(b.start)) / 86400000);

// ===================== Alargar la estancia =====================
// El caso real: el huésped ya está adentro y decide quedarse más noches, a un
// precio que se acuerda en el momento (casi nunca es la tarifa con la que entró).
// Si la reserva es directa se le recorre la salida. Si viene de Airbnb no se
// puede tocar —llega por su calendario—, así que las noches extra se guardan
// como una reserva directa pegada a la suya, con su mismo nombre.
let EXT = null;

// Quién está en el depa. El día de salida cuenta: es justo cuando más se pide
// quedarse otra noche. Si ese día ya llegó alguien más, gana quien duerme hoy.
function huespedActual() {
  const hoyDs = hoyMx();
  const todas = todasReservas();
  return todas.find((b) => hoyDs >= b.start && hoyDs < b.end) || todas.find((b) => b.end === hoyDs) || null;
}

// Si ya se le añadieron noches antes, la estancia se alarga desde la última.
function ultimaDeLaEstancia(b) {
  let cur = b;
  for (let i = 0; i < 20; i++) {
    const sig = todasReservas().find((x) => !mismaReserva(x, cur) && x.start === cur.end && mismoHuesped(x, cur));
    if (!sig) return cur;
    cur = sig;
  }
  return cur;
}

// Cuántas noches caben antes de la siguiente reserva. Sin este tope se podría
// alargar una estancia encima de otra: el servidor no valida traslapes, así que
// el resultado sería el depa rentado dos veces la misma noche.
function nochesLibresTras(b) {
  const sig = todasReservas()
    .filter((x) => !mismaReserva(x, b) && x.start >= b.end)
    .sort((x, y) => x.start.localeCompare(y.start))[0];
  if (!sig) return { tope: Infinity, sig: null };
  return { tope: Math.round((new Date(sig.start) - new Date(b.end)) / 86400000), sig };
}

// Lo ya registrado a nombre de este huésped (para no volver a cobrarle de más)
function ingresoDe(b) {
  const n = (b.name || "").trim().toLowerCase();
  if (!n) return 0;
  return FIN.filter((m) => m.type === "in" && (m.guest || "").trim().toLowerCase() === n)
    .reduce((a, m) => a + (Number(m.amount) || 0), 0);
}

function abrirExtender() {
  const actual = huespedActual();
  if (!actual) { msg("Ahora mismo no hay ningún huésped al que alargarle la estancia.", false); return; }
  const b = ultimaDeLaEstancia(actual);
  const { tope, sig } = nochesLibresTras(b);
  EXT = { b, tope, sig };
  // Lo que venía pagando por noche: en una directa es su tarifa; en Airbnb sale
  // del desglose anotado. Es contexto para decidir, no el precio que se propone:
  // una noche extra se vende directa, no al precio de la plataforma.
  const nb = noches(b);
  const porNoche = b.rate || (b.tarifa && nb ? Math.round((b.tarifa / nb) * 100) / 100 : 0);
  const canal = b.source === "airbnb" ? "Airbnb" : "reserva directa";
  $("ext-quien").textContent = `${quienDe(b)} · ${canal} · ${fmtD(b.start)} → ${fmtD(b.end)}` +
    (porNoche ? ` · venía pagando ${money(porNoche)}/noche` : "");
  $("ext-noches").value = "1";
  if (Number.isFinite(tope)) $("ext-noches").max = String(tope); else $("ext-noches").removeAttribute("max");
  // La tarifa de una directa sirve de punto de partida; la de Airbnb no, porque
  // estas noches ya no las cobra la plataforma. Ahí se escribe a propósito.
  $("ext-precio").value = b.source === "airbnb" ? "" : (b.rate || "");
  $("ext-cobrar").checked = true;
  pintarExtender();
  abrir("dlg-extender");
  $("ext-noches").focus();
}

function pintarExtender() {
  if (!EXT) return;
  const el = $("ext-resumen");
  const btn = $("ext-guardar");
  const n = Math.floor(Number($("ext-noches").value) || 0);
  const p = Math.round((Number($("ext-precio").value) || 0) * 100) / 100;
  const choca = () => `${quienDe(EXT.sig)} llega el ${fechaLarga(EXT.sig.start)}`;
  if (EXT.tope < 1) {
    el.textContent = `No cabe ninguna noche extra: ${choca()}, justo cuando termina esta reserva.`;
    btn.disabled = true;
    return;
  }
  if (n < 1) { el.textContent = "Escribe cuántas noches se queda."; btn.disabled = true; return; }
  if (n > EXT.tope) {
    el.textContent = `Solo caben ${EXT.tope} noche${EXT.tope === 1 ? "" : "s"}: ${choca()}.`;
    btn.disabled = true;
    return;
  }
  const nuevoEnd = masDias(EXT.b.end, n);
  el.innerHTML = `Se queda hasta el <b>${escHtml(fechaLarga(nuevoEnd))}</b> (salida ${escHtml(EXT.b.checkoutTime || "10:00")}).` +
    (p > 0 ? ` Son <b>${money(n * p)}</b> por ${n} noche${n === 1 ? "" : "s"}.` : " Falta el precio por noche.");
  btn.disabled = false;
}

async function guardarExtension() {
  if (!EXT) return;
  const b = EXT.b;
  const n = Math.floor(Number($("ext-noches").value) || 0);
  const p = Math.round((Number($("ext-precio").value) || 0) * 100) / 100;
  const cobrar = $("ext-cobrar").checked;
  if (n < 1 || n > EXT.tope) { msg("Revisa cuántas noches se queda.", false); return; }
  if (cobrar && !(p > 0)) { msg("Ponle precio por noche, o desmarca el registro del ingreso.", false); return; }
  const nuevoEnd = masDias(b.end, n);
  const btn = $("ext-guardar");
  btn.disabled = true;
  try {
    let r;
    if (b.source === "airbnb") {
      const qs = [
        `&start=${b.end}`, `&end=${nuevoEnd}`,
        `&name=${encodeURIComponent(b.name || "")}`,
        b.guests ? `&guests=${b.guests}` : "",
        p > 0 ? `&rate=${p}` : "",
        `&checkinTime=${encodeURIComponent(b.checkinTime || "14:00")}`,
        `&checkoutTime=${encodeURIComponent(b.checkoutTime || "10:00")}`,
      ].join("");
      r = await api("&action=block" + qs);
    } else {
      // Solo se manda la salida nueva: lo que no viaja, el servidor lo conserva.
      r = await api(`&action=block-update&ostart=${b.start}&oend=${b.end}&end=${nuevoEnd}`);
    }
    if (!r.ok) throw new Error(r.error || "no se pudo");
    cerrar("dlg-extender");
    EXT = null;
    if (r.direct) applyBlocks(r); else await load();
    msg(`Estancia alargada hasta el ${fmtD(nuevoEnd)} ✅`);
    // El ingreso va aparte y después: son dos documentos distintos, y si este
    // falla la estancia ya quedó bien (que es lo que no se puede perder).
    if (cobrar && p > 0) {
      const concepto = `Noches extra — ${quienDe(b)} · ${n} noche${n === 1 ? "" : "s"} hasta ${fmtD(nuevoEnd)}`;
      try {
        const fr = await financeAdd({ type: "in", date: hoyMx(), concept: concepto, category: "Reserva", amount: n * p, guest: b.name || "" });
        if (fr.movs) applyFinance(fr.movs);
        msg(`Estancia alargada hasta el ${fmtD(nuevoEnd)} · ${money(n * p)} registrados ✅`);
      } catch (e) {
        msg("Se añadieron las noches, pero el ingreso NO se guardó. Regístralo en Dinero.", false);
      }
    }
  } catch (e) {
    msg("No se pudieron añadir las noches: " + e.message, false);
  } finally {
    btn.disabled = false;
  }
}

function renderHoy() {
  const hoyDs = hoyMx();
  const f = $("hoy-fecha");
  if (f) {
    const [y, m, dd] = hoyDs.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, dd));
    f.textContent = `${DIA_LARGO[d.getUTCDay()]} ${dd} de ${MES_LARGO[m - 1]} de ${y}`;
  }

  // --- Quién está ahora / cuándo llega el siguiente ---
  const ahora = BLOCKS.find((b) => hoyDs >= b.start && hoyDs < b.end);
  const proximas = BLOCKS.filter((b) => b.start >= hoyDs).sort((a, b) => a.start.localeCompare(b.start));
  const frase = $("hoy-frase"), sub = $("hoy-sub");
  if (frase) {
    if (ahora) {
      const quien = ahora.name || (ahora.source === "airbnb" ? "Un huésped de Airbnb" : "Un huésped");
      frase.innerHTML = `<b>${escHtml(quien)}</b> está en el depa.`;
      const extras = [
        `sale el ${fechaLarga(ahora.end)}`,
        ahora.guests ? `${ahora.guests} huéspedes` : null,
        `salida ${ahora.checkoutTime || "10:00"}`,
      ].filter(Boolean).join(" · ");
      if (sub) sub.textContent = extras;
    } else if (proximas.length) {
      const p = proximas[0];
      const dias = Math.round((new Date(p.start) - new Date(hoyDs)) / 86400000);
      const quien = p.name || (p.source === "airbnb" ? "un huésped de Airbnb" : "una reserva directa");
      frase.innerHTML = `El depa está <b>libre</b>.`;
      if (sub) sub.textContent = dias === 0
        ? `Hoy llega ${quien}.`
        : `Lo siguiente es ${quien}, ${dias === 1 ? "mañana" : `en ${dias} días`} (${fechaLarga(p.start)}).`;
    } else {
      frase.innerHTML = `El depa está <b>libre</b>.`;
      if (sub) sub.textContent = "No hay reservas próximas.";
    }
  }

  // --- Ficha del huésped actual, con el botón de alargarle la estancia ---
  // Aparece también el día que se va: ese día es cuando piden quedarse más.
  const hc = $("hoy-huesped"), hd = $("hoy-huesped-d");
  if (hc && hd) {
    const act = huespedActual();
    if (act) {
      const b = ultimaDeLaEstancia(act);
      const n = noches(b);
      const canal = b.source === "airbnb" ? "Airbnb" : "Reserva directa";
      const cobrado = ingresoDe(b);
      const partes = [
        `<b>${escHtml(quienDe(b))}</b>`,
        canal,
        `${fmtD(b.start)} → ${fmtD(b.end)} · ${n} noche${n === 1 ? "" : "s"}`,
        b.end === hoyDs ? "sale hoy" : null,
        b.rate ? `${money(b.rate)}/noche` : null,
        cobrado > 0 ? `${money(cobrado)} registrados` : "sin ingreso registrado",
      ].filter(Boolean);
      hd.innerHTML = partes.join('<span class="sep">·</span>');
      hc.hidden = false;
    } else {
      hc.hidden = true;
    }
  }

  // --- Cinta: 30 días ---
  const cinta = $("hoy-cinta");
  if (cinta) {
    cinta.innerHTML = "";
    for (let i = 0; i < 30; i++) {
      const ds = masDias(hoyDs, i);
      // Mismas mitades que el calendario: izquierda = mañana (quien sale),
      // derecha = noche (quien entra), barra llena = estancia continua.
      const eSrc = srcFor(ds);
      const mSrc = srcFor(prevDs(ds));
      let cls = "", mitades = null;
      if (eSrc && mSrc === eSrc) cls = " " + eSrc;
      else if (mSrc || eSrc) { cls = " mitades"; mitades = { mSrc, eSrc }; }
      const el = document.createElement("span");
      el.className = "cinta__d" + cls + (i === 0 ? " hoy" : "");
      if (mitades) {
        el.style.setProperty("--mit-izq", mitades.mSrc ? COLOR_MC[mitades.mSrc] : "transparent");
        el.style.setProperty("--mit-der", mitades.eSrc ? COLOR_MC[mitades.eSrc] : "transparent");
      }
      el.tabIndex = 0;
      const detalle = detalleDia(ds);
      el.title = detalle;
      const mostrar = () => { const e = $("hoy-dia"); if (e) e.textContent = detalle; };
      el.addEventListener("mouseenter", mostrar);
      el.addEventListener("focus", mostrar);
      el.addEventListener("click", mostrar);
      cinta.appendChild(el);
    }
    const a = $("hoy-eje-a"), b = $("hoy-eje-b");
    if (a) a.textContent = "hoy";
    if (b) b.textContent = fmtD(masDias(hoyDs, 29));
  }

  // --- Por hacer ---
  const box = $("hoy-pend");
  if (box) {
    box.innerHTML = "";
    const items = [];
    const res = pendientesDeReservas();
    if (res.length) {
      const total = res.reduce((a, r) => a + r.amount, 0);
      const quienes = [...new Set(res.map((r) => quienDe(r.b)))].join(", ");
      items.push({ ico: "🧹", txt: `${res.length} cobro${res.length === 1 ? "" : "s"} de recepción o limpieza sin registrar`,
        sub: `${money(total)} en total · ${quienes}`, btn: "Revisar", ir: "recurrentes" });
    }
    const rec = pendientesDelMes();
    if (rec.length) {
      const total = rec.reduce((a, x) => a + montoPropuesto(x), 0);
      items.push({ ico: "🔁", txt: `${rec.length} gasto${rec.length === 1 ? "" : "s"} recurrente${rec.length === 1 ? "" : "s"} sin registrar`,
        sub: `${money(total)} en total · ${rec.map((x) => x.concept).join(", ")}`, btn: "Revisar", ir: "recurrentes" });
    }
    if (RV_PEND) {
      items.push({ ico: "📝", txt: `${RV_PEND} reseña${RV_PEND === 1 ? "" : "s"} esperando tu visto bueno`,
        sub: "Nadie la ve en la landing hasta que la apruebes.", btn: "Revisar", ir: "gente" });
    }
    // Reservas que ya terminaron y no tienen un ingreso registrado a ese nombre
    const cobrados = new Set(FIN.filter((m) => m.type === "in" && m.guest).map((m) => m.guest.trim().toLowerCase()));
    // Idem: pidiendo `b.end <= hoy` sobre BLOCKS (futuras) esto solo cazaba una
    // reserva que terminara HOY. Con el historial ya avisa de verdad.
    const sinCobrar = todasReservas().filter((b) => b.source !== "airbnb" && b.name && b.end <= hoyDs && !cobrados.has(b.name.trim().toLowerCase()));
    if (sinCobrar.length) {
      items.push({ ico: "💵", txt: `${sinCobrar.length} reserva${sinCobrar.length === 1 ? "" : "s"} terminada${sinCobrar.length === 1 ? "" : "s"} sin ingreso registrado`,
        sub: sinCobrar.map((b) => `${b.name} (${fmtD(b.start)})`).join(", "), btn: "Ir a reservas", ir: "calendario" });
    }
    if (!items.length) {
      box.innerHTML = '<div class="vacio"><b>Todo al día</b>No hay nada pendiente por ahora.</div>';
    } else {
      for (const it of items) {
        const div = document.createElement("div");
        div.className = "pend";
        div.innerHTML = `<span class="pend__ico" aria-hidden="true">${it.ico}</span>` +
          `<span class="pend__txt">${escHtml(it.txt)}<small>${escHtml(it.sub)}</small></span>`;
        const b = document.createElement("button");
        b.className = "quiet";
        b.textContent = it.btn;
        b.addEventListener("click", () => irA(it.ir));
        div.appendChild(b);
        box.appendChild(div);
      }
    }
  }

  // --- Próximas llegadas ---
  const lleg = $("hoy-llegadas");
  if (lleg) {
    lleg.innerHTML = "";
    const lista = proximas.slice(0, 5);
    if (!lista.length) {
      lleg.innerHTML = '<div class="vacio"><b>Sin llegadas próximas</b>Toca “Nueva reserva” para agendar una.</div>';
    } else {
      for (const b of lista) {
        const dias = Math.round((new Date(b.start) - new Date(hoyDs)) / 86400000);
        const n = noches(b);
        const div = document.createElement("div");
        div.className = "card";
        const quien = b.name || (b.source === "airbnb" ? "Reserva de Airbnb" : "Reserva directa");
        const cuando = dias === 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`;
        div.innerHTML = `<span style="text-align:left"><b>${escHtml(quien)}</b><br>` +
          `<span class="muted">${fmtD(b.start)} → ${fmtD(b.end)} · ${n} noche${n === 1 ? "" : "s"}` +
          `${b.guests ? " · " + b.guests + " pax" : ""}${b.rate ? " · " + money(b.rate) + "/noche" : ""}</span></span>` +
          `<span class="muted num">${cuando}</span>`;
        lleg.appendChild(div);
      }
    }
  }
  pintarMenu();
}

async function loadReviews() {
  let data;
  try { data = await api("&action=reviews"); } catch { return; }
  applyReviews(data.reviews || []);
}

function applyReviews(all) {
  const data = { reviews: all };
  const pending = (data.reviews || []).filter((r) => r.status !== "approved");
  const approved = (data.reviews || []).filter((r) => r.status === "approved");

  const renderInto = (elId, list, isPending) => {
    const box = $(elId);
    box.innerHTML = list.length ? "" : '<p class="muted">Sin reseñas.</p>';
    for (const r of list) {
      const div = document.createElement("div");
      div.className = "card";
      const photo = r.photo ? `<img src="${r.photo}" alt="" style="width:46px;height:46px;border-radius:50%;object-fit:cover" />` : "";
      div.innerHTML = `<span style="display:flex;align-items:center;gap:10px;text-align:left">${photo}<span><b>${escHtml(r.name)}</b> <span class="muted">${"★".repeat(r.rating)}</span><br><span class="muted">${escHtml(r.text)}</span></span></span>`;
      const wrap = document.createElement("span");
      wrap.className = "row";
      if (isPending) {
        const ok = document.createElement("button");
        ok.textContent = "Aprobar";
        ok.addEventListener("click", () => reviewAction("approve", r.id));
        wrap.appendChild(ok);
      }
      const del = document.createElement("button");
      del.className = "danger";
      del.textContent = isPending ? "Rechazar" : "Quitar";
      del.addEventListener("click", () => reviewAction("reject", r.id, isPending));
      acciones.appendChild(del);
      div.appendChild(wrap);
      box.appendChild(div);
    }
  };
  renderInto("rv-pending", pending, true);
  renderInto("rv-approved", approved, false);
  RV_PEND = pending.length;
  renderHoy();
}

// --- Clientes del portal ---
async function loadCustomers() {
  let data;
  try { data = await api("&action=customers"); } catch { return; }
  applyCustomers(data.customers || []);
}

// Igual que en finanzas: tras escribir usamos la lista que el server ya tiene en
// memoria en vez de releer el blob (la relectura inmediata traía la copia vieja
// y por eso los cambios de clientes "no se guardaban").
function applyCustomers(list) {
  const box = $("customers");
  box.innerHTML = list.length ? "" : '<p class="muted">Sin clientes todavía.</p>';
  for (const c of list) {
    const refs = (c.credits || []).filter((x) => x.type === "referral").length;
    const resv = (c.reservations || []).length;
    const div = document.createElement("div");
    div.className = "card";
    const estado = [
      c.phone ? `📞 ${escHtml(c.phone)}` : null,
      c.reglamento ? `📜 reglamento aceptado ${fmtD((c.reglamento.at || "").slice(0, 10))}` : '<span style="opacity:.7">📜 sin aceptar reglamento</span>',
      c.ineVerificada ? `🪪 INE revisada ${fmtD(c.ineVerificada)}` : (c.ineUrl ? "🪪 INE en Drive, sin revisar" : null),
    ].filter(Boolean).join(" · ");
    div.innerHTML =
      `<span style="text-align:left"><b>${escHtml(c.name || "(sin nombre)")}</b> <span class="muted">${escHtml(c.email)}</span><br>` +
      `<span class="muted">🎟 ${escHtml(c.refCode || "—")} · 🌙 ${c.freeNights || 0} noches gratis · 👥 ${refs} referidos · 📅 ${resv} reservas</span>` +
      (estado ? `<br><span class="muted">${estado}</span>` : "") + `</span>`;
    const wrap = document.createElement("span");
    wrap.className = "row";
    const ficha = document.createElement("button");
    ficha.className = "quiet";
    ficha.textContent = "Ficha";
    ficha.addEventListener("click", () => abrirFicha(c));
    wrap.appendChild(ficha);
    const plus = document.createElement("button");
    plus.className = "quiet";
    plus.textContent = "+1 noche";
    plus.addEventListener("click", () => nightsAction(c.email, 1));
    wrap.appendChild(plus);
    if ((c.freeNights || 0) > 0) {
      const redeem = document.createElement("button");
      redeem.className = "quiet peligro";
      redeem.textContent = "Redimir 1";
      redeem.addEventListener("click", () => nightsAction(c.email, -1));
      wrap.appendChild(redeem);
    }
    div.appendChild(wrap);
    box.appendChild(div);
  }
}

// --- Finanzas ---
// Categorías agrupadas: con esta cantidad, una lista plana no se puede leer.
// Sin "Agua": va incluida en la cuota de mantenimiento del condominio.
const CATS = {
  in: [
    { grupo: "Huéspedes", cats: ["Reserva", "Extras del huésped"] },
    { grupo: "Otros", cats: ["Devolución", "Otro ingreso"] },
  ],
  out: [
    { grupo: "Condominio", cats: ["Cuota condominio", "Cuota extraordinaria"] },
    { grupo: "Servicios", cats: ["Luz", "Gas", "Internet"] },
    { grupo: "Huéspedes", cats: ["Recepción", "Limpieza", "Desayunos", "Ida al súper"] },
    { grupo: "Mantenimiento y reparaciones", cats: ["Electricidad", "Plomería", "Carpintería", "Pintura", "Aire acondicionado", "Cerrajería", "Jardinería", "Reparaciones"] },
    { grupo: "Mejoras y equipamiento", cats: ["Muebles", "Electrodomésticos", "Menaje de cocina", "Blancos y sábanas", "Decoración", "Mejoras al depa"] },
    { grupo: "Insumos", cats: ["Jabón y limpieza", "Papel y desechables", "Herramientas y ferretería"] },
    { grupo: "Otros", cats: ["Publicidad", "Comisiones", "Otro gasto"] },
  ],
};
const catsPlanas = (tipo) => CATS[tipo].flatMap((g) => g.cats);
const money = (n) => (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
// Versión corta para las barras de la gráfica: $24k, $7.9k, $640
function moneyCorto(n) {
  const v = Math.round(Number(n) || 0);
  if (v >= 1000) {
    const k = v / 1000;
    return "$" + (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")) + "k";
  }
  return "$" + v;
}
const MES_LBL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (ym) => `${MES_LBL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// `extra`: la categoría que ya trae un movimiento viejo. Si ya no está en la
// lista (se renombró o se quitó), se agrega arriba para no cambiársela sin
// querer al editarlo — pasó con "Insumos y blancos", que ya no existe.
function opcionesCat(tipo, extra) {
  const planas = catsPlanas(tipo);
  const grupos = CATS[tipo].map((g) =>
    `<optgroup label="${escHtml(g.grupo)}">` + g.cats.map((c) => `<option>${escHtml(c)}</option>`).join("") + "</optgroup>"
  ).join("");
  const e = String(extra || "").trim();
  return (e && !planas.includes(e) ? `<optgroup label="La que ya tenía"><option>${escHtml(e)}</option></optgroup>` : "") + grupos;
}

function fillCats(extra) {
  const type = $("f-type").value;
  $("f-cat").innerHTML = opcionesCat(type, extra);
  if (extra) $("f-cat").value = extra;
}

// Periodo elegido en el filtro: "YYYY" (año completo) o "YYYY-MM" (un mes)
let PERIODO = hoyMx().slice(0, 4);

function buildPeriodo(movs) {
  const box = $("periodo-sel");
  if (!box) return;
  const anios = [...new Set(movs.map((m) => m.date.slice(0, 4)))].sort().reverse();
  const yNow = hoyMx().slice(0, 4);
  if (!anios.includes(yNow)) anios.unshift(yNow);
  const opts = [];
  for (const y of anios) {
    opts.push(`<option value="${y}">Todo ${y}</option>`);
    const meses = [...new Set(movs.filter((m) => m.date.slice(0, 4) === y).map((m) => m.date.slice(0, 7)))].sort().reverse();
    for (const ym of meses) opts.push(`<option value="${ym}">${mesLabel(ym)}</option>`);
  }
  box.innerHTML = opts.join("");
  if (![...box.options].some((o) => o.value === PERIODO)) PERIODO = box.options[0] ? box.options[0].value : yNow;
  box.value = PERIODO;
}

function renderStats(movs) {
  const enPeriodo = (m) => m.date.startsWith(PERIODO);
  let ing = 0, gas = 0;
  for (const m of movs) if (enPeriodo(m)) { const v = Number(m.amount) || 0; if (m.type === "in") ing += v; else gas += v; }
  const util = ing - gas;
  const margen = ing > 0 ? Math.round((util / ing) * 100) : null;
  const noches = movs.filter((m) => enPeriodo(m) && m.type === "in" && m.category === "Reserva").length;
  const etiqueta = PERIODO.length === 4 ? `todo ${PERIODO}` : mesLabel(PERIODO);
  $("stats").innerHTML = `
    <div class="stat"><span class="lbl">Ocupación 12 meses</span><b>${OCC ? OCC.pct + "%" : "—"}</b><span class="muted">${OCC ? OCC.sold + " noches vendidas" : ""}</span></div>
    <div class="stat"><span class="lbl">Ingresos · ${etiqueta}</span><b class="pos">${money(ing)}</b></div>
    <div class="stat"><span class="lbl">Gastos · ${etiqueta}</span><b class="neg">${money(gas)}</b></div>
    <div class="stat"><span class="lbl">Utilidad · ${etiqueta}</span><b class="${util >= 0 ? "pos" : "neg"}">${money(util)}</b><span class="muted">${margen === null ? "" : margen + "% de margen"}</span></div>
    <div class="stat"><span class="lbl">Reservas cobradas</span><b>${noches}</b><span class="muted">${etiqueta}</span></div>`;
}

// Gráfica de barras: ingresos vs gastos, últimos 12 meses con movimiento
function renderChart(movs) {
  const svg = $("f-chart");
  if (!svg) return;
  const by = {};
  for (const m of movs) {
    const ym = m.date.slice(0, 7);
    by[ym] = by[ym] || { in: 0, out: 0 };
    by[ym][m.type] += Number(m.amount) || 0;
  }
  // Eje de tiempo CONTINUO: mes a mes, sin saltarse los vacíos. Antes se armaba
  // solo con los meses que tenían movimiento, así que un mes sin nada
  // desaparecía y marzo quedaba pegado a julio — la gráfica mentía sobre el
  // paso del tiempo, y un mes flojo se veía igual que un mes inexistente.
  const conDatos = Object.keys(by).sort();
  if (!conDatos.length) { svg.innerHTML = '<text x="10" y="24">Sin movimientos todavía.</text>'; return; }
  const hoyYm = hoyMx().slice(0, 7);
  const finYm = conDatos[conDatos.length - 1] > hoyYm ? conDatos[conDatos.length - 1] : hoyYm;
  const todos = [];
  let [ey, em] = conDatos[0].split("-").map(Number);
  for (let i = 0; i < 400; i++) { // tope de seguridad por si una fecha viene rota
    const ym = `${ey}-${String(em).padStart(2, "0")}`;
    todos.push(ym);
    if (ym >= finYm) break;
    if (++em > 12) { em = 1; ey++; }
  }
  const meses = todos.slice(-12);
  const dat = (ym) => by[ym] || { in: 0, out: 0 };
  const max = Math.max(...meses.map((ym) => Math.max(dat(ym).in, dat(ym).out)), 1);
  // Se deja aire arriba (alto útil menor) para que quepan las cifras sobre las barras
  const W = 720, H = 210, base = H - 26, alto = base - 26;
  const paso = W / meses.length, ancho = Math.min(16, paso / 3.2);
  let out = `<line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}" />`;
  meses.forEach((ym, i) => {
    const cx = i * paso + paso / 2;
    const d = dat(ym);
    const hi = (d.in / max) * alto, ho = (d.out / max) * alto;
    const xi = cx - ancho - 1.5, xo = cx + 1.5;
    out += `<rect class="gin"  x="${xi}" y="${base - hi}" width="${ancho}" height="${hi}" rx="2"><title>${mesLabel(ym)} · ingresos ${money(d.in)}</title></rect>`;
    out += `<rect class="gout" x="${xo}" y="${base - ho}" width="${ancho}" height="${ho}" rx="2"><title>${mesLabel(ym)} · gastos ${money(d.out)}</title></rect>`;
    // Un mes sin nada se marca con un punto en la base, para que se lea
    // "aquí no hubo movimiento" en vez de parecer que el mes no existe.
    if (!d.in && !d.out) out += `<circle class="vacio" cx="${cx}" cy="${base - 3}" r="1.6" />`;
    // Cifra sobre cada barra, abreviada para que quepan las 12 columnas
    if (d.in) out += `<text class="val gin" x="${xi + ancho / 2}" y="${base - hi - 4}" text-anchor="middle">${moneyCorto(d.in)}</text>`;
    if (d.out) out += `<text class="val gout" x="${xo + ancho / 2}" y="${base - ho - 4}" text-anchor="middle">${moneyCorto(d.out)}</text>`;
    out += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${mesLabel(ym).replace(" ", "'")}</text>`;
  });
  svg.innerHTML = out;
}

function renderFinance(movs) {
  buildPeriodo(movs);
  renderStats(movs);
  renderChart(movs);
  renderGuests(movs);
  renderPlataformas();
  renderPagadores(movs);
  fillGuestList(movs);

  // Resumen mensual (últimos 13 meses con movimiento)
  const byMonth = {};
  for (const m of movs) {
    const ym = m.date.slice(0, 7);
    byMonth[ym] = byMonth[ym] || { in: 0, out: 0 };
    byMonth[ym][m.type] += Number(m.amount) || 0;
  }
  const meses = Object.keys(byMonth).sort().reverse().slice(0, 13);
  $("f-summary").innerHTML = meses.length
    ? `<table class="fin"><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Utilidad</th></tr>` +
      meses.map((ym) => {
        const r = byMonth[ym], u = r.in - r.out;
        return `<tr><td>${mesLabel(ym)}</td><td class="pos">${money(r.in)}</td><td class="neg">${money(r.out)}</td><td class="${u >= 0 ? "pos" : "neg"}"><b>${money(u)}</b></td></tr>`;
      }).join("") + `</table>`
    : '<p class="muted">Sin movimientos todavía. Agrega el primero arriba ☝️</p>';

  // Movimientos: renglones finos, no burbujas. Se muestran 25 y el resto se
  // despliega bajo demanda, para que la lista no crezca sin control.
  const box = $("f-movs");
  box.innerHTML = "";
  box.className = "lista";
  const TOPE = 25;
  const verTodos = box.dataset.todos === "1";
  const visibles = verTodos ? movs : movs.slice(0, TOPE);
  for (const m of visibles) {
    const div = document.createElement("div");
    div.className = "fila";
    div.innerHTML = `<span style="text-align:left"><span class="tag ${m.type}">${m.type === "in" ? "INGRESO" : "GASTO"}</span>` +
      `<b>${escHtml(m.concept)}</b> <span class="muted">· ${fmtD(m.date)} · ${escHtml(m.category || "")}${m.guest ? " · 👤 " + escHtml(m.guest) : ""}${m.payer ? " · 💳 pagó " + escHtml(m.payer) : ""}</span></span>` +
      `<span class="row"><b class="${m.type === "in" ? "pos" : "neg"}">${m.type === "in" ? "+" : "−"}${money(m.amount)}</b></span>`;
    // Acciones calladas: antes eran tres botones de color en cada fila y el
    // listado parecía un tablero de botones. Ahora el monto manda.
    const wrap = div.querySelector(".row");
    const acciones = document.createElement("span");
    acciones.className = "row acciones";
    const ed = document.createElement("button");
    ed.className = "quiet";
    ed.textContent = "Editar";
    ed.setAttribute("aria-label", `Editar ${m.concept}`);
    ed.addEventListener("click", () => startEditMov(m));
    acciones.appendChild(ed);
    const dup = document.createElement("button");
    dup.className = "quiet";
    dup.textContent = "Repetir";
    dup.title = "Repite este movimiento con fecha de hoy (útil para gastos mensuales)";
    dup.setAttribute("aria-label", `Repetir ${m.concept} con fecha de hoy`);
    dup.addEventListener("click", () => duplicateMov(m));
    acciones.appendChild(dup);
    const del = document.createElement("button");
    del.className = "quiet peligro";
    del.textContent = "Borrar";
    del.setAttribute("aria-label", `Borrar ${m.concept}`);
    del.addEventListener("click", () => deleteMov(m));
    acciones.appendChild(del);
    wrap.appendChild(acciones);
    box.appendChild(div);
  }
  if (!verTodos && movs.length > TOPE) {
    const b2 = document.createElement("button");
    b2.className = "vermas";
    b2.textContent = `Ver los ${movs.length - TOPE} movimientos restantes`;
    b2.addEventListener("click", () => { box.dataset.todos = "1"; renderFinance(FIN); });
    box.appendChild(b2);
  } else if (verTodos && movs.length > TOPE) {
    const b2 = document.createElement("button");
    b2.className = "vermas";
    b2.textContent = "Mostrar solo los últimos 25";
    b2.addEventListener("click", () => { box.dataset.todos = "0"; renderFinance(FIN); });
    box.appendChild(b2);
  }
}

// Sugerencias de huésped: los nombres de las reservas + los ya usados en movimientos
function fillGuestList(movs) {
  const dl = $("guestlist");
  if (!dl) return;
  const nombres = new Set();
  for (const b of todasReservas()) if (b.name) nombres.add(b.name);
  for (const m of movs) if (m.guest) nombres.add(m.guest);
  dl.innerHTML = [...nombres].sort().map((n) => `<option value="${escHtml(n)}"></option>`).join("");
  // Sugerencias de "quién pagó": los que ya se usaron antes, para no reescribirlos
  const dp = $("payerlist");
  if (dp) {
    const quienes = new Set();
    for (const m of movs) if (m.payer) quienes.add(m.payer);
    dp.innerHTML = [...quienes].sort().map((n) => `<option value="${escHtml(n)}"></option>`).join("");
  }
}

// Cuánto se queda cada plataforma. Sale de las reservas donde capturaste los dos
// montos: lo que pagó el huésped y lo que te depositaron.
function renderPlataformas() {
  const box = $("plataformas");
  if (!box) return;
  const conDatos = [...BLOCKS, ...PASADAS].map((b) => ({ b, d: desglosar(b) })).filter((x) => x.d);
  if (!conDatos.length) {
    box.innerHTML = '<p class="muted">Todavía no capturas los montos de ninguna reserva de plataforma. ' +
      'Ve a Calendario → Todas las fechas ocupadas → "Poner nombre" y llena lo que pagó el huésped y lo que te depositaron.</p>';
    return;
  }
  let tp = 0, ta = 0, tg = 0, tn = 0;
  const filas = conDatos.sort((x, y) => y.b.start.localeCompare(x.b.start)).map(({ b, d }) => {
    tp += d.pagoHuesped; ta += d.airbnb; tg += d.gobierno; tn += d.neto;
    return `<tr><td class="g"><b>${escHtml(quienDe(b))}</b><br><span class="muted">${fmtD(b.start)} · ${escHtml(b.plataforma || (b.source === "airbnb" ? "Airbnb" : "directa"))}</span></td>` +
      `<td>${money(d.pagoHuesped)}</td>` +
      `<td class="neg">${money(d.airbnb)}<br><span class="muted">${Math.round((d.airbnb / d.pagoHuesped) * 100)}%</span></td>` +
      `<td>${money(d.gobierno)}</td>` +
      `<td class="pos"><b>${money(d.neto)}</b></td></tr>`;
  }).join("");
  box.innerHTML = `<table class="fin"><tr><th>Reserva</th><th>Pagó el huésped</th><th>Plataforma</th><th>Impuestos</th><th>Te llegó</th></tr>${filas}` +
    `<tr><td class="g"><b>Total</b></td><td><b>${money(tp)}</b></td>` +
    `<td class="neg"><b>${money(ta)}</b><br><span class="muted">${tp ? Math.round((ta / tp) * 100) : 0}%</span></td>` +
    `<td><b>${money(tg)}</b></td><td class="pos"><b>${money(tn)}</b></td></tr></table>` +
    '<p class="muted" style="margin-top:.6rem">Los impuestos de ocupación y las retenciones de ISR e IVA no se los queda la plataforma: van al gobierno y los pagarías igual con reserva directa.</p>';
}

// Quién puso el dinero: cuánto adelantó cada quien en gastos y cuánto cobró.
// Sirve para saldar entre Lau, Ro y Bi — la utilidad del depa no cambia.
function renderPagadores(movs) {
  const box = $("pagadores");
  if (!box) return;
  const by = {};
  for (const m of movs) {
    const p = (m.payer || "").trim();
    if (!p) continue;
    by[p] = by[p] || { puso: 0, cobro: 0, n: 0 };
    if (m.type === "out") by[p].puso += Number(m.amount) || 0;
    else by[p].cobro += Number(m.amount) || 0;
    by[p].n++;
  }
  const nombres = Object.keys(by).sort();
  if (!nombres.length) {
    box.innerHTML = '<p class="muted">Todavía ningún movimiento dice quién pagó. ' +
      'Al registrar un gasto llena el campo “Quién pagó” y aquí aparece el saldo de cada quien.</p>';
    return;
  }
  const sinEtiqueta = movs.filter((m) => !(m.payer || "").trim()).length;
  let tp = 0, tc = 0;
  const filas = nombres.map((n) => {
    const x = by[n];
    tp += x.puso; tc += x.cobro;
    const saldo = x.puso - x.cobro;
    return `<tr><td class="g"><b>${escHtml(n)}</b><br><span class="muted">${x.n} movimiento${x.n === 1 ? "" : "s"}</span></td>` +
      `<td class="neg">${money(x.puso)}</td><td class="pos">${money(x.cobro)}</td>` +
      `<td class="${saldo > 0 ? "pos" : saldo < 0 ? "neg" : ""}"><b>${saldo > 0 ? "le deben " : saldo < 0 ? "debe " : ""}${money(Math.abs(saldo))}</b></td></tr>`;
  }).join("");
  box.innerHTML = `<table class="fin"><tr><th>Quién</th><th>Puso en gastos</th><th>Cobró</th><th>Saldo</th></tr>${filas}` +
    `<tr><td class="g"><b>Total</b></td><td class="neg"><b>${money(tp)}</b></td><td class="pos"><b>${money(tc)}</b></td><td></td></tr></table>` +
    (sinEtiqueta ? `<p class="muted" style="margin-top:.6rem">⚠️ ${sinEtiqueta} movimiento${sinEtiqueta === 1 ? "" : "s"} sin “quién pagó”, así que no ${sinEtiqueta === 1 ? "entra" : "entran"} en esta cuenta.</p>` : "");
}

// Cuánto pagó y cuánto costó cada huésped
function renderGuests(movs) {
  const box = $("guest-table");
  if (!box) return;
  const by = {};
  // Siembra con TODOS los huéspedes que tienen reserva (vigente o pasada). Antes
  // solo salían los que tuvieran movimientos etiquetados, así que un huésped al
  // que aún no se le registraba nada no existía en esta tabla.
  for (const bl of [...BLOCKS, ...PASADAS]) {
    const g = (bl.name || "").trim();
    if (!g) continue;
    by[g] = by[g] || { in: 0, out: 0, n: 0, ultima: "", soloReserva: true };
    if (bl.start > by[g].ultima) by[g].ultima = bl.start;
  }
  for (const m of movs) {
    const g = (m.guest || "").trim();
    if (!g) continue;
    by[g] = by[g] || { in: 0, out: 0, n: 0, ultima: "" };
    by[g][m.type] += Number(m.amount) || 0;
    by[g].n++;
    by[g].soloReserva = false;
    if (m.date > by[g].ultima) by[g].ultima = m.date;
  }
  const nombres = Object.keys(by).sort((a, b) => by[b].ultima.localeCompare(by[a].ultima));
  if (!nombres.length) {
    box.innerHTML = '<p class="muted">Aquí sale cada huésped con lo que pagó y lo que costó atenderlo. Se arma con las reservas que tienen nombre y con los movimientos donde llenas el campo "Huésped".</p>';
    return;
  }
  let tot = { in: 0, out: 0 };
  const filas = nombres.map((g) => {
    const r = by[g], u = r.in - r.out;
    tot.in += r.in; tot.out += r.out;
    const detalle = r.soloReserva ? "sin movimientos a su nombre todavía" : `${r.n} movimiento${r.n === 1 ? "" : "s"}`;
    return `<tr><td class="g"><b>${escHtml(g)}</b><br><span class="muted">${fmtD(r.ultima)} · ${detalle}</span></td>` +
      `<td class="pos">${money(r.in)}</td><td class="neg">${money(r.out)}</td>` +
      `<td class="${u >= 0 ? "pos" : "neg"}"><b>${money(u)}</b></td></tr>`;
  }).join("");
  const utot = tot.in - tot.out;
  box.innerHTML = `<table class="fin"><tr><th>Huésped</th><th>Pagó</th><th>Costó</th><th>Dejó</th></tr>${filas}` +
    `<tr><td class="g"><b>Total</b></td><td class="pos"><b>${money(tot.in)}</b></td><td class="neg"><b>${money(tot.out)}</b></td>` +
    `<td class="${utot >= 0 ? "pos" : "neg"}"><b>${money(utot)}</b></td></tr></table>`;
}

// Estado local de finanzas: tras escribir usamos la lista que el server ya tiene
// en memoria (viene en la respuesta) en vez de releer el blob — así evitamos el
// read-after-write stale que hacía "desaparecer" el movimiento recién creado.
let FIN = [];
function applyFinance(movs) { FIN = Array.isArray(movs) ? movs : []; renderFinance(FIN); renderRecurring(); renderHoy(); }

async function loadFinance() {
  try {
    const data = await api("&action=finance-list");
    applyFinance(data.movs || []);
  } catch { /* si falla, el resto del panel sigue */ }
}

async function financeAdd(params) {
  const qs = Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const r = await api("&action=finance-add" + qs);
  if (!r.ok) throw new Error(r.error);
  return r;
}

// ---- Capturar un gasto desde la foto del ticket ----
// El modelo lee la foto y propone monto, fecha, comercio y categoría; el panel
// prellena el formulario y marca lo dudoso. NO guarda solo: son finanzas reales
// y un OCR se equivoca, así que el último paso siempre es humano.

// La foto se encoge antes de subirla: un ticket se lee perfecto a 1600 px y así
// no viaja una foto de 4 MB ni se pagan tokens de más.
// ⚠️ `imageOrientation:"from-image"` respeta el EXIF — sin eso las fotos de
// iPhone llegan giradas y el modelo lee mucho peor (ya nos pasó con el comedor).
async function fotoABase64(file, maxLado = 1600) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bmp = await createImageBitmap(file); }
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * escala)), h = Math.max(1, Math.round(bmp.height * escala));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return cv.toDataURL("image/jpeg", 0.85).split(",")[1];
}

let ticketBusy = false;
async function leerTicket(file) {
  if (ticketBusy || !file) return;
  ticketBusy = true;
  const btn = $("f-ticket");
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = "Leyendo…"; }
  msg("Leyendo el ticket…");
  try {
    const image = await fotoABase64(file);
    const r = await apiPost("&action=ticket-read", { image, mime: "image/jpeg", categorias: catsPlanas("out") });
    if (!r.ok) { msg(r.error || "No se pudo leer el ticket.", false); return; }
    aplicarTicket(r.datos || {});
  } catch (e) {
    msg("No se pudo leer el ticket: " + e.message, false);
  } finally {
    ticketBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.txt || "📷 Leer un ticket"; }
  }
}

// Vuelca lo leído en el formulario y marca lo que hay que revisar
function aplicarTicket(d) {
  $("f-type").value = "out";
  // Solo se acepta una categoría que EXISTA. Si el modelo inventa una, fillCats
  // la agregaría como "La que ya tenía" (eso está pensado para movimientos
  // viejos) y se colaría una categoría falsa a las finanzas.
  const cat = catsPlanas("out").includes(d.categoria || "") ? d.categoria : "";
  fillCats(cat);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || "")) $("f-date").value = d.fecha;
  const monto = parseFloat(String(d.monto || "").replace(/[^\d.]/g, ""));
  if (monto > 0) $("f-amount").value = monto;
  const concepto = [d.concepto, d.comercio].filter(Boolean).join(" · ").trim().slice(0, 120);
  if (concepto) $("f-concept").value = concepto;

  // Lo que quedó vacío o que el modelo leyó con dudas se marca y se enumera:
  // la idea es que revises esos campos, no que confíes en el OCR a ciegas.
  const dudas = Array.isArray(d.dudas) ? d.dudas.map((x) => String(x).toLowerCase()) : [];
  const campos = [
    { id: "f-amount", nombre: "el monto", vacio: !(monto > 0), clave: "monto" },
    { id: "f-date", nombre: "la fecha", vacio: !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || ""), clave: "fecha" },
    { id: "f-concept", nombre: "el concepto", vacio: !concepto, clave: "concepto" },
    // Ojo: el <select> nunca está "vacío" — si no le pones valor se queda en la
    // primera opción. Hay que preguntarle al modelo, no al control.
    { id: "f-cat", nombre: "la categoría", vacio: !cat, clave: "categoria" },
  ];
  const revisar = [];
  for (const c of campos) {
    const el = $(c.id);
    if (!el) continue;
    const dudoso = c.vacio || dudas.some((x) => x.includes(c.clave));
    el.classList.toggle("revisar", dudoso);
    if (dudoso) revisar.push(c.nombre);
  }
  msg(revisar.length
    ? `Ticket leído. Revisa ${revisar.join(", ")} antes de guardar.`
    : "Ticket leído. Revisa que todo cuadre y guarda.");
}

// Edición de un movimiento: reusa el mismo formulario de alta
let EDIT_MOV = null;
function startEditMov(m) {
  EDIT_MOV = m.id;
  $("f-type").value = m.type; fillCats(m.category || "");
  $("f-date").value = m.date;
  $("f-concept").value = m.concept || "";
  $("f-guest").value = m.guest || "";
  $("f-payer").value = m.payer || "";
  $("f-amount").value = m.amount;
  $("mov-title").textContent = "Editar movimiento";
  $("f-add").textContent = "Guardar cambios";
  $("f-cancel").classList.remove("hidden");
  abrir("dlg-mov");
  $("f-concept").focus();
}

// Abre la ventana en blanco para capturar un ingreso o un gasto
function nuevoMov() {
  resetMovForm();
  $("mov-title").textContent = "Registrar movimiento";
  abrir("dlg-mov");
  $("f-concept").focus();
}

function resetMovForm() {
  EDIT_MOV = null;
  $("f-concept").value = ""; $("f-amount").value = ""; $("f-guest").value = ""; $("f-payer").value = "";
  // Quita las marcas de "revisa esto" que hubiera dejado la lectura de un ticket
  ["f-amount", "f-date", "f-concept", "f-cat"].forEach((id) => { const e = $(id); if (e) e.classList.remove("revisar"); });
  const ft = $("f-ticket-file"); if (ft) ft.value = "";
  $("f-date").value = hoyMx();
  $("mov-title").textContent = "Registrar movimiento";
  $("f-add").textContent = "Guardar";
  $("f-cancel").classList.add("hidden");
}

// Candado anti-doble-click: el put del blob tarda; sin esto el usuario re-clickea
// y se crean movimientos duplicados (o se pisan escrituras).
let finBusy = false;
async function addMovFromForm() {
  if (finBusy) return;
  const type = $("f-type").value, date = $("f-date").value, concept = $("f-concept").value.trim();
  const category = $("f-cat").value, amount = parseFloat($("f-amount").value);
  const guest = $("f-guest").value.trim();
  const payer = $("f-payer").value.trim();
  if (!date || !concept || !(amount > 0)) return msg("Faltan datos: fecha, concepto y monto.", false);
  const btn = $("f-add");
  finBusy = true;
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = "Guardando…"; }
  try {
    if (EDIT_MOV) {
      const qs = Object.entries({ id: EDIT_MOV, type, date, concept, category, guest, payer, amount })
        .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
      const r = await api("&action=finance-update" + qs);
      if (!r.ok) throw new Error(r.error);
      applyFinance(r.movs || FIN);
      msg("Movimiento actualizado ✅");
    } else {
      const r = await financeAdd({ type, date, concept, category, guest, payer, amount });
      applyFinance(r.movs || FIN.concat(r.mov));
      msg(type === "in" ? "Ingreso registrado ✅" : "Gasto registrado ✅");
    }
    resetMovForm();
    cerrar("dlg-mov"); // guardado = la ventana ya cumplió; cancelar edición no la cierra
  } catch { msg("Error al guardar el movimiento.", false); }
  finally {
    finBusy = false;
    if (btn) { btn.disabled = false; if (btn.dataset.txt) btn.textContent = btn.dataset.txt; }
  }
}

async function quickIncome(b) {
  const nights = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
  const sugerido = b.rate ? String(Math.round(b.rate * nights)) : "";
  const monto = prompt(`Monto cobrado por la reserva ${fmtD(b.start)} → ${fmtD(b.end)}${b.name ? ` de ${b.name}` : ""} (MXN):`, sugerido);
  const amount = parseFloat(String(monto || "").replace(/[$,\s]/g, ""));
  if (!(amount > 0)) return;
  try {
    const r = await financeAdd({ type: "in", date: b.start, concept: `Reserva ${b.name || "directa"} ${b.start} → ${b.end}`, category: "Reserva", amount });
    applyFinance(r.movs || FIN.concat(r.mov));
    msg("Ingreso de la reserva registrado ✅");
  } catch { msg("Error al registrar el ingreso.", false); }
}

async function duplicateMov(m) {
  const hoy = hoyMx();
  if (!confirm(`¿Repetir "${m.concept}" (${money(m.amount)}) con fecha de hoy?`)) return;
  try {
    const r = await financeAdd({ type: m.type, date: hoy, concept: m.concept, category: m.category || "", amount: m.amount });
    applyFinance(r.movs || FIN.concat(r.mov));
    msg("Movimiento duplicado ✅");
  } catch { msg("Error al duplicar.", false); }
}

async function deleteMov(m) {
  if (!confirm(`¿Eliminar "${m.concept}" (${money(m.amount)})?`)) return;
  try {
    const r = await api(`&action=finance-del&id=${encodeURIComponent(m.id)}`);
    if (!r.ok) throw new Error(r.error);
    applyFinance(r.movs || FIN.filter((x) => x.id !== m.id));
    msg("Movimiento eliminado 🗑️");
  } catch { msg("Error al eliminar.", false); }
}

// --- Gastos recurrentes y avisos por confirmar ---
let RECUR = [];

async function loadRecurring() {
  try {
    const d = await api("&action=recurring-list");
    RECUR = d.recurring || [];
    renderRecurring();
    renderHoy();
  } catch { /* el resto del panel sigue */ }
}

const mesAnteriorYm = () => { const [y, m] = hoyMx().split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
const ultimoDiaDe = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };

// Monto sugerido para un cobro variable: lo último que se pagó por ese concepto.
// El gas ronda los $80 sin huéspedes, pero sube con la ocupación y el uso de la
// cocina, así que proponer el último real es más útil que un fijo.
function sugeridoPara(r) {
  const base = (r.concept || "").trim().toLowerCase();
  if (!base) return r.amount;
  const previos = FIN
    .filter((m) => (m.concept || "").trim().toLowerCase().startsWith(base))
    .sort((a, b) => b.date.localeCompare(a.date));
  return previos.length ? (Number(previos[0].amount) || r.amount) : r.amount;
}

// Qué se le propone al confirmar un recurrente.
// `periodoAnterior`: el cobro es el consumo del mes pasado (el gas se factura al
// cierre y a veces llega a inicios del siguiente). Se pide a inicios de mes, se
// fecha al último día del mes anterior y el concepto lleva el periodo, para no
// confundir el gas de julio con el de agosto.
const normC = (s) => String(s || "").trim().toLowerCase();
const mesesEntre = (a, b) => {
  const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};
// Movimientos que pertenecen a un recurrente: el concepto exacto, o el mismo con
// el periodo pegado ("Luz — 05-may-2026 a 07-jul-2026"). Se compara así y no con
// "empieza con" para que "Gas" no se lleve por delante a "Gasolina".
function movsDe(r) {
  const base = normC(r.concept);
  return FIN.filter((m) => { const c = normC(m.concept); return c === base || c.startsWith(base + " —"); })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Periodo que cubre el recibo: cierra al final del mes pasado y abarca tantos
// meses como diga la frecuencia (la luz de CFE es bimestral).
function periodoDe(r) {
  const prev = mesAnteriorYm();
  const hasta = ultimoDiaDe(prev);
  const d = new Date(prev + "-01T12:00:00");
  d.setMonth(d.getMonth() - ((r.cadaMeses || 1) - 1));
  return { desde: d.toISOString().slice(0, 10), hasta };
}

function datosPendiente(r) {
  const cada = r.cadaMeses || 1;
  // Recibo que cubre varios meses (luz bimestral): las fechas reales no cuadran
  // con meses de calendario (la última fue del 5-may al 7-jul), así que se
  // proponen y Rodrigo las corrige al confirmar.
  if (cada > 1) {
    const p = periodoDe(r);
    return { r, cada, variable: true, rango: p, date: p.hasta,
      concept: `${r.concept} — ${fmtD(p.desde)} a ${fmtD(p.hasta)}`,
      periodo: `${fmtD(p.desde)} a ${fmtD(p.hasta)}` };
  }
  if (r.periodoAnterior) {
    const prev = mesAnteriorYm();
    return { r, cada, variable: true, date: ultimoDiaDe(prev),
      concept: `${r.concept} — ${mesLabel(prev)}`, periodo: mesLabel(prev) };
  }
  const ym = hoyMx().slice(0, 7);
  return { r, cada, variable: false, date: `${ym}-${String(r.day).padStart(2, "0")}`, concept: r.concept, periodo: null };
}

// Un recurrente está "pendiente" si está activo y todavía no se registró.
function pendientesDelMes() {
  const hoyDs = hoyMx();
  const ym = hoyDs.slice(0, 7);
  const esteMes = new Set(FIN.filter((m) => m.date.slice(0, 7) === ym).map((m) => normC(m.concept)));
  const enTodo = new Set(FIN.map((m) => normC(m.concept)));
  return RECUR.filter((r) => r.activo).map(datosPendiente).filter((x) => {
    // Cada varios meses: toca cuando el último registrado ya tiene esa
    // antigüedad. Se mide por fecha y no por concepto, porque el periodo se
    // edita al confirmar y el texto deja de coincidir.
    if (x.cada > 1) {
      const ult = movsDe(x.r)[0];
      return !ult || mesesEntre(ult.date, hoyDs) >= x.cada;
    }
    // Los de mes anterior van fechados en el mes pasado; buscarlos solo en el
    // mes en curso los volvería a pedir para siempre.
    if (x.variable) return !enTodo.has(normC(x.concept));
    return !esteMes.has(normC(x.concept));
  });
}

// Recepción y limpieza de cada reserva, listas para confirmar (monto editable)
function renderResPend() {
  const box = $("res-pending");
  if (!box) return;
  const pend = pendientesDeReservas();
  box.innerHTML = "";
  if (!pend.length) {
    box.innerHTML = '<div class="vacio"><b>Nada por confirmar</b>Las recepciones y limpiezas de las reservas recientes ya están registradas.</div>';
    return;
  }
  const total = pend.reduce((a, r) => a + r.amount, 0);
  box.insertAdjacentHTML("beforeend",
    `<p class="muted">${pend.length} por registrar · ${money(total)} en total</p>`);
  for (const it of pend) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<span style="text-align:left"><span class="tag out">${it.etiqueta.toUpperCase()}</span>` +
      `<b>${escHtml(quienDe(it.b))}</b> <span class="muted">· ${fmtD(it.date)}` +
      `${it.futuro ? " · aún no pasa" : ""}${it.b.source === "airbnb" ? " · Airbnb" : ""}</span></span>`;
    const wrap = document.createElement("span");
    wrap.className = "row";
    const amt = document.createElement("input");
    amt.type = "number"; amt.step = "0.01"; amt.min = "0"; amt.value = it.amount;
    amt.style.width = "105px";
    amt.setAttribute("aria-label", `Monto de ${it.etiqueta} de ${quienDe(it.b)}`);
    const ok = document.createElement("button");
    ok.textContent = "Confirmar";
    ok.addEventListener("click", () => confirmarCostoReserva(it, parseFloat(amt.value), ok));
    wrap.append(amt, ok);
    div.appendChild(wrap);
    box.appendChild(div);
  }
}

async function confirmarCostoReserva(it, amount, btn) {
  if (!(amount > 0)) return msg("Revisa el monto.", false);
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
  try {
    const res = await financeAdd({
      type: "out", date: it.date, concept: it.concept,
      category: it.categoria, amount, guest: it.b.name || "",
    });
    applyFinance(res.movs || FIN.concat(res.mov));
    msg(`${it.etiqueta} de ${quienDe(it.b)} registrada ✅`);
  } catch {
    msg("Error al registrar el gasto.", false);
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar"; }
  }
}

// ¿Cuánto cuesta HOY este recurrente? Si tiene pronto pago y ya se pasó el día
// límite, cuesta el monto con recargo.
function montoHoy(r, diaRef) {
  const dia = diaRef || Number(hoyMx().slice(8, 10));
  if (r.dayLimit && r.amountLate && dia > r.dayLimit) {
    return { monto: r.amountLate, tarde: true, faltan: 0 };
  }
  if (r.dayLimit && r.amountLate) {
    return { monto: r.amount, tarde: false, faltan: r.dayLimit - dia };
  }
  return { monto: r.amount, tarde: false, faltan: null };
}

// Qué le va a costar hoy, dicho como se lo diría una persona.
function textoProntoPago(r) {
  if (!r.dayLimit || !r.amountLate) return "";
  const { tarde, faltan } = montoHoy(r);
  if (tarde) return `Pagando hoy son ${money(r.amountLate)}: el precio de ${money(r.amount)} vencía el día ${r.dayLimit}.`;
  if (faltan === 0) return `Hoy es el último día a ${money(r.amount)}. Mañana sube a ${money(r.amountLate)}.`;
  return `Pagando hoy son ${money(r.amount)}. Te quedan ${faltan} día${faltan === 1 ? "" : "s"} antes de que suba a ${money(r.amountLate)}.`;
}

// Cómo se cobra, para la lista de "todos": "$3,900 al mes, el día 1"
function comoSeCobra(r) {
  const cada = r.cadaMeses || 1;
  const frec = cada === 1 ? "al mes" : cada === 12 ? "al año" : `cada ${cada} meses`;
  if (r.periodoAnterior) return `${money(r.amount)} aprox. ${frec} · monto variable, es el consumo del mes anterior`;
  const base = `${money(r.amount)} ${frec}, el día ${r.day}`;
  return r.dayLimit && r.amountLate ? `${base} · después del día ${r.dayLimit} sube a ${money(r.amountLate)}` : base;
}

// Etiqueta del periodo que se está pagando: "julio 2026"
const periodoActual = () => mesLabel(hoyMx().slice(0, 7));

// Lo que se propone cobrar: si el monto cambia cada mes (gas), el último real;
// si tiene pronto pago, el que toque según el día.
const montoPropuesto = (x) => (x.variable ? sugeridoPara(x.r) : montoHoy(x.r).monto);

function renderRecurring() {
  renderResPend();
  const pend = pendientesDelMes();
  const bp = $("r-pending");
  if (bp) {
    const total = pend.reduce((a, x) => a + montoPropuesto(x), 0);
    bp.innerHTML = pend.length
      ? `<p class="muted">Te faltan <b>${pend.length}</b> por registrar · ${money(total)} en total. Revisa el monto, ajústalo si hace falta y confirma: hasta entonces no se guarda nada.</p>`
      : '<div class="vacio"><b>Nada pendiente</b>Ya registraste todo lo que se repite en este periodo.</div>';
    for (const x of pend) {
      const r = x.r;
      const div = document.createElement("div");
      const pp = montoHoy(r);
      const aviso = x.variable ? "" : textoProntoPago(r);
      div.className = "card" + (!x.variable && (pp.tarde || pp.faltan === 0) ? " urgente" : "");
      // Título: qué es y de qué periodo. Debajo, en una frase, qué cuesta hoy.
      const titulo = x.variable ? x.concept : `${r.concept} — ${periodoActual()}`;
      const explica = x.variable
        ? (x.rango
            ? `El monto y las fechas los pone el recibo. Se propone ${money(montoPropuesto(x))}, que fue lo último que pagaste.`
            : `El monto cambia cada mes. Se propone ${money(montoPropuesto(x))}, que fue lo último que pagaste; corrígelo con el recibo.`)
        : aviso;
      div.innerHTML = `<span style="text-align:left"><span class="tag ${r.type}">${r.type === "in" ? "INGRESO" : "GASTO"}</span>` +
        `<b>${escHtml(titulo)}</b>` +
        (explica ? `<br><span class="${!x.variable && (pp.tarde || pp.faltan === 0) ? "aviso-pp" : "muted"}">${escHtml(explica)}</span>` : "") +
        `</span>`;
      const wrap = document.createElement("span");
      wrap.className = "row";
      const amt = document.createElement("input");
      amt.type = "number"; amt.step = "0.01"; amt.min = "0"; amt.value = montoPropuesto(x); amt.style.width = "105px";
      amt.title = "Puedes cambiar el monto antes de confirmar";
      amt.setAttribute("aria-label", `Monto de ${x.concept}`);
      wrap.insertAdjacentHTML("beforeend", '<span class="muted campo">Monto</span>');
      // Recibo de varios meses: se capturan las fechas reales que trae el recibo
      let desde = null, hasta = null;
      if (x.rango) {
        desde = document.createElement("input");
        desde.type = "date"; desde.value = x.rango.desde;
        desde.title = "Desde qué día cubre el recibo";
        desde.setAttribute("aria-label", `Inicio del periodo de ${r.concept}`);
        hasta = document.createElement("input");
        hasta.type = "date"; hasta.value = x.rango.hasta;
        hasta.title = "Hasta qué día cubre el recibo";
        hasta.setAttribute("aria-label", `Fin del periodo de ${r.concept}`);
        wrap.insertAdjacentHTML("beforeend", '<span class="muted campo">Del</span>');
        wrap.append(desde);
        wrap.insertAdjacentHTML("beforeend", '<span class="muted campo">al</span>');
        wrap.append(hasta);
      }
      const dt = document.createElement("input");
      dt.type = "date"; dt.value = x.date; dt.title = "Fecha con la que se guarda el gasto";
      dt.setAttribute("aria-label", `Fecha de ${x.concept}`);
      const etqFecha = document.createElement("span");
      etqFecha.className = "muted campo";
      etqFecha.textContent = "Fecha";
      const ok = document.createElement("button");
      ok.textContent = "Confirmar";
      ok.addEventListener("click", () => {
        // Si cambió el periodo, el concepto se rearma con las fechas reales
        const conPeriodo = desde && hasta && desde.value && hasta.value
          ? { ...x, concept: `${r.concept} — ${fmtD(desde.value)} a ${fmtD(hasta.value)}` }
          : x;
        confirmRecurring(conPeriodo, parseFloat(amt.value), dt.value, ok);
      });
      wrap.append(amt, etqFecha, dt, ok);
      div.appendChild(wrap);
      bp.appendChild(div);
    }
  }

  const bl = $("r-list");
  if (!bl) return;
  bl.innerHTML = RECUR.length ? "" : '<p class="muted">Sin recurrentes. Da de alta el primero arriba ☝️</p>';
  for (const r of RECUR) {
    const div = document.createElement("div");
    div.className = "card";
    // La categoría solo se muestra si aporta algo (a veces es igual al concepto)
    const cat = (r.category || "").trim();
    const catTxt = cat && cat.toLowerCase() !== (r.concept || "").trim().toLowerCase() ? ` · ${escHtml(cat)}` : "";
    div.innerHTML = `<span style="text-align:left"><b>${escHtml(r.concept)}</b>${r.activo ? "" : ' <span class="muted">· ⏸ pausado</span>'}` +
      `<br><span class="muted">${escHtml(comoSeCobra(r))}${catTxt}</span></span>`;
    const wrap = document.createElement("span");
    wrap.className = "row";
    const ed = document.createElement("button");
    ed.className = "quiet";
    ed.textContent = "Editar";
    ed.addEventListener("click", () => editarRecurrente(r));
    const tg = document.createElement("button");
    tg.className = "quiet";
    tg.textContent = r.activo ? "Pausar" : "Reactivar";
    tg.addEventListener("click", () => recurringAction("toggle", r.id));
    const del = document.createElement("button");
    del.className = "quiet peligro";
    del.textContent = "Borrar";
    del.addEventListener("click", () => recurringAction("del", r.id, r.concept));
    wrap.append(ed, tg, del);
    div.appendChild(wrap);
    bl.appendChild(div);
  }
}

async function confirmRecurring(x, amount, date, btn) {
  const r = x.r;
  if (!(amount > 0) || !date) return msg("Revisa el monto y la fecha.", false);
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
  try {
    // Se guarda con el concepto que incluye el periodo (ej. "Gas — jul 2026"),
    // que es justo lo que después evita que se vuelva a pedir.
    const res = await financeAdd({ type: r.type, date, concept: x.concept, category: r.category || "", amount });
    applyFinance(res.movs || FIN.concat(res.mov));
    renderRecurring();
    msg(`"${x.concept}" registrado ✅`);
  } catch {
    msg("Error al registrar el recurrente.", false);
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar"; }
  }
}

// --- Alta y edición de recurrentes ---
let EDIT_REC = null;

function nuevoRecurrente() {
  EDIT_REC = null;
  $("rec-title").textContent = "Nuevo gasto recurrente";
  $("r-concept").value = ""; $("r-amount").value = ""; $("r-day").value = "1";
  $("r-cat").innerHTML = opcionesCat("out");
  $("r-pp").checked = false; $("r-daylimit").value = ""; $("r-amountlate").value = "";
  $("r-var").checked = false; $("r-cada").value = "1";
  $("r-pp-campos").classList.add("hidden");
  $("r-add").textContent = "Guardar recurrente";
  abrir("dlg-recurrente");
  $("r-concept").focus();
}

function editarRecurrente(r) {
  EDIT_REC = r.id;
  $("rec-title").textContent = "Editar recurrente";
  $("r-concept").value = r.concept || "";
  $("r-cat").innerHTML = opcionesCat("out", r.category || "");
  $("r-cat").value = r.category || "";
  $("r-amount").value = r.amount;
  $("r-day").value = r.day || 1;
  $("r-var").checked = !!r.periodoAnterior;
  $("r-cada").value = String(r.cadaMeses || 1);
  const tienePP = !!(r.dayLimit && r.amountLate);
  $("r-pp").checked = tienePP;
  $("r-daylimit").value = tienePP ? r.dayLimit : "";
  $("r-amountlate").value = tienePP ? r.amountLate : "";
  $("r-pp-campos").classList.toggle("hidden", !tienePP);
  $("r-add").textContent = "Guardar cambios";
  abrir("dlg-recurrente");
}

async function addRecurring() {
  const concept = $("r-concept").value.trim();
  const amount = parseFloat($("r-amount").value);
  const category = $("r-cat").value;
  const day = parseInt($("r-day").value, 10) || 1;
  if (!concept || !(amount > 0)) return msg("Falta el concepto o el monto del recurrente.", false);
  // Pronto pago: los dos campos o ninguno
  const usaPP = $("r-pp").checked;
  const dayLimit = usaPP ? parseInt($("r-daylimit").value, 10) : "";
  const amountLate = usaPP ? parseFloat($("r-amountlate").value) : "";
  if (usaPP && (!(dayLimit >= 1 && dayLimit <= 28) || !(amountLate > 0))) {
    return msg("Para el precio que sube: pon hasta qué día vale el precio bajo y cuánto cuesta después.", false);
  }
  const qs = `&concept=${encodeURIComponent(concept)}&category=${encodeURIComponent(category)}` +
    `&amount=${amount}&day=${day}&dayLimit=${usaPP ? dayLimit : ""}&amountLate=${usaPP ? amountLate : ""}` +
    `&periodoAnterior=${$("r-var").checked ? "1" : "0"}&cadaMeses=${$("r-cada").value}`;
  try {
    const r = EDIT_REC
      ? await api(`&action=recurring-update&id=${encodeURIComponent(EDIT_REC)}` + qs)
      : await api(`&action=recurring-add&type=out` + qs);
    if (!r.ok) throw new Error(r.error);
    RECUR = r.recurring || [];
    renderRecurring();
    renderHoy();
    cerrar("dlg-recurrente");
    msg(EDIT_REC ? "Recurrente actualizado ✅" : "Recurrente agregado ✅");
    EDIT_REC = null;
  } catch { msg("Error al guardar el recurrente.", false); }
}

async function recurringAction(act, id, concepto) {
  if (act === "del" && !confirm(`¿Quitar el recurrente "${concepto}"? Los movimientos ya registrados no se tocan.`)) return;
  try {
    const r = await api(`&action=recurring-${act}&id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(r.error);
    RECUR = r.recurring || [];
    renderRecurring();
    msg(act === "del" ? "Recurrente eliminado 🗑️" : "Recurrente actualizado ✅");
  } catch { msg("Error con el recurrente.", false); }
}

async function nightsAction(email, delta) {
  const verb = delta > 0 ? `acreditar 1 noche gratis a` : `redimir 1 noche gratis de`;
  if (!confirm(`¿Seguro que quieres ${verb} ${email}?`)) return;
  try {
    const r = await api(`&action=customer-nights&email=${encodeURIComponent(email)}&delta=${delta}`);
    if (!r.ok) throw new Error(r.error);
    if (r.customers) applyCustomers(r.customers); else loadCustomers();
    msg(delta > 0 ? "Noche acreditada ✅" : "Noche redimida ✅");
  } catch { msg("Error al ajustar noches.", false); }
}

// --- Ficha del cliente (contacto, notas y enlace a su INE en Drive) ---
let FICHA = null;
function abrirFicha(c) {
  FICHA = c.email;
  $("fi-title").textContent = c.name || c.email;
  $("fi-name").value = c.name || "";
  $("fi-phone").value = c.phone || "";
  $("fi-ine").value = c.ineUrl || "";
  $("fi-ineok").checked = !!c.ineVerificada;
  $("fi-notes").value = c.notes || "";
  // Lo que ha dejado: se cruza con los movimientos a su nombre
  const g = (c.name || "").trim().toLowerCase();
  let ing = 0, gas = 0;
  if (g) for (const m of FIN) {
    if ((m.guest || "").trim().toLowerCase() !== g) continue;
    const v = Number(m.amount) || 0;
    if (m.type === "in") ing += v; else gas += v;
  }
  const estancias = (c.reservations || []).length;
  $("fi-resumen").innerHTML =
    `${escHtml(c.email)} · código <b>${escHtml(c.refCode || "—")}</b><br>` +
    `${estancias} estancia${estancias === 1 ? "" : "s"} · pagó <b class="pos">${money(ing)}</b> · costó <b class="neg">${money(gas)}</b> · dejó <b class="${ing - gas >= 0 ? "pos" : "neg"}">${money(ing - gas)}</b>` +
    (c.reglamento
      ? `<br>📜 Aceptó el reglamento (versión ${escHtml(c.reglamento.version || "—")}) el ${fmtD((c.reglamento.at || "").slice(0, 10))} como “${escHtml(c.reglamento.nombre || "")}”.`
      : `<br>📜 Todavía no acepta el reglamento. Lo hace desde su portal.`) +
    (c.ineUrl ? `<br>🪪 <a href="${escHtml(c.ineUrl)}" target="_blank" rel="noopener">Abrir su INE en Drive ↗</a>` : "");
  abrir("dlg-ficha");
  $("fi-phone").focus();
}

async function guardarFicha() {
  if (!FICHA) return;
  const qs = Object.entries({
    email: FICHA,
    name: $("fi-name").value.trim(),
    phone: $("fi-phone").value.trim(),
    ineUrl: $("fi-ine").value.trim(),
    notes: $("fi-notes").value.trim(),
    ineOk: $("fi-ineok").checked ? "1" : "0",
  }).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  try {
    const r = await api("&action=customer-update" + qs);
    if (!r.ok) throw new Error(r.error);
    applyCustomers(r.customers || []);
    cerrar("dlg-ficha");
    FICHA = null;
    msg("Ficha guardada ✅");
  } catch { msg("Error al guardar la ficha.", false); }
}

async function seedCustomer() {
  const name = $("c-name").value.trim(), email = $("c-email").value.trim();
  if (!email) return msg("Falta el correo del cliente.", false);
  try {
    const r = await api(`&action=customer-seed&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(r.error);
    if (r.customers) applyCustomers(r.customers); else loadCustomers();
    msg(`Cliente dado de alta ✅ (código ${r.refCode})`);
    $("c-name").value = ""; $("c-email").value = "";
    cerrar("dlg-cliente");
  } catch { msg("Error al dar de alta.", false); }
}

async function reviewAction(act, id, isPending) {
  const verb = act === "approve" ? "aprobar" : (isPending ? "rechazar" : "quitar");
  if (!confirm(`¿Seguro que quieres ${verb} esta reseña?`)) return;
  try {
    const r = await api(`&action=review-${act}&id=${encodeURIComponent(id)}`);
    if (r && r.reviews) applyReviews(r.reviews); else loadReviews();
    msg(act === "approve" ? "Reseña publicada ✅" : "Reseña eliminada 🗑️");
  } catch { msg("Error con la reseña.", false); }
}

// --- Datos a mano sobre una reserva de Airbnb (su iCal no manda el nombre) ---
let NOTA = null; // { start, end }
function editarNota(b) {
  NOTA = { start: b.start, end: b.end };
  $("n-title").textContent = `Reserva del ${fmtD(b.start)} al ${fmtD(b.end)}`;
  $("n-name").value = b.name || "";
  $("n-guests").value = b.guests || "";
  $("n-plat").value = b.plataforma || (b.source === "airbnb" ? "Airbnb" : "");
  $("n-tarifa").value = b.tarifa || "";
  $("n-comh").value = b.comHuesped !== undefined ? b.comHuesped : "";
  $("n-imp").value = b.impuestos !== undefined ? b.impuestos : "";
  $("n-ret").value = b.retenciones !== undefined ? b.retenciones : "";
  $("n-neto").value = b.pagoAnfitrion || "";
  pintarComision();
  abrir("dlg-nota");
  $("n-name").focus();
}

// Separa lo que se queda la plataforma de lo que es impuesto.
// OJO: los impuestos de ocupación y las retenciones de ISR/IVA NO son de Airbnb,
// van al gobierno. Meterlos en "comisión" infla el número y engaña.
function desglosar(b) {
  const tarifa = Number(b.tarifa) || 0;
  const comH = Number(b.comHuesped) || 0;
  const imp = Number(b.impuestos) || 0;
  const neto = Number(b.pagoAnfitrion) || 0;
  if (!tarifa || !neto) return null;
  // Si no se capturaron, se estiman: en México Airbnb retiene 4% de ISR y 16% de IVA
  const ret = b.retenciones !== undefined && b.retenciones !== "" ? Number(b.retenciones) : Math.round(tarifa * 0.20 * 100) / 100;
  const pagoHuesped = tarifa + comH + imp;
  const comAnfitrion = Math.max(0, tarifa - neto - ret);   // lo que Airbnb te descuenta a ti
  const airbnb = comH + comAnfitrion;
  const gobierno = imp + ret;
  return { tarifa, comH, imp, ret, neto, pagoHuesped, comAnfitrion, airbnb, gobierno };
}

function pintarComision() {
  const el = $("n-comision");
  const d = desglosar({
    tarifa: $("n-tarifa").value, comHuesped: $("n-comh").value, impuestos: $("n-imp").value,
    retenciones: $("n-ret").value, pagoAnfitrion: $("n-neto").value,
  });
  if (!d) { el.textContent = "Pon al menos la tarifa y lo que te depositaron."; return; }
  const pctA = Math.round((d.airbnb / d.pagoHuesped) * 100);
  const pctG = Math.round((d.gobierno / d.pagoHuesped) * 100);
  el.innerHTML =
    `El huésped pagó <b>${money(d.pagoHuesped)}</b>.<br>` +
    `· <b class="neg">${money(d.airbnb)}</b> se los queda la plataforma (${pctA}%)<br>` +
    `· <b>${money(d.gobierno)}</b> son impuestos y retenciones que van al gobierno (${pctG}%)<br>` +
    `· <b class="pos">${money(d.neto)}</b> te llegaron a ti` +
    ($("n-ret").value ? "" : `<br><span style="opacity:.75">Las retenciones se estimaron en ${money(d.ret)} (4% de ISR + 16% de IVA sobre la tarifa). Si tu recibo dice otra cosa, escríbelo.</span>`);
}

async function guardarNota() {
  if (!NOTA) return;
  const qs = Object.entries({
    start: NOTA.start, end: NOTA.end,
    name: $("n-name").value.trim(),
    guests: $("n-guests").value,
    plataforma: $("n-plat").value.trim(),
    tarifa: $("n-tarifa").value,
    comHuesped: $("n-comh").value,
    impuestos: $("n-imp").value,
    retenciones: $("n-ret").value,
    pagoAnfitrion: $("n-neto").value,
  }).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  try {
    const r = await api("&action=note-set" + qs);
    if (!r.ok) throw new Error(r.error);
    cerrar("dlg-nota");
    NOTA = null;
    if (r.direct) applyBlocks(r); else load();
    msg("Datos guardados ✅");
  } catch { msg("Error al guardar los datos.", false); }
}

async function release(start, end) {
  if (!confirm(`¿Liberar ${fmtD(start)} → ${fmtD(end)}?`)) return;
  try {
    const r = await api(`&action=release&start=${start}&end=${end}`);
    msg("Fecha liberada ✅");
    if (r && r.direct) applyBlocks(r); else load();
  } catch { msg("Error al liberar.", false); }
}

// --- Alta y edición de reservas directas ---
let EDITING = null; // {start, end} originales cuando se está editando

function blockFormQS() {
  const s = $("bstart").value, e = $("bend").value;
  if (!s || !e || e <= s) { msg("Fechas inválidas (salida después de llegada).", false); return null; }
  const p = {
    start: s, end: e,
    name: $("b-name").value.trim(),
    guests: $("b-guests").value,
    rate: $("b-rate").value,
    checkinTime: $("b-cit").value,
    checkoutTime: $("b-cot").value,
    referredBy: $("b-ref").value.trim(),
    freeNight: $("b-free").checked ? "1" : "0",
  };
  return Object.entries(p).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
}

// Deja el formulario limpio y cierra la ventana (se usa al terminar de guardar)
function resetBlockForm() {
  EDITING = null;
  SEL = { start: null, end: null };
  ["bstart", "bend", "b-name", "b-guests", "b-rate", "b-ref"].forEach((id) => { $(id).value = ""; });
  $("b-cit").value = "14:00"; $("b-cot").value = "10:00"; $("b-free").checked = false;
  $("b-title").textContent = "Nueva reserva";
  $("addblock").textContent = "Guardar reserva";
  $("canceledit").classList.add("hidden");
  cerrar("dlg-reserva");
  renderMiniCal();
}

// Abre la ventana en blanco, conservando las fechas que se hayan elegido en el calendario
function nuevaReserva() {
  EDITING = null;
  ["b-name", "b-guests", "b-rate", "b-ref"].forEach((id) => { $(id).value = ""; });
  $("b-cit").value = "14:00"; $("b-cot").value = "10:00"; $("b-free").checked = false;
  $("bstart").value = SEL.start || "";
  $("bend").value = SEL.end || "";
  $("b-title").textContent = "Nueva reserva";
  $("addblock").textContent = "Guardar reserva";
  $("canceledit").classList.add("hidden");
  abrir("dlg-reserva");
  $("b-name").focus();
}

function startEdit(b) {
  EDITING = { start: b.start, end: b.end };
  SEL = { start: b.start, end: b.end };
  $("bstart").value = b.start; $("bend").value = b.end;
  $("b-name").value = b.name || ""; $("b-guests").value = b.guests || "";
  $("b-rate").value = b.rate || ""; $("b-ref").value = b.referredBy || "";
  $("b-cit").value = b.checkinTime || "14:00"; $("b-cot").value = b.checkoutTime || "10:00";
  $("b-free").checked = !!b.freeNight;
  $("b-title").textContent = `Editar ${fmtD(b.start)} → ${fmtD(b.end)}`;
  $("addblock").textContent = "Guardar cambios";
  $("canceledit").classList.remove("hidden");
  renderMiniCal();
  abrir("dlg-reserva");
}

async function addBlock() {
  const qs = blockFormQS();
  if (!qs) return;
  try {
    let r;
    if (EDITING) {
      r = await api(`&action=block-update&ostart=${EDITING.start}&oend=${EDITING.end}` + qs);
      if (!r.ok) throw new Error(r.error);
      msg("Reserva actualizada ✅");
    } else {
      r = await api(`&action=block` + qs);
      if (!r.ok) throw new Error(r.error);
      msg("Reserva agregada ✅");
    }
    resetBlockForm();
    if (r.direct) applyBlocks(r); else load();
  } catch (e) { msg(EDITING ? "Error al actualizar: " + e.message : "Error al agregar.", false); }
}

function showLogin() {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("logout").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  pintarMenu();
  irA("hoy");
  prepararPlegables();
  window.addEventListener("resize", prepararPlegables);

  // Cualquier botón con data-cerrar cierra la ventana que lo contiene.
  // Las ventanas también se cierran con Escape (lo hace <dialog> solo).
  document.querySelectorAll("dialog [data-cerrar]").forEach((b) => {
    b.addEventListener("click", () => b.closest("dialog").close());
  });
  // Clic en el fondo oscuro = cerrar
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  });

  $("enter").addEventListener("click", () => {
    KEY = $("key").value.trim();
    localStorage.setItem(KEY_STORE, KEY);
    load();
  });
  $("key").addEventListener("keydown", (e) => { if (e.key === "Enter") $("enter").click(); });
  $("addblock").addEventListener("click", addBlock);
  $("canceledit").addEventListener("click", resetBlockForm);
  $("c-seed").addEventListener("click", seedCustomer);
  $("n-save").addEventListener("click", guardarNota);
  $("fi-save").addEventListener("click", guardarFicha);
  ["n-tarifa", "n-comh", "n-imp", "n-ret", "n-neto"].forEach((id) => $(id).addEventListener("input", pintarComision));
  $("ver").textContent = "v" + VERSION;
  $("recargar").addEventListener("click", () => location.reload());
  revisarVersion();
  const sincronizar = async (btn) => {
    if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = "Sincronizando…"; }
    try { await load(); await revisarVersion(); msg("Datos actualizados desde el servidor ✅"); }
    catch { msg("No se pudo sincronizar.", false); }
    finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.t || "↻ Sincronizar"; } }
  };
  $("sync").addEventListener("click", (e) => sincronizar(e.currentTarget));
  $("sync-movil").addEventListener("click", (e) => sincronizar(e.currentTarget));
  $("r-pp").addEventListener("change", (e) => $("r-pp-campos").classList.toggle("hidden", !e.target.checked));
  $("f-type").addEventListener("change", fillCats);
  $("f-add").addEventListener("click", addMovFromForm);
  $("f-cancel").addEventListener("click", () => { resetMovForm(); msg("Edición cancelada."); });
  $("periodo-sel").addEventListener("change", (e) => { PERIODO = e.target.value; renderStats(FIN); });
  $("r-add").addEventListener("click", addRecurring);
  $("hoy-extender").addEventListener("click", abrirExtender);
  $("ext-guardar").addEventListener("click", guardarExtension);
  ["ext-noches", "ext-precio"].forEach((id) => $(id).addEventListener("input", pintarExtender));
  $("cal-prev").addEventListener("click", () => calMove(-1));
  $("cal-next").addEventListener("click", () => calMove(1));
  $("cal-hoy").addEventListener("click", calHoy);
  // Leer un ticket: el botón dispara el selector de foto (cámara en celular)
  $("f-ticket").addEventListener("click", () => $("f-ticket-file").click());
  $("f-ticket-file").addEventListener("change", (e) => leerTicket(e.target.files && e.target.files[0]));
  // swipe horizontal para cambiar de mes en el celular
  (() => {
    const box = $("minical"); if (!box) return;
    let x0 = null;
    box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 45) calMove(dx < 0 ? 1 : -1);
      x0 = null;
    }, { passive: true });
  })();
  $("r-cat").innerHTML = opcionesCat("out");
  fillCats();
  $("f-date").value = hoyMx();
  $("bstart").addEventListener("change", syncSelFromInputs);
  $("bend").addEventListener("change", syncSelFromInputs);
  $("logout").addEventListener("click", async () => {
    localStorage.removeItem(KEY_STORE); KEY = ""; $("key").value = "";
    // También cierra la sesión magic-link (cookie), si existe.
    try { await fetch("/api/portal-logout", { method: "POST", credentials: "same-origin" }); } catch (e) {}
    showLogin();
  });
  // Intenta cargar siempre: autentica con contraseña guardada o con la
  // cookie de sesión admin (magic link vía /portal).
  load();
});
