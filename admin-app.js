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
      if (ds === SEL.start || ds === SEL.end) cls.push("sel");
      else if (SEL.start && SEL.end && ds > SEL.start && ds < SEL.end) cls.push("inrange");
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = cls.join(" ");
      cell.textContent = d;
      const w = whoOn(ds);
      if (w) {
        const n = Math.round((new Date(w.b.end) - new Date(w.b.start)) / 86400000);
        cell.title = `${w.quien} · ${fmtD(w.b.start)} → ${fmtD(w.b.end)} (${n} noche${n === 1 ? "" : "s"})`;
        cell.addEventListener("mouseenter", () => { const e = $("cal-who"); if (e) e.textContent = "👤 " + cell.title; });
      }
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
  if (SEL.end) msg(`Fechas elegidas: ${fmtD(SEL.start)} → ${fmtD(SEL.end)} · completa los datos y agrega ✍️`);
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

  OCC = calcOccupancy(data.all || []);
  $("logout").classList.remove("hidden");

  // Mini calendario interactivo + link a la vista completa
  BLOCKS = data.all || [];
  renderMiniCal();
  const open = $("cal-open");
  if (open) open.href = "/calendario" + (KEY ? "?adminkey=" + encodeURIComponent(KEY) : "");

  // Reservas directas (editar / liberar / registrar ingreso)
  const d = $("direct");
  d.innerHTML = data.direct.length ? "" : '<p class="muted">Sin reservas directas próximas.</p>';
  for (const b of data.direct) {
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
    edit.textContent = "✏️ Editar";
    edit.addEventListener("click", () => startEdit(b));
    wrap.appendChild(edit);
    const inc = document.createElement("button");
    inc.textContent = "💵 Ingreso";
    inc.title = "Registrar el cobro de esta reserva en finanzas";
    inc.addEventListener("click", () => quickIncome(b));
    wrap.appendChild(inc);
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Liberar";
    btn.addEventListener("click", () => release(b.start, b.end));
    wrap.appendChild(btn);
    div.appendChild(wrap);
    d.appendChild(div);
  }

  // Todas (read-only)
  const a = $("all");
  a.innerHTML = data.all.length ? "" : '<p class="muted">Sin fechas ocupadas.</p>';
  for (const b of data.all) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<span>${fmt(b)}${b.name ? ` · ${escHtml(b.name)}` : ""}</span><span class="muted">${b.source}</span>`;
    a.appendChild(div);
  }

  loadReviews();
  loadCustomers();
  loadFinance();
  loadRecurring();
}

const escHtml = (s = "") => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

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
  out: ["Limpieza", "Luz", "Gas", "Agua", "Internet", "Cuota condominio", "Mantenimiento",
        "Jabón e insumos", "Sábanas y blancos", "Pintura", "Jardinería",
        "Desayunos", "Ida al súper", "Publicidad", "Comisiones", "Otro gasto"],
};
const money = (n) => (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
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
  const W = 720, H = 190, base = H - 26, alto = base - 12;
  const paso = W / meses.length, ancho = Math.min(16, paso / 3.2);
  let out = `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="rgba(255,255,255,.22)" />`;
  meses.forEach((ym, i) => {
    const cx = i * paso + paso / 2;
    const hi = (by[ym].in / max) * alto, ho = (by[ym].out / max) * alto;
    out += `<rect class="gin"  x="${cx - ancho - 1.5}" y="${base - hi}" width="${ancho}" height="${hi}" rx="2"><title>${mesLabel(ym)} · ingresos ${money(by[ym].in)}</title></rect>`;
    out += `<rect class="gout" x="${cx + 1.5}"          y="${base - ho}" width="${ancho}" height="${ho}" rx="2"><title>${mesLabel(ym)} · gastos ${money(by[ym].out)}</title></rect>`;
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
    const wrap = div.querySelector(".row");
    const ed = document.createElement("button");
    ed.className = "mini";
    ed.textContent = "✏️";
    ed.title = "Editar este movimiento";
    ed.addEventListener("click", () => startEditMov(m));
    wrap.appendChild(ed);
    const dup = document.createElement("button");
    dup.textContent = "Duplicar";
    dup.title = "Repite este movimiento con fecha de hoy (útil para gastos mensuales)";
    dup.addEventListener("click", () => duplicateMov(m));
    wrap.appendChild(dup);
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "✕";
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
function applyFinance(movs) { FIN = Array.isArray(movs) ? movs : []; renderFinance(FIN); renderRecurring(); }

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
  $("f-add").textContent = "Guardar cambios";
  $("f-cancel").classList.remove("hidden");
  msg(`Editando "${m.concept}" — cambia lo que quieras y guarda.`);
  $("f-concept").focus();
}
function resetMovForm() {
  EDIT_MOV = null;
  $("f-concept").value = ""; $("f-amount").value = ""; $("f-guest").value = "";
  $("f-date").value = new Date().toISOString().slice(0, 10);
  $("f-add").textContent = "Agregar";
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
  } catch { /* el resto del panel sigue */ }
}

// Un recurrente está "pendiente" si está activo y no hay ya un movimiento
// de este mes con ese mismo concepto.
function pendientesDelMes() {
  const ym = new Date().toISOString().slice(0, 7);
  const yaHay = new Set(FIN.filter((m) => m.date.slice(0, 7) === ym).map((m) => (m.concept || "").toLowerCase()));
  return RECUR.filter((r) => r.activo && !yaHay.has((r.concept || "").toLowerCase()));
}

function renderRecurring() {
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
    $("r-concept").value = ""; $("r-amount").value = "";
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

async function release(start, end) {
  if (!confirm(`¿Liberar ${fmtD(start)} → ${fmtD(end)}?`)) return;
  try {
    await api(`&action=release&start=${start}&end=${end}`);
    msg("Fecha liberada ✅");
    load();
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

function resetBlockForm() {
  EDITING = null;
  SEL = { start: null, end: null };
  ["bstart", "bend", "b-name", "b-guests", "b-rate", "b-ref"].forEach((id) => { $(id).value = ""; });
  $("b-cit").value = "14:00"; $("b-cot").value = "10:00"; $("b-free").checked = false;
  $("b-title").textContent = "➕ Nueva reserva directa / bloqueo";
  $("addblock").textContent = "Agregar reserva";
  $("canceledit").classList.add("hidden");
  renderMiniCal();
}

function startEdit(b) {
  EDITING = { start: b.start, end: b.end };
  SEL = { start: b.start, end: b.end };
  $("bstart").value = b.start; $("bend").value = b.end;
  $("b-name").value = b.name || ""; $("b-guests").value = b.guests || "";
  $("b-rate").value = b.rate || ""; $("b-ref").value = b.referredBy || "";
  $("b-cit").value = b.checkinTime || "14:00"; $("b-cot").value = b.checkoutTime || "10:00";
  $("b-free").checked = !!b.freeNight;
  $("b-title").textContent = `✏️ Editando ${fmtD(b.start)} → ${fmtD(b.end)}`;
  $("addblock").textContent = "Guardar cambios";
  $("canceledit").classList.remove("hidden");
  document.querySelector("details.sec").open = true; // sección del calendario
  renderMiniCal();
  window.scrollTo({ top: $("b-title").getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
}

async function addBlock() {
  const qs = blockFormQS();
  if (!qs) return;
  try {
    if (EDITING) {
      const r = await api(`&action=block-update&ostart=${EDITING.start}&oend=${EDITING.end}` + qs);
      if (!r.ok) throw new Error(r.error);
      msg("Reserva actualizada ✅");
    } else {
      const r = await api(`&action=block` + qs);
      if (!r.ok) throw new Error(r.error);
      msg("Reserva agregada ✅");
    }
    resetBlockForm();
    load();
  } catch (e) { msg(EDITING ? "Error al actualizar: " + e.message : "Error al agregar.", false); }
}

function showLogin() {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("logout").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  $("enter").addEventListener("click", () => {
    KEY = $("key").value.trim();
    localStorage.setItem(KEY_STORE, KEY);
    load();
  });
  $("addblock").addEventListener("click", addBlock);
  $("canceledit").addEventListener("click", resetBlockForm);
  $("c-seed").addEventListener("click", seedCustomer);
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
