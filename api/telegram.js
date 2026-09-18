// Webhook de Telegram: botones de confirmación de reserva (doble toque) y
// comandos del anfitrión (/calendario, /ingreso, /gasto).
// Solo actúa sobre el grupo/chat configurado y verifica el secreto del webhook.
//
// Desde el 17-sep-2026 este mismo archivo atiende los avisos que salen SOLOS
// (`?tarea=diario` y `?tarea=airbnb`, que dispara n8n con su propio secreto).
// Van aquí y no en una ruta nueva porque /api está en 12 de 12 funciones del
// plan Hobby: un archivo más y el despliegue truena.
const crypto = require("crypto");
const {
  addBlock, removeBlock, readBlocks, upsertCustomerFromBooking, readFinance, writeFinance,
  getAllBlocks, hoyMx, safeEqual,
} = require("./_lib");
const { sendCalendarPhoto, occupancy, todayAcapulco, ymd } = require("./_calimg");
const avisos = require("./_avisos");

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const money = (n) => "$" + (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });

// /ingreso 4500 Reserva María · /gasto 650 Limpieza salida
// Registra el movimiento en finance.json (el mismo del panel admin) con fecha de hoy.
// `conResumen` en false (grupo de operación): confirma el registro y ya. El
// acumulado del mes es información del negocio y ahí no va.
async function financeCommand(chatId, text, opts = {}) {
  const conResumen = opts.conResumen !== false;
  const m = text.match(/^\/?(ingreso|gasto)\s+\$?\s*(\d[\d.,]*)\s+(.+)$/is);
  if (!m) {
    await tg("sendMessage", { chat_id: chatId, text: "Formato: ingreso 4500 Reserva María\n(o: gasto 650 Limpieza salida). Monto primero, luego el concepto." });
    return;
  }
  const type = m[1].toLowerCase() === "ingreso" ? "in" : "out";
  const amount = Math.round(parseFloat(m[2].replace(/,/g, "")) * 100) / 100;
  const concept = m[3].replace(/\s+/g, " ").trim().slice(0, 120);
  if (!(amount > 0) || amount > 5000000) {
    await tg("sendMessage", { chat_id: chatId, text: "Monto inválido. Ejemplo: /ingreso 4500 Reserva María" });
    return;
  }
  const date = hoyMx(); // hoy en Acapulco (antes era un -6h a mano)
  const movs = await readFinance();
  movs.push({
    id: crypto.randomBytes(5).toString("hex"), type, date, concept,
    category: type === "in" ? "Reserva" : "Otro gasto", amount,
    at: new Date().toISOString(), via: "telegram",
  });
  await writeFinance(movs);
  const linea = `✅ ${type === "in" ? "Ingreso" : "Gasto"} registrado: ${money(amount)} — ${concept} (${date})`;
  if (!conResumen) {
    await tg("sendMessage", { chat_id: chatId, text: linea + "\n¡Gracias! Ya quedó anotado." });
    return;
  }
  // Resumen del mes con el movimiento ya incluido
  const ym = date.slice(0, 7);
  let inM = 0, outM = 0;
  for (const x of movs) if ((x.date || "").slice(0, 7) === ym) { if (x.type === "in") inM += Number(x.amount) || 0; else outM += Number(x.amount) || 0; }
  await tg("sendMessage", { chat_id: chatId, text:
    linea + `\n📊 Este mes: ingresos ${money(inM)} · gastos ${money(outM)} · utilidad ${money(inM - outM)}` });
}

// /resumen — mes + año + ocupación de los próximos 12 meses
async function sendResumen(chatId) {
  const now = todayAcapulco();
  const Y = now.getUTCFullYear(), M = now.getUTCMonth();
  const todayDs = ymd(Y, M, now.getUTCDate());
  const ym = todayDs.slice(0, 7), yy = todayDs.slice(0, 4);
  const [movs, blocks] = await Promise.all([readFinance(), getAllBlocks()]);
  let inM = 0, outM = 0, inY = 0, outY = 0;
  for (const x of movs) {
    const v = Number(x.amount) || 0;
    if ((x.date || "").slice(0, 7) === ym) { if (x.type === "in") inM += v; else outM += v; }
    if ((x.date || "").slice(0, 4) === yy) { if (x.type === "in") inY += v; else outY += v; }
  }
  const occ = occupancy(todayDs, ymd(Y + 1, M, 1), blocks);
  await tg("sendMessage", { chat_id: chatId, text:
    `📊 Esmeralda al ${todayDs}\n\n` +
    `Este mes: ingresos ${money(inM)} · gastos ${money(outM)} · utilidad ${money(inM - outM)}\n` +
    `Año ${yy}: ingresos ${money(inY)} · gastos ${money(outY)} · utilidad ${money(inY - outY)}\n` +
    `🏨 Ocupación 12 meses: ${occ.pct}% (${occ.sold} noche${occ.sold === 1 ? "" : "s"} vendida${occ.sold === 1 ? "" : "s"})` });
}

const MENU_KEYBOARD = { inline_keyboard: [
  [{ text: "📅 Calendario anual", callback_data: "cmd|cal" }, { text: "📊 Resumen", callback_data: "cmd|fin" }],
  [{ text: "💵 Registrar ingreso", callback_data: "cmd|in" }, { text: "💸 Registrar gasto", callback_data: "cmd|out" }],
  [{ text: "📋 Qué falta por hacer", callback_data: "cmd|pend" }, { text: "🔌 Servicios", callback_data: "cmd|srv" }],
] };

// El grupo de operación (con Biandra) ve solo lo suyo: el calendario y la forma
// de mandar un ticket. Nada de dinero del negocio.
const MENU_OPERACION = { inline_keyboard: [
  [{ text: "📅 Calendario", callback_data: "cmd|cal" }],
  [{ text: "🧾 Cómo registrar un ticket", callback_data: "cmd|ticket" }],
] };

// /libre 2026-09-15 2026-09-20 — enseña qué se va a liberar y pide confirmación.
//
// Liberar NO es lo mismo que bloquear: en cuanto las fechas quedan libres,
// Airbnb las lee de /calendar.ics y las puede vender. Por eso va con doble
// toque, igual que el botón de pago recibido.
async function pedirLiberar(chatId, text) {
  const f = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})/);
  if (!f) {
    await tg("sendMessage", { chat_id: chatId, text: "Dime las dos fechas así: /libre 2026-09-15 2026-09-20\n(llegada y salida, tal como están en el calendario)" });
    return;
  }
  const [, start, end] = f;
  const reserva = (await readBlocks()).find((b) => b.start === start && b.end === end);
  if (!reserva) {
    await tg("sendMessage", { chat_id: chatId, text: `No tengo ninguna reserva directa del ${start} al ${end}. Mándame /calendario para ver cuáles hay.` });
    return;
  }
  const quien = reserva.name || "sin nombre";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `¿Libero estas fechas?\n\n🗓 ${start} → ${end}\n👤 ${quien}${reserva.rate ? `\n💵 ${money(reserva.rate)}/noche` : ""}\n\n⚠️ Al liberarlas, Airbnb las va a ver disponibles y las puede vender.`,
    reply_markup: { inline_keyboard: [[
      { text: "✅ Sí, liberar", callback_data: `lib|${start}|${end}` },
      { text: "↩️ Cancelar", callback_data: "nada" },
    ]] },
  });
}

// /bloquear 2026-12-20 2026-12-27 Nombre — al revés que liberar, esto no quita
// nada: en el peor caso sobra un bloqueo y se quita con /libre. Va directo.
async function bloquear(chatId, text) {
  const f = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s*(.*)$/s);
  if (!f) {
    await tg("sendMessage", { chat_id: chatId, text: "Así: /bloquear 2026-12-20 2026-12-27 Nombre del huésped" });
    return;
  }
  const [, start, end, nombre] = f;
  if (!(start < end)) {
    await tg("sendMessage", { chat_id: chatId, text: "La salida tiene que ser después de la llegada." });
    return;
  }
  await addBlock(start, end, { name: (nombre || "").trim().slice(0, 80) });
  await tg("sendMessage", { chat_id: chatId, text: `🔒 Bloqueado ${start} → ${end}${nombre ? ` · ${nombre.trim()}` : ""}` });
  await sendCalendarPhoto(`📅 Así queda el calendario`);
}

// /pague luz 581 [2026-09-17] — registra el gasto del servicio y mueve su fecha.
async function pagarServicio(chatId, text) {
  const m = text.match(/^\/?pagu[eé]\s+(\w+)\s+\$?\s*(\d[\d.,]*)\s*(\d{4}-\d{2}-\d{2})?/i);
  if (!m) {
    await tg("sendMessage", { chat_id: chatId, text: "Así: /pague luz 581\n(o con fecha: /pague luz 581 2026-09-15). Escribe /servicios para ver las claves." });
    return;
  }
  const monto = parseFloat(m[2].replace(/,/g, ""));
  if (!(monto > 0)) {
    await tg("sendMessage", { chat_id: chatId, text: "Revisa el monto." });
    return;
  }
  const r = await avisos.registrarServicio(m[1].toLowerCase(), monto, m[3]);
  await tg("sendMessage", { chat_id: chatId, text: r.error ? `No pude: ${r.error}` : r.texto });
}

async function sendServicios(chatId) {
  const servicios = await avisos.readServicios();
  const hoy = hoyMx();
  const lineas = Object.entries(servicios).map(([clave, s]) => {
    const vence = avisos.venceServicio(s, hoy);
    const estado = !vence ? "cuando llegue el recibo"
      : vence < hoy ? `🔴 venció el ${avisos.fmtD(vence)}`
      : `🟡 vence el ${avisos.fmtD(vence)}`;
    const ultimo = s.ultimo ? ` · último: ${avisos.fmtD(s.ultimo)}${s.ultimoMonto ? ` ${money(s.ultimoMonto)}` : ""}` : "";
    return `• ${clave} — ${s.nombre}: ${estado}${ultimo}`;
  });
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🔌 SERVICIOS DEL DEPA\n\n${lineas.join("\n")}\n\nCuando pagues uno: /pague luz 581`,
  });
}

// /airbnb 2026-11-27 2026-11-30 Nombre 4500 — le pone nombre y depósito a una
// estancia de Airbnb mientras todavía existe en su calendario.
async function anotarAirbnb(chatId, text) {
  const f = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s*(.*)$/s);
  if (!f) {
    await tg("sendMessage", { chat_id: chatId, text: "Así: /airbnb 2026-11-27 2026-11-30 Nombre del huésped 4500" });
    return;
  }
  const [, start, end, resto] = f;
  // El monto es el último número del mensaje; lo demás es el nombre.
  const mMonto = String(resto).match(/(\d[\d.,]*)\s*$/);
  const monto = mMonto ? parseFloat(mMonto[1].replace(/,/g, "")) : 0;
  const name = String(resto).replace(/(\d[\d.,]*)\s*$/, "").trim();
  if (!name && !(monto > 0)) {
    await tg("sendMessage", { chat_id: chatId, text: "Dime al menos el nombre o el depósito: /airbnb 2026-11-27 2026-11-30 Nombre 4500" });
    return;
  }
  const r = await avisos.anotarAirbnb(start, end, name, monto);
  await tg("sendMessage", { chat_id: chatId, text: r.error ? `No pude: ${r.error}` : r.texto });
}

// Lo que falta por hacer, a demanda. Es el mismo texto del aviso de las 8:00.
async function sendPendientes(chatId) {
  const items = await avisos.pendientes();
  const msg = avisos.armarDiario(items);
  if (!msg) {
    await tg("sendMessage", { chat_id: chatId, text: "✅ Todo al día: no hay nada pendiente por capturar." });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, ...msg });
}

// --- avisos programados (los dispara n8n, no Telegram) -----------------------
//
// `diario`: una vez al día, todo lo que falta capturar, con un botón por renglón.
//           Si no hay nada pendiente NO manda mensaje: un aviso que llega
//           siempre se vuelve ruido y se deja de leer.
// `airbnb`: cada pocas horas, las estancias de Airbnb que siguen sin nombre ni
//           monto. El iCal las borra al terminar; después ya no hay de dónde.
async function correrTarea(tarea) {
  // Los dos avisos son de dinero: van al canal de negocio. Si todavía no está
  // configurado, no se mandan a ningún lado — antes que soltarlos en el grupo
  // de operación, se quedan sin mandar y queda dicho en la respuesta.
  const chatId = avisos.chatNegocio();
  const hoy = hoyMx();
  if (!chatId) return { ok: false, error: "falta NEGOCIO_CHAT_ID: no hay dónde mandar lo de dinero" };

  if (tarea === "diario") {
    const estado = await avisos.readAvisos();
    if (estado.diario === hoy) return { ok: true, saltado: "ya se mandó hoy" };
    const items = await avisos.pendientes();
    const msg = avisos.armarDiario(items);
    if (!msg) {
      await avisos.marcarAviso("diario", hoy);
      return { ok: true, pendientes: 0 };
    }
    const r = await tg("sendMessage", { chat_id: chatId, ...msg });
    if (!r.ok) {
      // Sin marcar: que el siguiente intento lo vuelva a mandar. Un aviso que se
      // pierde en silencio es justo lo que este proyecto ya vivió.
      const detalle = await r.text().catch(() => "");
      console.error("aviso diario:", r.status, detalle.slice(0, 300));
      return { ok: false, error: `telegram ${r.status}`, detalle: detalle.slice(0, 300) };
    }
    await avisos.marcarAviso("diario", hoy);
    return { ok: true, pendientes: items.length };
  }

  if (tarea === "airbnb") {
    const sinNota = await avisos.airbnbSinNota();
    const estado = await avisos.readAvisos();
    const ya = estado.airbnb || {};
    let mandados = 0;
    for (const b of sinNota) {
      // Se avisa una vez al aparecer y otra cuando está por terminar, que es la
      // última oportunidad de anotarla antes de que el iCal la borre.
      const etapa = b.porTerminar ? "termina" : "nueva";
      if (ya[b.clave] === etapa || ya[b.clave] === "termina") continue;
      await tg("sendMessage", {
        chat_id: chatId,
        text: (etapa === "termina"
          ? `⏳ ÚLTIMA LLAMADA — Airbnb\nEsta estancia termina el ${avisos.fmtD(b.end)} y después desaparece del calendario de Airbnb para siempre.`
          : `🆕 Estancia nueva de Airbnb`) +
          `\n\n🗓 ${b.start} → ${b.end}\n\n¿De quién es y cuánto te depositaron? Sin eso, esta estancia no queda en ningún lado (ya pasó con Cristian y con Mau).`,
        reply_markup: { inline_keyboard: [[
          { text: "✍️ Anotar quién y cuánto", switch_inline_query_current_chat: `/airbnb ${b.start} ${b.end} nombre monto` },
        ]] },
      });
      ya[b.clave] = etapa;
      mandados++;
    }
    await avisos.marcarAviso("airbnb", ya);
    return { ok: true, avisadas: mandados, sinNota: sinNota.length };
  }

  return { ok: false, error: "tarea desconocida" };
}

module.exports = async (req, res) => {
  // Entrada de los avisos programados. Va ANTES del secreto de Telegram porque
  // no viene de Telegram: la llama n8n con el secreto del proyecto.
  const tarea = (req.query || {}).tarea;
  if (tarea) {
    const esperado = process.env.ESM_N8N_SECRET || "";
    const dado = req.headers["x-esm-secret"] || "";
    if (!esperado || !safeEqual(String(dado), esperado)) return res.status(401).json({ ok: false });
    try {
      return res.status(200).json(await correrTarea(String(tarea)));
    } catch (e) {
      console.error("tarea " + tarea + ":", e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Verifica que el llamado venga de Telegram (secreto del webhook)
  if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false });
  }

  // Comandos. Dos canales con permisos distintos: el de operación (con Biandra)
  // registra cosas pero no recibe números del negocio; el de negocio (con Laura)
  // ve todo. Ver el bloque de canales en _avisos.js.
  const msg = (req.body || {}).message;
  if (msg && msg.text) {
    const chatId = msg.chat && msg.chat.id;
    const esNegocio = avisos.esChatDeNegocio(chatId);
    const esOperacion = avisos.esChatDeOperacion(chatId);
    // Solo el canal de negocio ve números. Si todavía no existe, NADIE los ve
    // por Telegram: es preferible quedarse sin el dato a soltarlo en el grupo
    // equivocado, que es justo lo que se pidió el 17-sep.
    const mandaTodo = esNegocio;
    const autorizado = esNegocio || esOperacion;
    const text = msg.text.trim();

    // Lo que pide números del negocio y se pidió en el grupo de Biandra: no se
    // contesta ahí. Se dice dónde, sin soltar el dato.
    const soloNegocio = async () => {
      await tg("sendMessage", { chat_id: chatId, text: "Eso va en el canal de negocio, no aquí 🙂" });
    };

    // Los comandos funcionan con o sin "/" (las palabras sueltas deben ser el mensaje completo)
    if (autorizado && /^\/?(calendario|calendar)\s*$/i.test(text)) {
      // El calendario sí: quién llega y quién sale es justo lo que Biandra necesita.
      await sendCalendarPhoto("📅 Calendario al día de hoy", chatId);
    } else if (autorizado && /^\/?gasto\b/i.test(text)) {
      // Un gasto se registra desde los dos lados (tickets, transferencias,
      // encargos). En el de operación se confirma SIN el resumen del mes.
      await financeCommand(chatId, text, { conResumen: mandaTodo });
    } else if (autorizado && /^\/?ingreso\b/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await financeCommand(chatId, text, { conResumen: true });
    } else if (autorizado && /^\/?resumen\s*$/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await sendResumen(chatId);
    } else if (autorizado && /^\/?libre\b/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await pedirLiberar(chatId, text);
    } else if (autorizado && /^\/?bloquear\b/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await bloquear(chatId, text);
    } else if (autorizado && /^\/?servicios\s*$/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await sendServicios(chatId);
    } else if (autorizado && /^\/?pagu[eé]\b/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await pagarServicio(chatId, text);
    } else if (autorizado && /^\/?(pendientes|falta)\s*$/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await sendPendientes(chatId);
    } else if (autorizado && /^\/?airbnb\b/i.test(text)) {
      if (!mandaTodo) return soloNegocio(), res.status(200).json({ ok: true });
      await anotarAirbnb(chatId, text);
    } else if (autorizado && /^\/?(quiensoy|aqui|aquí)\s*$/i.test(text)) {
      // `/aqui` en el grupo nuevo devuelve su id, que es lo que hay que pegar en
      // NEGOCIO_CHAT_ID. `/quiensoy` da además el id de la persona.
      const u = msg.from || {};
      await tg("sendMessage", { chat_id: chatId, text:
        `El id de este chat es ${chatId}.\nTu id de Telegram es ${u.id}${u.first_name ? ` (${u.first_name})` : ""}.\n` +
        `Este chat es: ${esNegocio ? "el de negocio" : "el de operación"}.` });
    } else if (autorizado && /^\/?(menu|menú|start|ayuda|hola)\s*$/i.test(text)) {
      await tg("sendMessage", { chat_id: chatId, text: "¿Qué necesitas? 🌴",
        reply_markup: mandaTodo ? MENU_KEYBOARD : MENU_OPERACION });
    } else if (autorizado && /^\//.test(text)) {
      await tg("sendMessage", { chat_id: chatId, text: mandaTodo
        ? "Comandos:\n🌴 /menu — botones de todo\n📅 /calendario — foto del calendario al día\n📊 /resumen — mes, año y ocupación\n📋 /pendientes — qué falta por capturar\n" +
          "💵 /ingreso 4500 Reserva María\n💸 /gasto 650 Limpieza salida\n🔌 /servicios — luz, gas, internet, cuota\n✅ /pague luz 581\n" +
          "🔓 /libre 2026-09-15 2026-09-20 — liberar fechas\n🔒 /bloquear 2026-12-20 2026-12-27 Nombre\n🏠 /airbnb 2026-11-27 2026-11-30 Nombre 4500"
        : "Comandos de este grupo:\n📅 /calendario — quién llega y quién sale\n💸 /gasto 650 Cloro y bolsas — para registrar un ticket o una transferencia\n🌴 /menu" });
    }
    return res.status(200).json({ ok: true });
  }

  const cq = (req.body || {}).callback_query;
  if (!cq) return res.status(200).json({ ok: true });

  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const msgId = cq.message && cq.message.message_id;
  const [action, ci, co, lang] = String(cq.data || "").split("|");
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});

  // Los dos chats pueden tocar botones, pero no los mismos: lo que mueve dinero
  // del negocio (cobros, servicios, liberar fechas, confirmar un pago) es solo
  // del canal de negocio.
  const esNegocioCb = avisos.esChatDeNegocio(chatId);
  const esOperacionCb = avisos.esChatDeOperacion(chatId);
  if (!esNegocioCb && !esOperacionCb) {
    await answer("No autorizado");
    return res.status(200).json({ ok: true });
  }
  const soloNegocioCb = ["cob", "srv", "lib", "ask", "do"].includes(action) ||
    (action === "cmd" && ["fin", "pend", "srv", "in"].includes(ci));
  if (soloNegocioCb && !esNegocioCb) {
    await answer("Eso va en el canal de negocio");
    return res.status(200).json({ ok: true });
  }

  try {
    // Botones del /menu
    if (action === "cmd") {
      if (ci === "cal") { await answer("Va 📅"); await sendCalendarPhoto("📅 Calendario al día de hoy", chatId); }
      else if (ci === "fin") { await answer(); await sendResumen(chatId); }
      else if (ci === "pend") { await answer(); await sendPendientes(chatId); }
      else if (ci === "srv") { await answer(); await sendServicios(chatId); }
      else if (ci === "ticket") {
        await answer();
        await tg("sendMessage", { chat_id: chatId, text:
          "Para registrar un gasto, escríbeme así:\n\n/gasto 650 Cloro, bolsas y suavitel\n\n" +
          "Primero el monto, luego qué fue. Si mandas la transferencia o el ticket, ponlo igual y queda anotado." });
      }
      else if (ci === "in") { await answer(); await tg("sendMessage", { chat_id: chatId, text: "Escríbeme: /ingreso 4500 Reserva María\n(monto primero, luego el concepto)" }); }
      else if (ci === "out") { await answer(); await tg("sendMessage", { chat_id: chatId, text: "Escríbeme: /gasto 650 Limpieza salida\n(monto primero, luego el concepto)" }); }
      else await answer();
      return res.status(200).json({ ok: true });
    }
    // Botón del aviso diario: registra la recepción y limpieza de una salida.
    if (action === "lim") {
      const r = await avisos.registrarLimpieza(ci);
      await answer(r.error ? `No pude: ${r.error}` : "Registrado ✅");
      await tg("sendMessage", { chat_id: chatId, text: r.error ? `⚠️ ${r.error}` : r.texto });
      return res.status(200).json({ ok: true });
    }

    // Segundo toque de /libre: aquí sí se quitan las fechas.
    if (action === "lib") {
      const antes = await readBlocks();
      const reserva = antes.find((b) => b.start === ci && b.end === co);
      await removeBlock(ci, co);
      await tg("editMessageReplyMarkup", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: `🔓 Liberado ${ci} → ${co}`, callback_data: "nada" }]] },
      });
      await answer("Fechas liberadas");
      await sendCalendarPhoto(`📅 Calendario con ${ci} → ${co} ya libre${reserva && reserva.name ? ` (era de ${reserva.name})` : ""}`);
      return res.status(200).json({ ok: true });
    }

    if (action === "nada") { await answer(); return res.status(200).json({ ok: true }); }

    if (action === "ask") {
      // Botón "Pago recibido" → pide una confirmación antes de disparar toda la cadena
      await tg("editMessageReplyMarkup", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[
          { text: "✅ Sí, registrar pago", callback_data: `do|${ci}|${co}|${lang || "es"}` },
          { text: "↩️ Cancelar", callback_data: `no|${ci}|${co}|${lang || "es"}` },
        ]] },
      });
      await answer("Esto bloquea las fechas, manda el correo al huésped y crea el evento en tu calendario");
    } else if (action === "do") {
      // Cadena completa: bloquea fechas + correo de confirmación + evento de calendario (vía n8n)
      const text = (cq.message && cq.message.text) || "";
      const email = (text.match(/Correo:\s*([^\s]+@[^\s]+)/i) || [])[1];
      const name = (text.match(/Nombre:\s*(.+)/i) || [])[1] || "";
      const guests = (text.match(/Hu[eé]spedes:\s*(\d+)/i) || [])[1] || "";
      const nights = (text.match(/\((\d+)\s*noches?\)/i) || [])[1] || "";
      const refcode = (text.match(/C[oó]digo ref:\s*(ESM-[A-Z0-9]+)/i) || [])[1] || "";
      await addBlock(ci, co, { name, guests });
      let mailNote = "";
      if (email && process.env.N8N_POSTPAGO_WEBHOOK) {
        await fetch(process.env.N8N_POSTPAGO_WEBHOOK, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, checkin: ci, checkout: co, nights, guests, lang: lang || "es", secret: process.env.ESM_N8N_SECRET || "" }),
        });
        mailNote = " · 📧 correo + 📅 calendario";
      }
      // Alta/actualización del cliente en el portal (+ noche gratis al referidor si aplica)
      let portalNote = "";
      if (email) {
        try {
          const r = await upsertCustomerFromBooking({ email, name, checkin: ci, checkout: co, nights, guests, refCode: refcode });
          if (r.ok) portalNote = " · 👤 portal" + (refcode ? " 🎟" : "");
        } catch (e) { console.error("upsertCustomer:", e.message); }
      }
      await tg("editMessageReplyMarkup", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: `✅ Pago recibido · ${ci} → ${co} bloqueado${mailNote}${portalNote}`, callback_data: "done" }]] },
      });
      await answer("¡Pago registrado, fechas bloqueadas y confirmación enviada! 🌴");
      // Pantallazo del calendario ya con la reserva bloqueada (best-effort)
      await sendCalendarPhoto(`📅 Así queda el calendario con la reserva de ${name || "el huésped"} (${ci} → ${co})`);
    } else if (action === "no") {
      await tg("editMessageReplyMarkup", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: "💰 Pago recibido", callback_data: `ask|${ci}|${co}|${lang || "es"}` }]] },
      });
      await answer("Cancelado");
    } else {
      await answer();
    }
  } catch (e) {
    await answer("Error: " + e.message);
  }
  return res.status(200).json({ ok: true });
};
