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

  // Reservas directas (liberables)
  const d = $("direct");
  d.innerHTML = data.direct.length ? "" : '<p class="muted">Sin reservas directas próximas.</p>';
  for (const b of data.direct) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<span>${fmt(b)} <span class="muted">(${b.source})</span></span>`;
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Liberar";
    btn.addEventListener("click", () => release(b.start, b.end));
    div.appendChild(btn);
    d.appendChild(div);
  }

  // Todas (read-only)
  const a = $("all");
  a.innerHTML = data.all.length ? "" : '<p class="muted">Sin fechas ocupadas.</p>';
  for (const b of data.all) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<span>${fmt(b)}</span><span class="muted">${b.source}</span>`;
    a.appendChild(div);
  }

  loadReviews();
  loadCustomers();
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
  $("logout").addEventListener("click", () => {
    localStorage.removeItem(KEY_STORE); KEY = ""; showLogin(); $("key").value = "";
  });
  if (KEY) load(); else showLogin();
});
