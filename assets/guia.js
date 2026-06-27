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
