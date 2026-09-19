// Los avisos que el bot manda SOLO, sin que nadie le escriba.
//
// Por qué existe esto: el panel ya detectaba todo lo que falta capturar —
// estancias sin cobro, limpiezas sin registrar, recibos vencidos— pero había que
// entrar a verlo. Entre el 10-ago y el 15-sep de 2026 nadie entró: 36 días sin
// una sola escritura, dos estancias de Airbnb perdidas (Cristian y Mau) y el
// internet vencido con un huésped sin wifi. El problema nunca fue detectar, era
// entregar. Aquí se arma lo que el bot empuja al grupo.
//
// Vive en un archivo con guion bajo a propósito: Vercel no lo publica como ruta,
// así que no gasta una de las 12 funciones del plan (van 12 de 12).
const crypto = require("crypto");
const {
  getAllBlocks, readBlocks, readFinanceDoc, mutarFinanzas,
  notaKey, aplicarNotas, hoyMx, masDias,
} = require("./_lib");

const AVISOS = "avisos.json";     // qué se avisó ya (para no repetir cada 6 h)
const SERVICIOS = "servicios.json"; // luz, gas, internet, cuota: cada cuándo tocan

// Lo mismo que cobra el panel por recibir y limpiar una salida (admin-app.js).
// Si algún día deja de ser fijo, se cambia en los dos lados.
const COSTO_POR_HUESPED = 500;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
// Para leer: "7-sep".
const fmtD = (ds) => (ds ? `${Number(ds.slice(8, 10))}-${MESES[Number(ds.slice(5, 7)) - 1]}` : "");
// Para el CONCEPTO de un movimiento: "07-sep-2026", exactamente como lo escribe
// el panel (admin-app.js). No es cosmético: el concepto es lo que se compara
// para saber si un gasto ya está registrado. Con el formato corto, las cuatro
// limpiezas de julio y agosto que ya estaban pagadas volvían a aparecer como
// pendientes, y un toque en el botón habría metido $2,000 de gasto duplicado.
const fmtDoc = (ds) => (ds ? `${ds.slice(8, 10)}-${MESES[Number(ds.slice(5, 7)) - 1]}-${ds.slice(0, 4)}` : "");
// Mismo texto que arma el panel, para que los dos lados se reconozcan.
const conceptoEstancia = (b) =>
  `Recepción y limpieza — ${b.name || (b.source === "airbnb" ? "Airbnb" : "Reserva directa")} ${fmtDoc(b.end)}`;
const money = (n) => "$" + (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });
const norm = (s) => String(s || "").trim().toLowerCase();

// --- documentos de apoyo -----------------------------------------------------
// Dos documentos propios en la misma tabla `docs` de Neon. Aparte de
// finance.json a propósito: ahí viven los movimientos de dinero, y meterle
// banderas de control acabó mal la última vez (el tope diario del lector de
// tickets tuvo que salirse a su propio documento por lo mismo).
const { readJsonObj, writeJsonObj } = require("./_lib");
const readDoc = (clave) => readJsonObj(clave);

// Servicios del depa. La semilla sale de lo que está documentado en el CONTEXTO
// del proyecto (cuota el día 10, luz bimestral con último recibo del 7-jul), NO
// de montos inventados: el monto se pregunta al confirmar el pago.
const SERVICIOS_SEMILLA = {
  cuota:     { nombre: "Cuota de mantenimiento", cada: "mes", diaLimite: 10, nota: "después del día 10 sube de $3,900 a $4,300" },
  internet:  { nombre: "Internet (izzi)",        cada: "mes", diaLimite: 10 },
  // Domiciliada (Rodrigo, 19-sep): se cobra sola, así que nunca «vence». Lo único
  // que falta cada bimestre es que alguien diga cuánto fue para registrarlo.
  luz:       { nombre: "Luz (CFE)",              cada: "bimestre", ultimo: "2026-07-07", domiciliado: true },
  gas:       { nombre: "Gas",                    cada: "cuando toca" },
};

async function readServicios() {
  const o = await readDoc(SERVICIOS);
  const out = {};
  for (const [k, base] of Object.entries(SERVICIOS_SEMILLA)) out[k] = { ...base, ...(o[k] || {}) };
  for (const [k, v] of Object.entries(o)) if (!out[k]) out[k] = v;
  return out;
}

// Próxima fecha en que toca un servicio, según cómo se paga.
function venceServicio(s, hoy) {
  if (s.cada === "mes") {
    const dia = String(s.diaLimite || 10).padStart(2, "0");
    const esteMes = `${hoy.slice(0, 7)}-${dia}`;
    // Si ya se pagó el de este mes, el siguiente es el del mes que entra.
    if (s.ultimo && s.ultimo >= `${hoy.slice(0, 7)}-01`) {
      const d = new Date(`${hoy.slice(0, 7)}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return `${d.toISOString().slice(0, 8)}${dia}`;
    }
    return esteMes;
  }
  if (s.cada === "bimestre") {
    if (!s.ultimo) return null;
    const d = new Date(s.ultimo + "T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 2);
    return d.toISOString().slice(0, 10);
  }
  return null; // "cuando toca": el gas no tiene calendario, se avisa a mano
}

// --- el estado del negocio, leído del mismo lugar que el panel ---------------
//
// El panel arma esto en el navegador (admin-app.js). Aquí se rehace del lado del
// servidor porque el bot no tiene navegador — y porque así el aviso no depende de
// que alguien abra la página, que es justo lo que falló.
async function estado() {
  const hoy = hoyMx();
  const [directas, doc] = await Promise.all([readBlocks(), readFinanceDoc()]);
  const notas = doc.notas || {};
  const todos = aplicarNotas(await getAllBlocks(directas), notas);

  // Una estancia de Airbnb desaparece de su iCal en cuanto termina. Si tiene
  // nota, la nota es su único registro: se reconstruye para que el historial no
  // la pierda (mismo criterio que api/admin.js).
  const vistos = new Set(todos.map((b) => notaKey(b.start, b.end)));
  for (const [k, n] of Object.entries(notas)) {
    const [s, e] = k.split("_");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "") || !/^\d{4}-\d{2}-\d{2}$/.test(e || "")) continue;
    if (e >= hoy || vistos.has(k)) continue;
    todos.push({ start: s, end: e, source: "airbnb", ...n });
  }
  return { hoy, todos, movs: doc.movs, recurring: doc.recurring, notas };
}

// ¿Este huésped sigue en el depa después de esta reserva? (alargó la estancia)
const mismoHuesped = (a, b) => !!norm(a.name) && norm(a.name) === norm(b.name);
const sigueDespues = (b, todos) =>
  todos.some((x) => !(x.start === b.start && x.end === b.end) && x.start === b.end && mismoHuesped(x, b));

// --- lo que falta por hacer --------------------------------------------------
//
// Cada renglón trae su propio botón. El `id` es lo que viaja en el callback de
// Telegram, que solo admite 64 bytes: por eso son fechas y claves cortas.
async function pendientes() {
  const { hoy, todos, movs, recurring } = await estado();
  const out = [];

  // 1. Reservas que ya terminaron y no tienen un ingreso a ese nombre.
  const cobrados = new Set(movs.filter((m) => m.type === "in" && m.guest).map((m) => norm(m.guest)));
  for (const b of todos) {
    if (b.source === "airbnb" || !b.name || b.end > hoy) continue;
    if (cobrados.has(norm(b.name))) continue;
    out.push({
      tipo: "cobro", id: `cob|${b.start}_${b.end}`, ico: "💵",
      txt: `${b.name} se fue el ${fmtD(b.end)} y no hay ingreso registrado`,
      boton: `💵 Cobro de ${String(b.name).slice(0, 22)}`,
      prefill: `/ingreso 2000 Reserva ${b.name}`,
    });
  }

  // 2. Recepción y limpieza sin registrar (los $500 de cada salida).
  // Ventana de 60 días atrás a 7 adelante, igual que el panel.
  const desde = masDias(hoy, -60), hasta = masDias(hoy, 7);
  const conceptos = new Set(movs.map((m) => norm(m.concept)));
  for (const b of todos) {
    if (b.end < desde || b.end > hasta || sigueDespues(b, todos)) continue;
    const quien = b.name || (b.source === "airbnb" ? "Airbnb" : "Reserva directa");
    if (conceptos.has(norm(conceptoEstancia(b)))) continue;
    out.push({
      tipo: "limpieza", id: `lim|${b.start}_${b.end}`, ico: "🧹",
      txt: `${quien} (salida ${fmtD(b.end)}): recepción y limpieza ${money(COSTO_POR_HUESPED)}`,
      boton: `🧹 Registrar ${money(COSTO_POR_HUESPED)}`,
    });
  }

  // 3. Movimientos ya registrados pero sin pagar o sin cobrar.
  const porPagar = movs.filter((m) => m.status === "pendiente");
  if (porPagar.length) {
    const total = porPagar.reduce((a, m) => a + (Number(m.amount) || 0), 0);
    out.push({
      tipo: "info", id: "", ico: "💳",
      txt: `${porPagar.length} movimiento${porPagar.length === 1 ? "" : "s"} por pagar o por cobrar · ${money(total)}`,
    });
  }

  // 4. Servicios: los que ya vencieron y los que vencen en 3 días.
  const servicios = await readServicios();
  for (const [clave, s] of Object.entries(servicios)) {
    const vence = venceServicio(s, hoy);
    if (!vence) continue;
    if (s.ultimo && s.ultimo >= vence) continue; // ya se pagó el de este ciclo
    // Domiciliado: no hay nada que pagar, hay que pedir el monto una vez cobrado.
    if (s.domiciliado) {
      if (vence > hoy) continue;
      out.push({
        tipo: "servicio", id: `srv|${clave}`, ico: "💡",
        txt: `${s.nombre}: se cobró sola el ${fmtD(vence)} — ¿cuánto fue el recibo?`,
        boton: `💡 Anotar monto de ${s.nombre.slice(0, 16)}`,
        prefill: `/pague ${clave} `,
      });
      continue;
    }
    const limite = masDias(hoy, 3);
    if (vence > limite) continue;
    const vencido = vence < hoy;
    out.push({
      tipo: "servicio", id: `srv|${clave}`, ico: vencido ? "🔴" : "🟡",
      txt: `${s.nombre}: ${vencido ? `venció el ${fmtD(vence)}` : `vence el ${fmtD(vence)}`}` + (s.nota ? ` (${s.nota})` : ""),
      boton: `✅ Ya pagué ${s.nombre.slice(0, 20)}`,
      prefill: `/pague ${clave} `,
    });
  }

  // 5. Recibos que se saltan meses (la luz es bimestral): si ya pasó su ventana
  // con diez días de gracia y no hay registro nuevo, se avisa aparte.
  for (const r of recurring || []) {
    if (!r.activo || !(r.cadaMeses > 1)) continue;
    const suyos = (movs || []).filter((m) => norm(m.concept) === norm(r.concept)).sort((a, b) => b.date.localeCompare(a.date));
    const ult = suyos[0];
    if (!ult) continue;
    const d = new Date(ult.date + "T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + r.cadaMeses);
    const esperada = d.toISOString().slice(0, 10);
    if (hoy > masDias(esperada, 10)) {
      out.push({
        tipo: "info", id: "", ico: "⚡",
        txt: `${r.concept}: el recibo ya debía haber llegado (el último fue el ${fmtD(ult.date)})`,
      });
    }
  }

  return out;
}

// --- mensajes ----------------------------------------------------------------
// Telegram permite 8 botones cómodos por mensaje; más que eso se vuelve ilegible.
// Si hay más pendientes, el mensaje los lista igual pero solo los ocho primeros
// llevan botón: el resto sale en el siguiente aviso, ya sin los resueltos.
function armarDiario(items) {
  if (!items.length) return null; // sin pendientes no se manda nada
  // Lo que necesita un monto lleva el comando escrito en el propio mensaje.
  // El botón de copiar ayuda, pero no todos los Telegram viejos lo pintan: el
  // comando en el texto se puede copiar a mano siempre, y así el aviso nunca
  // queda sin salida.
  const lineas = items.map((it) => `${it.ico} ${it.txt}` + (it.prefill ? `\n    👉 ${it.prefill}` : ""));
  const botones = [];
  for (const it of items) {
    if (!it.id || !it.boton || botones.length >= 8) continue;
    // Un toque para lo que ya tiene monto fijo; copiar el comando para lo demás.
    if (it.prefill) botones.push([{ text: it.boton, copy_text: { text: it.prefill } }]);
    else botones.push([{ text: it.boton, callback_data: it.id }]);
  }
  return {
    text: `🌴 ESMERALDA — POR HACER\n\n${lineas.join("\n")}`,
    reply_markup: botones.length ? { inline_keyboard: botones } : undefined,
  };
}

// --- guardián de Airbnb ------------------------------------------------------
//
// El iCal de Airbnb borra la estancia en cuanto termina, y no trae nombre ni
// monto. Si nadie la anota mientras existe, desaparece sin dejar rastro: pasó
// con Cristian (21→24 ago) y con Mau (4→7 sep), $0 registrados de las dos.
// Esto revisa cada pocas horas y avisa mientras todavía se puede.
async function airbnbSinNota() {
  const { hoy, notas } = await estado();
  const bloques = await getAllBlocks([]);
  const out = [];
  for (const b of bloques) {
    if (b.source !== "airbnb") continue;
    const k = notaKey(b.start, b.end);
    const n = notas[k];
    const anotada = n && (n.name || n.pagoAnfitrion !== undefined || n.rate !== undefined);
    if (anotada) continue;
    out.push({ ...b, clave: k, termina: b.end, porTerminar: b.end <= masDias(hoy, 3) });
  }
  return out;
}

// --- registrar desde un botón ------------------------------------------------
function movimiento({ type, date, concept, category, amount, guest, status }) {
  return {
    id: crypto.randomBytes(5).toString("hex"),
    type, date, concept, category, amount: Math.round(Number(amount) * 100) / 100,
    ...(guest ? { guest } : {}), ...(status ? { status } : {}),
    at: new Date().toISOString(), via: "telegram",
  };
}

// Registra la recepción y limpieza de una salida. Devuelve lo que se guardó o
// por qué no: el bot enseña ese texto tal cual, para que nadie se quede pensando
// que sí se registró cuando no.
async function registrarLimpieza(clave) {
  const [start, end] = String(clave).split("_");
  const { todos } = await estado();
  const b = todos.find((x) => x.start === start && x.end === end);
  if (!b) return { error: "esa reserva ya no está en el calendario" };
  const concept = conceptoEstancia(b);
  const r = await mutarFinanzas((doc) => {
    if (doc.movs.some((m) => norm(m.concept) === norm(concept))) return { error: "ya estaba registrada" };
    doc.movs.push(movimiento({
      type: "out", date: b.end, concept, category: "Limpieza",
      amount: COSTO_POR_HUESPED, guest: b.name || "",
    }));
  });
  if (r.error) return { error: r.error };
  return { ok: true, texto: `🧹 Registrado: ${concept} · ${money(COSTO_POR_HUESPED)}` };
}

// Marca un servicio como pagado: registra el gasto y mueve su fecha.
async function registrarServicio(clave, monto, fecha) {
  const servicios = await readServicios();
  const s = servicios[clave];
  if (!s) return { error: "no conozco ese servicio" };
  // Domiciliado sin fecha: se registra el día en que se cobró, no el día en que
  // alguien lo anota; si no, el siguiente bimestre se iría recorriendo.
  const cobro = s.domiciliado ? venceServicio(s, hoyMx()) : null;
  const date = fecha || (cobro && cobro <= hoyMx() ? cobro : hoyMx());
  const r = await mutarFinanzas((doc) => {
    doc.movs.push(movimiento({
      type: "out", date, concept: `${s.nombre} ${fmtDoc(date)}`,
      category: "Servicios", amount: monto,
    }));
  });
  if (r.error) return { error: r.error };
  const o = await readDoc(SERVICIOS);
  o[clave] = { ...(o[clave] || {}), ultimo: date, ultimoMonto: Math.round(Number(monto) * 100) / 100 };
  await writeJsonObj(SERVICIOS, o);
  return { ok: true, texto: `✅ ${s.nombre}: ${money(monto)} el ${fmtD(date)}` };
}

// Le pone nombre y depósito a una estancia de Airbnb. Va a `notas`, que es el
// único lugar donde sobrevive: el iCal de Airbnb no trae nombre y borra la
// estancia al terminar. Ojo, NO registra el ingreso: los cobros se confirman
// aparte, uno por uno, para que nada entre a finanzas sin que alguien lo vea.
async function anotarAirbnb(start, end, name, monto) {
  const k = notaKey(start, end);
  const r = await mutarFinanzas((doc) => {
    const previa = doc.notas[k] || {};
    doc.notas[k] = {
      ...previa,
      ...(name ? { name: String(name).slice(0, 80) } : {}),
      ...(monto > 0 ? { pagoAnfitrion: Math.round(Number(monto) * 100) / 100, plataforma: "Airbnb" } : {}),
    };
  });
  if (r.error) return { error: r.error };
  return {
    ok: true,
    texto: `📝 Anotado: Airbnb ${fmtD(start)} → ${fmtD(end)}` +
      (name ? ` · ${name}` : "") + (monto > 0 ? ` · depósito ${money(monto)}` : "") +
      `\nEl ingreso NO se registró: eso se confirma en el panel o con /ingreso.`,
  };
}

// --- a quién se le dice qué --------------------------------------------------
//
// Hay DOS chats y no ven lo mismo (decisión de Rodrigo, 17-sep-2026):
//
//   OWNER_CHAT_ID     grupo de operación, con Biandra. Entradas y salidas,
//                     limpiezas, tickets y transferencias PARA REGISTRAR. Aquí
//                     entra información, pero no sale: nada de ingresos,
//                     utilidad, tarifas ni de cuánto pagó cada huésped.
//   NEGOCIO_CHAT_ID   grupo de negocio, con Laura. Ahí va todo lo de dinero.
//
// Si el de negocio todavía no está configurado, lo de dinero NO se manda al de
// operación: sale un aviso mudo ("hay algo que ver en el panel"). Así no se
// pierde el aviso y tampoco se filtra lo que no toca.
const chatOperacion = () => process.env.OWNER_CHAT_ID || "";
const chatNegocio = () => process.env.NEGOCIO_CHAT_ID || "";
const hayCanalDeNegocio = () => Boolean(chatNegocio());
const esChatDeNegocio = (id) => hayCanalDeNegocio() && String(id) === String(chatNegocio());
const esChatDeOperacion = (id) => String(id) === String(chatOperacion());

// --- memoria de lo ya avisado ------------------------------------------------
const readAvisos = () => readDoc(AVISOS);
async function marcarAviso(campo, valor) {
  const o = await readDoc(AVISOS);
  o[campo] = valor;
  await writeJsonObj(AVISOS, o);
}

module.exports = {
  COSTO_POR_HUESPED, fmtD, fmtDoc, money,
  estado, pendientes, armarDiario, airbnbSinNota, anotarAirbnb,
  readServicios, venceServicio, registrarLimpieza, registrarServicio,
  readAvisos, marcarAviso,
  // canales
  chatOperacion, chatNegocio, hayCanalDeNegocio, esChatDeNegocio, esChatDeOperacion,
};
