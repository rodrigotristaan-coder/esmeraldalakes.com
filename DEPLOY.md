# Despliegue — Esmeralda (web + bot)

Son dos piezas: la **web estática** y el **bot/API**. Se despliegan por separado.

## 1) Web estática (Netlify o Vercel)
La carpeta `esmeralda-landing/` es 100% estática.

**Opción Netlify:** arrastra la carpeta a https://app.netlify.com/drop (o conecta el repo). El archivo `_headers` aplica las cabeceras de seguridad solo.

**Opción Vercel:** `vercel` en la carpeta (o conecta el repo). `vercel.json` aplica las cabeceras.

Tras desplegar tendrás un dominio (ej. `https://esmeralda.netlify.app`).

## 2) Bot + API de reservas (Railway, Render o Fly.io)
La carpeta `esmeralda-bot/` es un servicio Node 18+.

1. Crea un servicio Node apuntando a `esmeralda-bot/`. Comando de inicio: `npm start`.
2. Configura las **variables de entorno** (NO subas `.env`):
   - `TELEGRAM_BOT_TOKEN`
   - `OWNER_CHAT_ID`
   - `PORT` (el que asigne el proveedor) y `HOST=0.0.0.0`
   - `ANTHROPIC_API_KEY` (opcional, estudio de mercado)
   - `AIRBNB_ICAL_URL` (opcional, sincronización de calendario)
3. El proveedor te dará una URL HTTPS (ej. `https://esmeralda-bot.up.railway.app`).

## 3) Conectar web ↔ API
En `esmeralda-landing/script.js`, cambia **una sola línea**:
```js
const API_BASE = "https://TU-URL-DEL-BOT";
```
Vuelve a desplegar la web. Listo: el formulario y el calendario quedan en vivo.

## 4) Checklist de seguridad post-deploy
- [ ] **Rotar el token** de Telegram en @BotFather (se compartió en chat).
- [ ] Confirmar que `.env` **no** está en el repo (ya está en `.gitignore`).
- [ ] La API del bot va por **HTTPS** (el proveedor lo da; si no, ponla detrás de un proxy TLS).
- [ ] (Opcional) Restringir `Access-Control-Allow-Origin` en `esmeralda-bot/src/server.js` a tu dominio web en lugar de `*`.
- [ ] Verificar que la web carga sobre HTTPS y `API_BASE` también es HTTPS (evita mixed content).

## Ya incluido
- Rate-limiting por IP y honeypot anti-bots en `/api/booking`.
- Saneo de Markdown en las notificaciones a Telegram.
- Cabeceras de seguridad (`_headers` / `vercel.json`).
- Secretos solo en `.env` (gitignored).
