// Webhook de Telegram: maneja los botones de confirmación de reserva (doble toque).
// Solo actúa sobre el grupo/chat configurado y verifica el secreto del webhook.
const { addBlock } = require("./_lib");

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
  const [action, ci, co] = String(cq.data || "").split("|");
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});

  // Solo el grupo/chat configurado puede confirmar
  if (String(chatId) !== String(process.env.OWNER_CHAT_ID)) {
    await answer("No autorizado");
    return res.status(200).json({ ok: true });
  }

  try {
    if (action === "ask") {
      await tg("editMessageReplyMarkup", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[
          { text: "✅ Sí, bloquear", callback_data: `do|${ci}|${co}` },
          { text: "↩️ Cancelar", callback_data: `no|${ci}|${co}` },
        ]] },
      });
      await answer("Confirma para bloquear estas fechas");
    } else if (action === "do") {
      await addBlock(ci, co);
      await tg("editMessageReplyMarkup", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: `✅ CONFIRMADA · ${ci} → ${co}`, callback_data: "done" }]] },
      });
      await answer("¡Reserva confirmada y fechas bloqueadas! 🌴");
    } else if (action === "no") {
      await tg("editMessageReplyMarkup", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: "✅ Confirmar reserva", callback_data: `ask|${ci}|${co}` }]] },
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
