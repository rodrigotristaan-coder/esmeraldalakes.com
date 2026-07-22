// Webhook de Telegram: maneja los botones de confirmación de reserva (doble toque).
// Solo actúa sobre el grupo/chat configurado y verifica el secreto del webhook.
const { addBlock, upsertCustomerFromBooking } = require("./_lib");
const { sendCalendarPhoto } = require("./_calimg");

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

module.exports = async (req, res) => {
  // Verifica que el llamado venga de Telegram (secreto del webhook)
  if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false });
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
