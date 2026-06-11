# Esmeralda · Condominio Diamante Lakes — Landing

Sitio para promocionar el departamento **Esmeralda** en Revolcadero, Puerto Marqués, Acapulco.

## 📂 Estructura
```
esmeralda-landing/
├── index.html        ← la página
├── styles.css        ← estilos
├── script.js         ← configuración + interacciones (EDITA AQUÍ tus links)
├── assets/images/    ← pon aquí tus fotos
├── .gitignore        ← protege secretos (NUNCA subir .env)
└── README.md
```

## ▶️ Ver la página en local
Abre `index.html` en el navegador, o levanta un servidor:
```bash
cd esmeralda-landing
python3 -m http.server 8000
# luego abre http://localhost:8000
```

## ✏️ Qué personalizar ahora
1. **Fotos** → copia tus imágenes a `assets/images/` y reemplaza los placeholders en `index.html` (busca `class="ph"`).
2. **Links** → abre `script.js` y edita el bloque `CONFIG`:
   - `airbnbUrl` — tu anuncio de Airbnb
   - `telegramUser` — tu usuario de Telegram (chat directo)
   - `whatsappNumber` — cuando tengas WhatsApp Business listo

## 🔒 Seguridad
- Las llaves/tokens van SIEMPRE en `.env` (ya está en `.gitignore`).
- Nunca se escriben credenciales en el código del sitio.

## 🗺️ Roadmap
- [x] **Fase 1** — Landing page (info, amenidades, mapas, seguridad, CTAs)
- [ ] **Fase 2** — Disponibilidad (sincronizar iCal de Airbnb) + formulario de reserva
- [ ] **Fase 3** — Bot quincenal de eventos (Arena GNP) → reporte de mercado
- [ ] **Fase 4** — Pagos en línea a tu cuenta (MercadoPago / Stripe / Conekta)
- [ ] **Fase 5** — Bot de Telegram (luego WhatsApp Business)
- [ ] **Fase 6** — Usuarios + programa de lealtad + analítica

### Para avanzar a cada fase necesito de ti
- **Fase 2:** link iCal de exportación de tu calendario de Airbnb.
- **Fase 4:** cuenta de procesador de pagos (tú la creas y verificas con tu banco); me pasas las llaves de forma segura.
- **Fase 5:** token de bot de Telegram (de @BotFather).
- **Fase 6:** decidir hosting con backend (servidor + base de datos).
