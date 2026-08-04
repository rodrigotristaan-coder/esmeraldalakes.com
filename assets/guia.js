// Guía del huésped: idioma (ES/EN) compartido con el resto del sitio + toggle + índice activo.
(function () {
  var saved = localStorage.getItem("esmeralda_lang");
  var lang = (saved === "es" || saved === "en")
    ? saved
    : ((navigator.language || "es").toLowerCase().indexOf("en") === 0 ? "en" : "es");

  function apply(l) {
    document.documentElement.lang = l;
    document.querySelectorAll("[data-es]").forEach(function (el) {
      var v = el.getAttribute("data-" + l);
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.lang === l);
    });
    localStorage.setItem("esmeralda_lang", l);
  }

  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () { apply(b.dataset.lang); });
  });

  apply(lang);
})();

// Las secciones vienen plegadas: si llegas por el índice (o por un enlace con
// #ancla) hay que abrir la que buscas, o el salto deja al lector en un título
// cerrado sin entender por qué "no está" el contenido.
(function () {
  function abrirDestino() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    // El ancla puede ser la sección misma o algo dentro de ella
    var det = el.closest ? el.closest("details") : null;
    if (el.tagName === "DETAILS") det = el;
    if (det && !det.open) det.open = true;
    // Con la sección ya abierta, el navegador no reposiciona solo
    el.scrollIntoView({ block: "start" });
  }
  window.addEventListener("hashchange", abrirDestino);
  if (location.hash) setTimeout(abrirDestino, 0);
})();
