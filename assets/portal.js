// Portal de clientes Esmeralda: magic-link (correo → código) + dashboard
// (código de recomendación, noches gratis, historial). Externo por CSP.
(function () {
  var LS = "esmeralda_lang";
  var saved = localStorage.getItem(LS);
  var lang = (saved === "es" || saved === "en")
    ? saved
    : ((navigator.language || "es").toLowerCase().indexOf("en") === 0 ? "en" : "es");

  var T = {
    es: {
      sending: "Enviando…", sent: "Si tu correo está registrado, te enviamos un código.",
      badEmail: "Escribe un correo válido.", cooldown: "Espera unos segundos antes de pedir otro código.",
      checking: "Verificando…", badCode: "Código incorrecto o expirado.", noAccount: "No encontramos una cuenta con reservas para ese correo.",
      fail: "Algo salió mal. Intenta de nuevo.", copied: "¡Copiado!", hello: "Hola",
      nightsUnit: "noches", oneNight: "1 noche", noResv: "Aún no hay reservas registradas.",
      resent: "Código reenviado.",
    },
    en: {
      sending: "Sending…", sent: "If your email is registered, we sent you a code.",
      badEmail: "Enter a valid email.", cooldown: "Wait a few seconds before requesting another code.",
      checking: "Checking…", badCode: "Wrong or expired code.", noAccount: "We couldn't find a booking account for that email.",
      fail: "Something went wrong. Try again.", copied: "Copied!", hello: "Hi",
      nightsUnit: "nights", oneNight: "1 night", noResv: "No bookings yet.",
      resent: "Code resent.",
    },
  };
  var tr = function (k) { return (T[lang] || T.es)[k]; };

  function apply(l) {
    lang = l;
    document.documentElement.lang = l;
    document.querySelectorAll("[data-es]").forEach(function (el) {
      var v = el.getAttribute("data-" + l);
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.lang === l);
    });
    localStorage.setItem(LS, l);
    updateWa();
    if (window.__dash) renderDash(window.__dash); // refresca textos dinámicos
  }
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () { apply(b.dataset.lang); });
  });

  var views = {
    loading: document.getElementById("view-loading"),
    email: document.getElementById("view-email"),
    code: document.getElementById("view-code"),
    noaccount: document.getElementById("view-noaccount"),
    dash: document.getElementById("view-dash"),
  };

  // Link de WhatsApp del socio (con mensaje según idioma)
  var WA_NUMBER = "525650058363";
  function updateWa() {
    var link = document.getElementById("wa-link");
    if (!link) return;
    var msg = lang === "en"
      ? "Hi! I'd like to book the Esmeralda apartment at Diamante Lakes, Acapulco."
      : "¡Hola! Quiero reservar el departamento Esmeralda en Diamante Lakes, Acapulco.";
    link.href = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(msg);
  }
  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].classList.toggle("hidden", k !== name); });
  }

  var emailEl = document.getElementById("p-email");
  var codeEl = document.getElementById("p-code");
  var emailStatus = document.getElementById("email-status");
  var codeStatus = document.getElementById("code-status");
  var currentEmail = "";

  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "status" + (kind ? " status--" + kind : "");
  }

  async function api(path, body) {
    var opts = { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
    if (body) opts.body = JSON.stringify(body);
    var r = await fetch(path, opts);
    var j = {}; try { j = await r.json(); } catch (e) {}
    return { status: r.status, json: j };
  }

  // --- Paso 1: pedir código ---
  views.email.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (document.getElementById("p-company").value) return; // honeypot
    var email = emailEl.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setStatus(emailStatus, tr("badEmail"), "err"); return; }
    var btn = views.email.querySelector("button[type=submit]");
    btn.disabled = true; setStatus(emailStatus, tr("sending"));
    try {
      var res = await api("/api/portal-login", { email: email, lang: lang });
      if (res.status === 429) { setStatus(emailStatus, tr("cooldown"), "err"); return; }
      currentEmail = email;
      setStatus(emailStatus, "");
      // Sin cuenta → se obtiene tras la 1ª reserva con el socio
      if (res.json && res.json.exists === false) { show("noaccount"); apply(lang); return; }
      show("code"); apply(lang);
      setStatus(codeStatus, tr("sent"), "ok");
      codeEl.focus();
    } catch (e2) { setStatus(emailStatus, tr("fail"), "err"); }
    finally { btn.disabled = false; }
  });

  // --- Paso 2: verificar código ---
  views.code.addEventListener("submit", async function (e) {
    e.preventDefault();
    var code = codeEl.value.trim();
    if (!/^\d{6}$/.test(code)) { setStatus(codeStatus, tr("badCode"), "err"); return; }
    var btn = views.code.querySelector("button[type=submit]");
    btn.disabled = true; setStatus(codeStatus, tr("checking"));
    try {
      var res = await api("/api/portal-verify", { email: currentEmail, code: code });
      if (res.status === 200 && res.json.ok) { await loadDash(); return; }
      setStatus(codeStatus, res.json.error === "noaccount" ? tr("noAccount") : tr("badCode"), "err");
    } catch (e2) { setStatus(codeStatus, tr("fail"), "err"); }
    finally { btn.disabled = false; }
  });

  document.getElementById("change-email").addEventListener("click", function () {
    show("email"); apply(lang); setStatus(emailStatus, ""); emailEl.focus();
  });
  document.getElementById("try-other").addEventListener("click", function () {
    emailEl.value = ""; show("email"); apply(lang); setStatus(emailStatus, ""); emailEl.focus();
  });
  document.getElementById("resend").addEventListener("click", async function () {
    if (!currentEmail) { show("email"); return; }
    setStatus(codeStatus, tr("sending"));
    var res = await api("/api/portal-login", { email: currentEmail, lang: lang });
    setStatus(codeStatus, res.status === 429 ? tr("cooldown") : tr("resent"), res.status === 429 ? "err" : "ok");
  });

  // --- Dashboard ---
  function fmtDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return s || "";
    var p = s.split("-");
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(lang === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric" });
  }

  function renderDash(d) {
    window.__dash = d;
    document.getElementById("d-hello").textContent = tr("hello") + (d.name ? ", " + d.name.split(" ")[0] : "") + " 🌴";
    document.getElementById("d-nights").textContent = d.freeNights || 0;
    document.getElementById("d-refs").textContent = d.referrals || 0;
    document.getElementById("d-code").textContent = d.refCode || "—";
    document.getElementById("d-link").value = d.referralLink || "";

    var box = document.getElementById("d-resv");
    box.innerHTML = "";
    if (!d.reservations || !d.reservations.length) {
      box.innerHTML = '<p class="resv__nights">' + tr("noResv") + "</p>";
    } else {
      d.reservations.forEach(function (r) {
        var n = r.nights || 0;
        var nlbl = n === 1 ? tr("oneNight") : (n + " " + tr("nightsUnit"));
        var row = document.createElement("div");
        row.className = "resv__item";
        var left = document.createElement("span");
        left.textContent = fmtDate(r.checkin) + " → " + fmtDate(r.checkout);
        var right = document.createElement("span");
        right.className = "resv__nights";
        right.textContent = nlbl;
        row.appendChild(left); row.appendChild(right);
        box.appendChild(row);
      });
    }
    show("dash"); apply(lang);
  }

  async function loadDash() {
    var r = await fetch("/api/portal-me", { credentials: "same-origin", cache: "no-store" });
    if (r.status !== 200) { show("email"); apply(lang); return false; }
    var d = await r.json();
    if (!d.ok) { show("email"); apply(lang); return false; }
    renderDash(d);
    return true;
  }

  document.getElementById("copy-link").addEventListener("click", function () {
    var inp = document.getElementById("d-link");
    var done = function () {
      var btn = document.getElementById("copy-link");
      var orig = btn.textContent; btn.textContent = tr("copied");
      setTimeout(function () { btn.textContent = orig; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value).then(done, function () { inp.select(); document.execCommand("copy"); done(); });
    } else { inp.select(); document.execCommand("copy"); done(); }
  });

  document.getElementById("logout").addEventListener("click", async function () {
    await fetch("/api/portal-logout", { method: "POST", credentials: "same-origin" });
    window.__dash = null;
    emailEl.value = ""; codeEl.value = ""; currentEmail = "";
    show("email"); apply(lang);
  });

  // Arranque: ¿hay sesión activa?
  apply(lang);
  loadDash().then(function (ok) { if (!ok) { show("email"); apply(lang); } });
})();
