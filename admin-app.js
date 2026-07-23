// Lógica del panel de administración (cliente).
const $ = (id) => document.getElementById(id);
const KEY_STORE = "esmeralda_admin_key";
let KEY = localStorage.getItem(KEY_STORE) || "";

function msg(t, ok = true) {
  const el = $("msg");
  el.textContent = t;
  el.style.color = ok ? "#0a5944" : "#b23b3b";
}

async function api(params) {
  const url = "/api/admin?key=" + encodeURIComponent(KEY) + params;
  const r = await fetch(url);
  if (r.status === 401) throw new Error("401");
  return r.json();
}

function fmt(b) {
  return `${b.start} → ${b.end}`;
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

  // Reservas directas (liberables + registrar ingreso)
  const d = $("direct");
  d.innerHTML = data.direct.length ? "" : '<p class="muted">Sin reservas directas próximas.</p>';
  for (const b of data.direct) {
    const div = document.createElement("div");
    div.className = "card";
    const who = b.name ? ` · <b>${escHtml(b.name)}</b>` : "";
    div.innerHTML = `<span>${fmt(b)}${who} <span class="muted">(${b.source}${b.guests ? ` · ${b.guests} pax` : ""})</span></span>`;
    const wrap = document.createElement("span");
    wrap.className = "row";
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
}

const escHtml = (s = "") => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

async function loadReviews() {
  let data;
  try { data = await api("&action=reviews"); } catch { return; }
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
  const box = $("customers");
  const list = data.customers || [];
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
  in: ["Reserva", "Otro ingreso"],
  out: ["Limpieza", "Luz", "Agua", "Internet", "Cuota condominio", "Mantenimiento", "Insumos y blancos", "Comisiones", "Otro gasto"],
};
const money = (n) => (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const MES_LBL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (ym) => `${MES_LBL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function fillCats() {
  const type = $("f-type").value;
  $("f-cat").innerHTML = CATS[type].map((c) => `<option>${c}</option>`).join("");
}

function renderStats(movs) {
  const now = new Date();
  const ymNow = now.toISOString().slice(0, 7);
  const yNow = now.toISOString().slice(0, 4);
  let inMes = 0, outMes = 0, inYr = 0, outYr = 0;
  for (const m of movs) {
    const v = Number(m.amount) || 0;
    if (m.date.slice(0, 7) === ymNow) { if (m.type === "in") inMes += v; else outMes += v; }
    if (m.date.slice(0, 4) === yNow) { if (m.type === "in") inYr += v; else outYr += v; }
  }
  const utilMes = inMes - outMes, utilYr = inYr - outYr;
  $("stats").innerHTML = `
    <div class="stat"><span class="lbl">Ocupación 12 meses</span><b>${OCC ? OCC.pct + "%" : "—"}</b><span class="muted">${OCC ? OCC.sold + " noches vendidas" : ""}</span></div>
    <div class="stat"><span class="lbl">Ingresos del mes</span><b class="pos">${money(inMes)}</b></div>
    <div class="stat"><span class="lbl">Gastos del mes</span><b class="neg">${money(outMes)}</b></div>
    <div class="stat"><span class="lbl">Utilidad del mes</span><b class="${utilMes >= 0 ? "pos" : "neg"}">${money(utilMes)}</b></div>
    <div class="stat"><span class="lbl">Utilidad ${yNow}</span><b class="${utilYr >= 0 ? "pos" : "neg"}">${money(utilYr)}</b><span class="muted">${money(inYr)} in · ${money(outYr)} out</span></div>`;
}

function renderFinance(movs) {
  renderStats(movs);

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
      `<b>${escHtml(m.concept)}</b> <span class="muted">· ${m.date} · ${escHtml(m.category || "")}</span></span>` +
      `<span class="row"><b class="${m.type === "in" ? "pos" : "neg"}">${m.type === "in" ? "+" : "−"}${money(m.amount)}</b></span>`;
    const wrap = div.querySelector(".row");
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

async function loadFinance() {
  try {
    const data = await api("&action=finance-list");
    renderFinance(data.movs || []);
  } catch { /* si falla, el resto del panel sigue */ }
}

async function financeAdd(params) {
  const qs = Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const r = await api("&action=finance-add" + qs);
  if (!r.ok) throw new Error(r.error);
  return r;
}

async function addMovFromForm() {
  const type = $("f-type").value, date = $("f-date").value, concept = $("f-concept").value.trim();
  const category = $("f-cat").value, amount = parseFloat($("f-amount").value);
  if (!date || !concept || !(amount > 0)) return msg("Faltan datos: fecha, concepto y monto.", false);
  try {
    await financeAdd({ type, date, concept, category, amount });
    msg(type === "in" ? "Ingreso registrado ✅" : "Gasto registrado ✅");
    $("f-concept").value = ""; $("f-amount").value = "";
    loadFinance();
  } catch { msg("Error al registrar el movimiento.", false); }
}

async function quickIncome(b) {
  const monto = prompt(`Monto cobrado por la reserva ${b.start} → ${b.end}${b.name ? ` de ${b.name}` : ""} (MXN):`);
  const amount = parseFloat(String(monto || "").replace(/[$,\s]/g, ""));
  if (!(amount > 0)) return;
  try {
    await financeAdd({ type: "in", date: b.start, concept: `Reserva ${b.name || "directa"} ${b.start} → ${b.end}`, category: "Reserva", amount });
    msg("Ingreso de la reserva registrado ✅");
    loadFinance();
  } catch { msg("Error al registrar el ingreso.", false); }
}

async function duplicateMov(m) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (!confirm(`¿Repetir "${m.concept}" (${money(m.amount)}) con fecha de hoy?`)) return;
  try {
    await financeAdd({ type: m.type, date: hoy, concept: m.concept, category: m.category || "", amount: m.amount });
    msg("Movimiento duplicado ✅");
    loadFinance();
  } catch { msg("Error al duplicar.", false); }
}

async function deleteMov(m) {
  if (!confirm(`¿Eliminar "${m.concept}" (${money(m.amount)})?`)) return;
  try {
    const r = await api(`&action=finance-del&id=${encodeURIComponent(m.id)}`);
    if (!r.ok) throw new Error(r.error);
    msg("Movimiento eliminado 🗑️");
    loadFinance();
  } catch { msg("Error al eliminar.", false); }
}

async function nightsAction(email, delta) {
  const verb = delta > 0 ? `acreditar 1 noche gratis a` : `redimir 1 noche gratis de`;
  if (!confirm(`¿Seguro que quieres ${verb} ${email}?`)) return;
  try {
    const r = await api(`&action=customer-nights&email=${encodeURIComponent(email)}&delta=${delta}`);
    if (!r.ok) throw new Error(r.error);
    msg(delta > 0 ? "Noche acreditada ✅" : "Noche redimida ✅");
    loadCustomers();
  } catch { msg("Error al ajustar noches.", false); }
}

async function seedCustomer() {
  const name = $("c-name").value.trim(), email = $("c-email").value.trim();
  if (!email) return msg("Falta el correo del cliente.", false);
  try {
    const r = await api(`&action=customer-seed&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(r.error);
    msg(`Cliente dado de alta ✅ (código ${r.refCode})`);
    $("c-name").value = ""; $("c-email").value = "";
    loadCustomers();
  } catch { msg("Error al dar de alta.", false); }
}

async function reviewAction(act, id, isPending) {
  const verb = act === "approve" ? "aprobar" : (isPending ? "rechazar" : "quitar");
  if (!confirm(`¿Seguro que quieres ${verb} esta reseña?`)) return;
  try {
    await api(`&action=review-${act}&id=${encodeURIComponent(id)}`);
    msg(act === "approve" ? "Reseña publicada ✅" : "Reseña eliminada 🗑️");
    loadReviews();
  } catch { msg("Error con la reseña.", false); }
}

async function release(start, end) {
  if (!confirm(`¿Liberar ${start} → ${end}?`)) return;
  try {
    await api(`&action=release&start=${start}&end=${end}`);
    msg("Fecha liberada ✅");
    load();
  } catch { msg("Error al liberar.", false); }
}

async function addBlock() {
  const s = $("bstart").value, e = $("bend").value;
  if (!s || !e || e <= s) return msg("Fechas inválidas (salida después de llegada).", false);
  try {
    await api(`&action=block&start=${s}&end=${e}`);
    msg("Fechas bloqueadas ✅");
    $("bstart").value = ""; $("bend").value = "";
    load();
  } catch { msg("Error al bloquear.", false); }
}

function showLogin() {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  $("enter").addEventListener("click", () => {
    KEY = $("key").value.trim();
    localStorage.setItem(KEY_STORE, KEY);
    load();
  });
  $("addblock").addEventListener("click", addBlock);
  $("c-seed").addEventListener("click", seedCustomer);
  $("f-type").addEventListener("change", fillCats);
  $("f-add").addEventListener("click", addMovFromForm);
  fillCats();
  $("f-date").value = new Date().toISOString().slice(0, 10);
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
