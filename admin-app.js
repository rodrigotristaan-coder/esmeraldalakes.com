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
  $("logout").addEventListener("click", () => {
    localStorage.removeItem(KEY_STORE); KEY = ""; showLogin(); $("key").value = "";
  });
  if (KEY) load(); else showLogin();
});
