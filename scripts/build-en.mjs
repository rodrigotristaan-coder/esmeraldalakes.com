// Genera la versión indexable en inglés (/en/index.html) a partir de index.html.
// - Hornea el texto EN en el HTML (Google no depende del toggle de JS)
// - Sustituye head completo: title/meta/OG/canonical/JSON-LD con copy EN para viajeros
// - Absolutiza rutas relativas (assets/, script.js, blog.html) para que funcionen bajo /en/
// - Fija el idioma con <body data-page-lang="en"> (CSP-safe, sin script inline)
// Uso: node scripts/build-en.mjs   → escribe en/index.html (commitear el resultado)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "index.html"), "utf8");

// ---------- 1. Hornear el contenido EN en elementos vacíos con data-en ----------
// Recorre los tags respetando comillas (los data-es/data-en contienen "<strong>" etc.)
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
html = html.replace(TAG_RE, (full, name, attrs, offset) => full); // sanity pass (no-op)

function bakeEnglish(src) {
  let out = "";
  let i = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src))) {
    const [full, name, attrs] = m;
    out += src.slice(i, m.index) + full;
    i = m.index + full.length;
    const en = /\bdata-en="([^"]*)"/.exec(attrs);
    if (!en) continue;
    // ¿El elemento está vacío (solo whitespace hasta su cierre)? → hornear el EN
    const rest = src.slice(i);
    const close = new RegExp("^(\\s*)</" + name + ">");
    const c = close.exec(rest);
    if (c) {
      out += en[1];
      // el cierre se copiará en la siguiente vuelta (no avanzamos i)
    }
  }
  out += src.slice(i);
  return out;
}
html = bakeEnglish(html);

// ---------- 2. Head en inglés (copy para viajeros, no traducción literal) ----------
const swaps = [
  ['<html lang="es">', '<html lang="en">'],
  [
    /<title>[^<]*<\/title>/,
    "<title>Acapulco Vacation Rental · Esmeralda at Diamante Lakes — 2BR Condo, Sleeps 9 | Book Direct</title>",
  ],
  [
    /<meta name="description" content="[^"]*" \/>/,
    '<meta name="description" content="Esmeralda: 2-bedroom vacation rental in Acapulco Diamante (Diamante Lakes, Revolcadero) sleeping up to 9. Lakeside resort with pool, jacuzzi & water slide, minutes from Arena GNP Seguros. Book direct with the host — better rates than Airbnb, no platform fees." />',
  ],
  [
    /<meta name="keywords" content="[^"]*" \/>/,
    '<meta name="keywords" content="Acapulco vacation rental, Acapulco Diamante apartment, lake view condo Acapulco, Airbnb alternative Acapulco, direct booking Acapulco Mexico, condo near Arena GNP Seguros, Revolcadero vacation rental, Acapulco condo sleeps 9, Puerto Marques apartment rental" />',
  ],
  [
    '<link rel="canonical" href="https://esmeraldalakes.com/" />',
    '<link rel="canonical" href="https://esmeraldalakes.com/en/" />',
  ],
  [
    '<link rel="alternate" hreflang="x-default" href="https://esmeraldalakes.com/" />',
    '<link rel="alternate" hreflang="x-default" href="https://esmeraldalakes.com/" />',
  ],
  [
    '<meta property="og:title" content="Esmeralda · Diamante Lakes, Acapulco — cerca de la Arena GNP" />',
    '<meta property="og:title" content="Acapulco Vacation Rental · Esmeralda at Diamante Lakes" />',
  ],
  [
    /<meta property="og:description" content="[^"]*" \/>/,
    '<meta property="og:description" content="Your 2-bedroom home base in Acapulco Diamante: lakeside resort, pool, jacuzzi & water slide, sleeps 9, minutes from Arena GNP. Book direct — no platform fees." />',
  ],
  [
    '<meta property="og:url" content="https://esmeraldalakes.com/" />',
    '<meta property="og:url" content="https://esmeraldalakes.com/en/" />',
  ],
  ['<meta property="og:locale" content="es_MX" />', '<meta property="og:locale" content="en_US" />'],
  ['<meta property="og:locale:alternate" content="en_US" />', '<meta property="og:locale:alternate" content="es_MX" />'],
  [
    /<meta name="twitter:title" content="[^"]*" \/>/,
    '<meta name="twitter:title" content="Acapulco Vacation Rental · Esmeralda at Diamante Lakes — Book Direct" />',
  ],
  [
    /<meta name="twitter:description" content="[^"]*" \/>/,
    '<meta name="twitter:description" content="2-bedroom condo in Acapulco Diamante, sleeps 9. Pool, jacuzzi, water slide, minutes from Arena GNP. Book direct & save vs Airbnb." />',
  ],
  // Fijar idioma de página (CSP no permite <script> inline)
  ['<body>', '<body data-page-lang="en">'],
];
for (const [from, to] of swaps) {
  const before = html;
  html = typeof from === "string" ? html.replace(from, to) : html.replace(from, to);
  if (html === before) console.warn("⚠️  swap sin efecto:", String(from).slice(0, 70));
}

// ---------- 3. JSON-LD en inglés ----------
html = html.replace(
  /"description": "Departamento de renta vacacional[^"]*"/,
  '"description": "Vacation rental apartment for up to 9 guests at Diamante Lakes condominium, Revolcadero, Acapulco Diamante. 2 bedrooms, lakeside resort with pool, jacuzzi, water slide and swim-up bar. Minutes from Arena GNP Seguros, home of major concerts and the Mexican Open (ATP 500). Book direct with the host — no platform fees."'
);
html = html.replace('"@type": "VacationRental",', '"@type": "VacationRental",\n    "inLanguage": ["en", "es"],');
// FAQ JSON-LD → versión EN completa
const faqEn = `{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "Where to stay near the Arena GNP Seguros in Acapulco?",
        "acceptedAnswer": { "@type": "Answer", "text": "The Esmeralda apartment at Diamante Lakes (Revolcadero, Acapulco Diamante) is a few minutes' drive from the Arena GNP Seguros, home of major concerts and the Mexican Open tennis. It sleeps up to 9 guests and has a resort pool, jacuzzi and water slide." } },
      { "@type": "Question", "name": "Is there a good Airbnb alternative in Acapulco with direct booking?",
        "acceptedAnswer": { "@type": "Answer", "text": "Yes — Esmeralda takes direct bookings at esmeraldalakes.com with a live availability calendar. Booking direct means better rates than Airbnb (no platform service fees) and direct contact with the host." } },
      { "@type": "Question", "name": "Are there vacation rentals in Acapulco Diamante for groups or families?",
        "acceptedAnswer": { "@type": "Answer", "text": "Esmeralda at Diamante Lakes has 2 bedrooms and sleeps up to 9, with a fully equipped kitchen and washer — ideal for families and groups visiting Acapulco Diamante." } },
      { "@type": "Question", "name": "How close is Revolcadero Beach?",
        "acceptedAnswer": { "@type": "Answer", "text": "The apartment is in Revolcadero, a short distance from Revolcadero Beach, the Princess Mundo Imperial hotel zone and malls like La Isla Acapulco." } },
      { "@type": "Question", "name": "What time are check-in and check-out?",
        "acceptedAnswer": { "@type": "Answer", "text": "Check-in is at 12:00 PM and check-out at 11:00 AM. Entry is via smart lock: the code is sent to the email and phone used for your booking, close to your arrival date." } },
      { "@type": "Question", "name": "Are pets allowed?",
        "acceptedAnswer": { "@type": "Answer", "text": "Pets are not allowed. Special cases only upon request and with the owner's approval before booking." } },
      { "@type": "Question", "name": "Is smoking allowed?",
        "acceptedAnswer": { "@type": "Answer", "text": "Not inside the apartment; smoking is allowed on the private terrace." } },
      { "@type": "Question", "name": "What are the pool and jacuzzi hours?",
        "acceptedAnswer": { "@type": "Answer", "text": "The pool and jacuzzi areas at Diamante Lakes are open 8:00 AM to 10:00 PM daily." } }
    ]
  }`;
html = html.replace(/\{\s*"@context": "https:\/\/schema\.org",\s*"@type": "FAQPage"[\s\S]*?\n  \}/, faqEn);

// ---------- 4. Absolutizar rutas relativas (la página vive bajo /en/) ----------
html = html
  .replaceAll('src="assets/', 'src="/assets/')
  .replaceAll('href="assets/', 'href="/assets/')
  .replaceAll('srcset="assets/', 'srcset="/assets/')
  .replaceAll(', assets/', ', /assets/')
  .replaceAll('url(assets/', 'url(/assets/')
  .replaceAll('src="script.js"', 'src="/script.js"')
  .replaceAll('href="blog.html"', 'href="/blog.html"')
  .replaceAll('href="gracias.html"', 'href="/gracias.html"');

mkdirSync(join(root, "en"), { recursive: true });
writeFileSync(join(root, "en", "index.html"), html);
console.log("✅ en/index.html generado:", html.length, "bytes");
