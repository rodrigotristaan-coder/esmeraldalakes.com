// Webhook de Telegram: botones de confirmación de reserva (doble toque) y
// comandos del anfitrión (/calendario, /ingreso, /gasto).
// Solo actúa sobre el grupo/chat configurado y verifica el secreto del webhook.
const crypto = require("crypto");
const { addBlock, upsertCustomerFromBooking, readFinance, writeFinance, getAllBlocks } = require("./_lib");
const { sendCalendarPhoto, occupancy, todayAcapulco, ymd } = require("./_calimg");

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
async function financeCommand(chatId, text) {
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
  const date = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // hoy en Acapulco
  const movs = await readFinance();
  movs.push({
    id: crypto.randomBytes(5).toString("hex"), type, date, concept,
    category: type === "in" ? "Reserva" : "Otro gasto", amount,
    at: new Date().toISOString(), via: "telegram",
  });
  await writeFinance(movs);
  // Resumen del mes con el movimiento ya incluido
  const ym = date.slice(0, 7);
  let inM = 0, outM = 0;
  for (const x of movs) if ((x.date || "").slice(0, 7) === ym) { if (x.type === "in") inM += Number(x.amount) || 0; else outM += Number(x.amount) || 0; }
  await tg("sendMessage", { chat_id: chatId, text:
    `✅ ${type === "in" ? "Ingreso" : "Gasto"} registrado: ${money(amount)} — ${concept} (${date})\n` +
    `📊 Este mes: ingresos ${money(inM)} · gastos ${money(outM)} · utilidad ${money(inM - outM)}` });
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
] };

module.exports = async (req, res) => {
  // Verifica que el llamado venga de Telegram (secreto del webhook)
  if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false });
  }

  // Comandos del anfitrión (solo OWNER_CHAT_ID)
  const msg = (req.body || {}).message;
  if (msg && msg.text) {
    const isOwner = String(msg.chat && msg.chat.id) === String(process.env.OWNER_CHAT_ID);
    const text = msg.text.trim();
    // Los comandos funcionan con o sin "/" (las palabras sueltas deben ser el mensaje completo)
    if (isOwner && /^\/?(calendario|calendar)\s*$/i.test(text)) {
      await sendCalendarPhoto("📅 Calendario al día de hoy");
    } else if (isOwner && /^\/?(ingreso|gasto)\b/i.test(text)) {
      await financeCommand(msg.chat.id, text);
    } else if (isOwner && /^\/?resumen\s*$/i.test(text)) {
      await sendResumen(msg.chat.id);
    } else if (isOwner && /^\/?(menu|menú|start|ayuda|hola)\s*$/i.test(text)) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "¿Qué necesitas? 🌴", reply_markup: MENU_KEYBOARD });
    } else if (isOwner && /^\//.test(text)) {
      await tg("sendMessage", { chat_id: msg.chat.id, text:
        "Comandos:\n🌴 /menu — botones de todo\n📅 /calendario — foto del calendario al día\n📊 /resumen — mes, año y ocupación\n💵 /ingreso 4500 Reserva María\n💸 /gasto 650 Limpieza salida" });
    }
    return res.status(200).json({ ok: true });
  }

  const cq = (req.body || {}).callback_query;
  if (!cq) return res.status(200).json({ ok: true });

  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const msgId = cq.message && cq.message.message_id;
  const [action, ci, co, lang] = String(cq.data || "").split("|");
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});

  // Solo el grupo/chat configurado puede confirmar
  if (String(chatId) !== String(process.env.OWNER_CHAT_ID)) {
    await answer("No autorizado");
    return res.status(200).json({ ok: true });
  }

  try {
    // Botones del /menu
    if (action === "cmd") {
      if (ci === "cal") { await answer("Va 📅"); await sendCalendarPhoto("📅 Calendario al día de hoy"); }
      else if (ci === "fin") { await answer(); await sendResumen(chatId); }
      else if (ci === "in") { await answer(); await tg("sendMessage", { chat_id: chatId, text: "Escríbeme: /ingreso 4500 Reserva María\n(monto primero, luego el concepto)" }); }
      else if (ci === "out") { await answer(); await tg("sendMessage", { chat_id: chatId, text: "Escríbeme: /gasto 650 Limpieza salida\n(monto primero, luego el concepto)" }); }
      else await answer();
      return res.status(200).json({ ok: true });
    }
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
