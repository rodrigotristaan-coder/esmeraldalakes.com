// Lógica del panel de administración (cliente).
const $ = (id) => document.getElementById(id);
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

// ===================== Pantallas y ventanas =====================
// El panel es una pantalla a la vez (antes era un solo scroll de 5 pantallas).
// El menú vive en el riel de la izquierda en escritorio y en la barra de abajo
// en celular; los dos se pintan de esta misma lista.
const VISTAS = [
  { id: "hoy",         nombre: "Hoy",         corto: "Hoy",     ico: "◆",  accion: { txt: "+ Nueva reserva",        mini: "+ Reserva",    fn: () => nuevaReserva() } },
  { id: "calendario",  nombre: "Calendario",  corto: "Calend.", ico: "🗓", accion: { txt: "+ Nueva reserva",        mini: "+ Reserva",    fn: () => nuevaReserva() } },
  { id: "dinero",      nombre: "Dinero",      corto: "Dinero",  ico: "💰", accion: { txt: "+ Registrar movimiento", mini: "+ Movimiento", fn: () => nuevoMov() } },
  { id: "recurrentes", nombre: "Recurrentes", corto: "Recurr.", ico: "🔁", accion: { txt: "+ Nuevo recurrente",     mini: "+ Recurrente", fn: () => abrir("dlg-recurrente") } },
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
  msg("");
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
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

function srcFor(ds) {
  let src = null;
  for (const b of BLOCKS) {
    if (ds >= b.start && ds < b.end) {
      if (b.source !== "airbnb") return "dir";
      src = src || "abb";
    }
  }
  return src;
}

// Quién ocupa un día (para el hover y el clic)
function whoOn(ds) {
  for (const b of BLOCKS) {
    if (ds >= b.start && ds < b.end) {
      const quien = b.name || (b.source === "airbnb" ? "Reserva de Airbnb" : "Reserva directa");
      return { quien, b };
    }
  }
  return null;
}

// Meses visibles del calendario (0 = el mes en curso). En pantalla chica, 1.
let CAL_OFFSET = 0;
const CAL_MESES = window.matchMedia("(min-width: 700px)").matches ? 2 : 1;

function renderMiniCal() {
  const box = $("minical");
  if (!box) return;
  const now = new Date();
  const Y = now.getFullYear(), M = now.getMonth();
  const todayDs = isoDay(Y, M, now.getDate());
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
      const s = srcFor(ds);
      if (s) cls.push(s);
      if (ds < todayDs) cls.push("past");
      if (ds === todayDs) cls.push("today");
      if (BLOCKS.some((b) => b.start === ds)) cls.push("llega");
      if (BLOCKS.some((b) => b.end === ds)) cls.push("sale");
      if (ds === SEL.start || ds === SEL.end) cls.push("sel");
      else if (SEL.start && SEL.end && ds > SEL.start && ds < SEL.end) cls.push("inrange");
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = cls.join(" ");
      cell.textContent = d;
      const w = whoOn(ds);
      // El detalle del día (quién está, quién llega o sale, y cuánto entró o salió)
      const detalle = detalleDia(ds);
      cell.title = detalle;
      cell.addEventListener("mouseenter", () => { const e = $("cal-who"); if (e) e.textContent = detalle; });
      cell.addEventListener("focus", () => { const e = $("cal-who"); if (e) e.textContent = detalle; });
      if (ds >= todayDs) cell.addEventListener("click", () => (w ? showWho(ds) : pickDay(ds)));
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
  CAL_OFFSET = Math.max(0, Math.min(24 - CAL_MESES, CAL_OFFSET + delta * CAL_MESES));
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
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
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
  for (const b of all) {
    const div = document.createElement("div");
    div.className = "card";
    const quien = b.name ? `<b>${escHtml(b.name)}</b>` : '<span class="muted">sin nombre</span>';
    div.innerHTML = `<span style="text-align:left">${quien}<br><span class="muted">${fmt(b)} · ${escHtml(b.source)}` +
      `${b.guests ? " · " + b.guests + " pax" : ""}${b.rate ? " · " + money(b.rate) + "/noche" : ""}</span></span>`;
    // Las de Airbnb llegan por iCal sin nombre: aquí se les pone a mano.
    if (b.source === "airbnb") {
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
      btn.textContent = b.name ? "Editar datos" : "Poner nombre";
      btn.addEventListener("click", () => editarNota(b));
      wrap.appendChild(btn);
      div.appendChild(wrap);
    }
    a.appendChild(div);
  }
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
    box.innerHTML = '<div class="vacio"><b>Sin estancias anteriores</b>Aquí van apareciendo los huéspedes conforme terminan su estancia.</div>';
    return;
  }
  for (const b of PASADAS) {
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
    box.appendChild(div);
  }
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

// Propone recepción y limpieza de cada reserva que no esté ya registrada.
// Ventana: de 60 días atrás a 7 adelante, para que la de mañana ya aparezca.
function pendientesDeReservas() {
  const hoyDs = new Date().toISOString().slice(0, 10);
  const desde = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const hasta = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const yaHay = new Set(FIN.map((m) => (m.concept || "").trim().toLowerCase()));
  const out = [];
  for (const b of BLOCKS) {
    const items = [
      { tipo: "recepcion", date: b.start, amount: COSTO_RECEPCION, concept: conceptoRecepcion(b), etiqueta: "Recepción", categoria: "Recepción" },
      { tipo: "limpieza", date: b.end, amount: COSTO_LIMPIEZA, concept: conceptoLimpieza(b), etiqueta: "Limpieza", categoria: "Limpieza" },
    ];
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
  const llega = BLOCKS.filter((b) => b.start === ds);
  const sale = BLOCKS.filter((b) => b.end === ds);
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

function renderHoy() {
  const hoyDs = new Date().toISOString().slice(0, 10);
  const f = $("hoy-fecha");
  if (f) {
    const d = new Date();
    f.textContent = `${DIA_LARGO[d.getDay()]} ${d.getDate()} de ${MES_LARGO[d.getMonth()]} de ${d.getFullYear()}`;
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

  // --- Cinta: 30 días ---
  const cinta = $("hoy-cinta");
  if (cinta) {
    cinta.innerHTML = "";
    const base = new Date(hoyDs + "T12:00:00");
    for (let i = 0; i < 30; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const ds = d.toISOString().slice(0, 10);
      const s = srcFor(ds);
      const el = document.createElement("span");
      el.className = "cinta__d" + (s ? " " + s : "") + (i === 0 ? " hoy" : "");
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
    if (b) b.textContent = fmtD(new Date(base.getTime() + 29 * 86400000).toISOString().slice(0, 10));
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
      const total = rec.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      items.push({ ico: "🔁", txt: `${rec.length} gasto${rec.length === 1 ? "" : "s"} recurrente${rec.length === 1 ? "" : "s"} sin registrar`,
        sub: `${money(total)} en total · ${rec.map((r) => r.concept).join(", ")}`, btn: "Revisar", ir: "recurrentes" });
    }
    if (RV_PEND) {
      items.push({ ico: "📝", txt: `${RV_PEND} reseña${RV_PEND === 1 ? "" : "s"} esperando tu visto bueno`,
        sub: "Nadie la ve en la landing hasta que la apruebes.", btn: "Revisar", ir: "gente" });
    }
    // Reservas que ya terminaron y no tienen un ingreso registrado a ese nombre
    const cobrados = new Set(FIN.filter((m) => m.type === "in" && m.guest).map((m) => m.guest.trim().toLowerCase()));
    const sinCobrar = BLOCKS.filter((b) => b.source !== "airbnb" && b.name && b.end <= hoyDs && !cobrados.has(b.name.trim().toLowerCase()));
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
      wrap.appendChild(del);
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
    div.innerHTML =
      `<span style="text-align:left"><b>${escHtml(c.name || "(sin nombre)")}</b> <span class="muted">${escHtml(c.email)}</span><br>` +
      `<span class="muted">🎟 ${escHtml(c.refCode || "—")} · 🌙 ${c.freeNights || 0} noches gratis · 👥 ${refs} referidos · 📅 ${resv} reservas</span></span>`;
    const wrap = document.createElement("span");
    wrap.className = "row";
    const plus = document.createElement("button");
    plus.textContent = "+1 noche";
    plus.addEventListener("click", () => nightsAction(c.email, 1));
    wrap.appendChild(plus);
    if ((c.freeNights || 0) > 0) {
      const redeem = document.createElement("button");
      redeem.className = "danger";
      redeem.textContent = "Redimir 1";
      redeem.addEventListener("click", () => nightsAction(c.email, -1));
      wrap.appendChild(redeem);
    }
    div.appendChild(wrap);
    box.appendChild(div);
  }
}

// --- Finanzas ---
const CATS = {
  in: ["Reserva", "Extras del huésped", "Otro ingreso"],
  out: ["Recepción", "Limpieza", "Luz", "Gas", "Agua", "Internet", "Cuota condominio", "Mantenimiento",
        "Jabón e insumos", "Sábanas y blancos", "Pintura", "Jardinería",
        "Desayunos", "Ida al súper", "Publicidad", "Comisiones", "Otro gasto"],
};
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

function fillCats() {
  const type = $("f-type").value;
  $("f-cat").innerHTML = CATS[type].map((c) => `<option>${c}</option>`).join("");
}

// Periodo elegido en el filtro: "YYYY" (año completo) o "YYYY-MM" (un mes)
let PERIODO = new Date().toISOString().slice(0, 4);

function buildPeriodo(movs) {
  const box = $("periodo-sel");
  if (!box) return;
  const anios = [...new Set(movs.map((m) => m.date.slice(0, 4)))].sort().reverse();
  const yNow = new Date().toISOString().slice(0, 4);
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
  const meses = Object.keys(by).sort().slice(-12);
  if (!meses.length) { svg.innerHTML = '<text x="10" y="24">Sin movimientos todavía.</text>'; return; }
  const max = Math.max(...meses.map((ym) => Math.max(by[ym].in, by[ym].out)), 1);
  // Se deja aire arriba (alto útil menor) para que quepan las cifras sobre las barras
  const W = 720, H = 210, base = H - 26, alto = base - 26;
  const paso = W / meses.length, ancho = Math.min(16, paso / 3.2);
  let out = `<line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}" />`;
  meses.forEach((ym, i) => {
    const cx = i * paso + paso / 2;
    const hi = (by[ym].in / max) * alto, ho = (by[ym].out / max) * alto;
    const xi = cx - ancho - 1.5, xo = cx + 1.5;
    out += `<rect class="gin"  x="${xi}" y="${base - hi}" width="${ancho}" height="${hi}" rx="2"><title>${mesLabel(ym)} · ingresos ${money(by[ym].in)}</title></rect>`;
    out += `<rect class="gout" x="${xo}" y="${base - ho}" width="${ancho}" height="${ho}" rx="2"><title>${mesLabel(ym)} · gastos ${money(by[ym].out)}</title></rect>`;
    // Cifra sobre cada barra, abreviada para que quepan las 12 columnas
    if (by[ym].in) out += `<text class="val gin" x="${xi + ancho / 2}" y="${base - hi - 4}" text-anchor="middle">${moneyCorto(by[ym].in)}</text>`;
    if (by[ym].out) out += `<text class="val gout" x="${xo + ancho / 2}" y="${base - ho - 4}" text-anchor="middle">${moneyCorto(by[ym].out)}</text>`;
    out += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${mesLabel(ym).replace(" ", "'")}</text>`;
  });
  svg.innerHTML = out;
}

function renderFinance(movs) {
  buildPeriodo(movs);
  renderStats(movs);
  renderChart(movs);
  renderGuests(movs);
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

  // Movimientos (últimos 40)
  const box = $("f-movs");
  box.innerHTML = "";
  for (const m of movs.slice(0, 40)) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<span style="text-align:left"><span class="tag ${m.type}">${m.type === "in" ? "INGRESO" : "GASTO"}</span>` +
      `<b>${escHtml(m.concept)}</b> <span class="muted">· ${fmtD(m.date)} · ${escHtml(m.category || "")}${m.guest ? " · 👤 " + escHtml(m.guest) : ""}</span></span>` +
      `<span class="row"><b class="${m.type === "in" ? "pos" : "neg"}">${m.type === "in" ? "+" : "−"}${money(m.amount)}</b></span>`;
    // Acciones calladas: antes eran tres botones de color en cada fila y el
    // listado parecía un tablero de botones. Ahora el monto manda.
    const wrap = div.querySelector(".row");
    const ed = document.createElement("button");
    ed.className = "quiet";
    ed.textContent = "Editar";
    ed.setAttribute("aria-label", `Editar ${m.concept}`);
    ed.addEventListener("click", () => startEditMov(m));
    wrap.appendChild(ed);
    const dup = document.createElement("button");
    dup.className = "quiet";
    dup.textContent = "Repetir";
    dup.title = "Repite este movimiento con fecha de hoy (útil para gastos mensuales)";
    dup.setAttribute("aria-label", `Repetir ${m.concept} con fecha de hoy`);
    dup.addEventListener("click", () => duplicateMov(m));
    wrap.appendChild(dup);
    const del = document.createElement("button");
    del.className = "quiet peligro";
    del.textContent = "Borrar";
    del.setAttribute("aria-label", `Borrar ${m.concept}`);
    del.addEventListener("click", () => deleteMov(m));
    wrap.appendChild(del);
    box.appendChild(div);
  }
  if (movs.length > 40) box.insertAdjacentHTML("beforeend", `<p class="muted">… y ${movs.length - 40} movimientos más (siguen contando en los totales).</p>`);
}

// Sugerencias de huésped: los nombres de las reservas + los ya usados en movimientos
function fillGuestList(movs) {
  const dl = $("guestlist");
  if (!dl) return;
  const nombres = new Set();
  for (const b of BLOCKS) if (b.name) nombres.add(b.name);
  for (const m of movs) if (m.guest) nombres.add(m.guest);
  dl.innerHTML = [...nombres].sort().map((n) => `<option value="${escHtml(n)}"></option>`).join("");
}

// Cuánto pagó y cuánto costó cada huésped
function renderGuests(movs) {
  const box = $("guest-table");
  if (!box) return;
  const by = {};
  for (const m of movs) {
    const g = (m.guest || "").trim();
    if (!g) continue;
    by[g] = by[g] || { in: 0, out: 0, n: 0, ultima: "" };
    by[g][m.type] += Number(m.amount) || 0;
    by[g].n++;
    if (m.date > by[g].ultima) by[g].ultima = m.date;
  }
  const nombres = Object.keys(by).sort((a, b) => by[b].ultima.localeCompare(by[a].ultima));
  if (!nombres.length) {
    box.innerHTML = '<p class="muted">Todavía no hay movimientos con huésped. Escribe su nombre en el campo "Huésped" al registrar un ingreso o un gasto.</p>';
    return;
  }
  let tot = { in: 0, out: 0 };
  const filas = nombres.map((g) => {
    const r = by[g], u = r.in - r.out;
    tot.in += r.in; tot.out += r.out;
    return `<tr><td class="g"><b>${escHtml(g)}</b><br><span class="muted">${fmtD(r.ultima)} · ${r.n} movimiento${r.n === 1 ? "" : "s"}</span></td>` +
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

// Edición de un movimiento: reusa el mismo formulario de alta
let EDIT_MOV = null;
function startEditMov(m) {
  EDIT_MOV = m.id;
  $("f-type").value = m.type; fillCats();
  $("f-date").value = m.date;
  $("f-concept").value = m.concept || "";
  $("f-cat").value = m.category || "";
  $("f-guest").value = m.guest || "";
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
  $("f-concept").value = ""; $("f-amount").value = ""; $("f-guest").value = "";
  $("f-date").value = new Date().toISOString().slice(0, 10);
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
  if (!date || !concept || !(amount > 0)) return msg("Faltan datos: fecha, concepto y monto.", false);
  const btn = $("f-add");
  finBusy = true;
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = "Guardando…"; }
  try {
    if (EDIT_MOV) {
      const qs = Object.entries({ id: EDIT_MOV, type, date, concept, category, guest, amount })
        .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
      const r = await api("&action=finance-update" + qs);
      if (!r.ok) throw new Error(r.error);
      applyFinance(r.movs || FIN);
      msg("Movimiento actualizado ✅");
    } else {
      const r = await financeAdd({ type, date, concept, category, guest, amount });
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
  const hoy = new Date().toISOString().slice(0, 10);
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

// Un recurrente está "pendiente" si está activo y no hay ya un movimiento
// de este mes con ese mismo concepto.
function pendientesDelMes() {
  const ym = new Date().toISOString().slice(0, 7);
  const yaHay = new Set(FIN.filter((m) => m.date.slice(0, 7) === ym).map((m) => (m.concept || "").toLowerCase()));
  return RECUR.filter((r) => r.activo && !yaHay.has((r.concept || "").toLowerCase()));
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

function renderRecurring() {
  renderResPend();
  const pend = pendientesDelMes();
  const ym = new Date().toISOString().slice(0, 7);
  const bp = $("r-pending");
  if (bp) {
    const total = pend.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    bp.innerHTML = pend.length
      ? `<p class="muted">${pend.length} por registrar · ${money(total)} en total</p>`
      : '<p class="muted">Todo lo recurrente de este mes ya está registrado ✅</p>';
    for (const r of pend) {
      const div = document.createElement("div");
      div.className = "card";
      const fecha = `${ym}-${String(r.day).padStart(2, "0")}`;
      div.innerHTML = `<span style="text-align:left"><span class="tag ${r.type}">${r.type === "in" ? "INGRESO" : "GASTO"}</span>` +
        `<b>${escHtml(r.concept)}</b> <span class="muted">· día ${r.day} · ${escHtml(r.category || "")}</span></span>`;
      const wrap = document.createElement("span");
      wrap.className = "row";
      const amt = document.createElement("input");
      amt.type = "number"; amt.step = "0.01"; amt.min = "0"; amt.value = r.amount; amt.style.width = "105px";
      amt.title = "Puedes cambiar el monto antes de confirmar";
      const dt = document.createElement("input");
      dt.type = "date"; dt.value = fecha; dt.title = "Puedes cambiar la fecha antes de confirmar";
      const ok = document.createElement("button");
      ok.textContent = "Confirmar";
      ok.addEventListener("click", () => confirmRecurring(r, parseFloat(amt.value), dt.value, ok));
      wrap.append(amt, dt, ok);
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
    div.innerHTML = `<span style="text-align:left"><b>${escHtml(r.concept)}</b> <span class="muted">· ${money(r.amount)} · día ${r.day} · ${escHtml(r.category || "")}${r.activo ? "" : " · ⏸ pausado"}</span></span>`;
    const wrap = document.createElement("span");
    wrap.className = "row";
    const tg = document.createElement("button");
    tg.className = "ghost";
    tg.textContent = r.activo ? "Pausar" : "Reactivar";
    tg.addEventListener("click", () => recurringAction("toggle", r.id));
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "✕";
    del.addEventListener("click", () => recurringAction("del", r.id, r.concept));
    wrap.append(tg, del);
    div.appendChild(wrap);
    bl.appendChild(div);
  }
}

async function confirmRecurring(r, amount, date, btn) {
  if (!(amount > 0) || !date) return msg("Revisa el monto y la fecha.", false);
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
  try {
    const res = await financeAdd({ type: r.type, date, concept: r.concept, category: r.category || "", amount });
    applyFinance(res.movs || FIN.concat(res.mov));
    renderRecurring();
    msg(`"${r.concept}" registrado ✅`);
  } catch {
    msg("Error al registrar el recurrente.", false);
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar"; }
  }
}

async function addRecurring() {
  const concept = $("r-concept").value.trim();
  const amount = parseFloat($("r-amount").value);
  const category = $("r-cat").value;
  const day = parseInt($("r-day").value, 10) || 1;
  if (!concept || !(amount > 0)) return msg("Falta el concepto o el monto del recurrente.", false);
  try {
    const r = await api(`&action=recurring-add&type=out&concept=${encodeURIComponent(concept)}&category=${encodeURIComponent(category)}&amount=${amount}&day=${day}`);
    if (!r.ok) throw new Error(r.error);
    RECUR = r.recurring || [];
    renderRecurring();
    renderHoy();
    $("r-concept").value = ""; $("r-amount").value = "";
    cerrar("dlg-recurrente");
    msg("Recurrente agregado ✅");
  } catch { msg("Error al agregar el recurrente.", false); }
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
  $("n-rate").value = b.rate || "";
  abrir("dlg-nota");
  $("n-name").focus();
}

async function guardarNota() {
  if (!NOTA) return;
  const qs = Object.entries({
    start: NOTA.start, end: NOTA.end,
    name: $("n-name").value.trim(),
    guests: $("n-guests").value,
    rate: $("n-rate").value,
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
  $("f-type").addEventListener("change", fillCats);
  $("f-add").addEventListener("click", addMovFromForm);
  $("f-cancel").addEventListener("click", () => { resetMovForm(); msg("Edición cancelada."); });
  $("periodo-sel").addEventListener("change", (e) => { PERIODO = e.target.value; renderStats(FIN); });
  $("r-add").addEventListener("click", addRecurring);
  $("cal-prev").addEventListener("click", () => calMove(-1));
  $("cal-next").addEventListener("click", () => calMove(1));
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
  $("r-cat").innerHTML = CATS.out.map((c) => `<option>${c}</option>`).join("");
  fillCats();
  $("f-date").value = new Date().toISOString().slice(0, 10);
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
