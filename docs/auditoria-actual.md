# Auditoría visual — cotorreo-app

**Fecha:** 16 mayo 2026
**Versión auditada:** main @ commit e1e776a
**Auditor:** Claude (asistido por Vicente)

---

## 1. Stack real

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | HTML5 + CSS plano + Vanilla JS | Sin frameworks, sin build step |
| CSS | Un solo archivo `styles.css` (475 líneas) | Usa CSS custom properties (`:root vars`) |
| JS | `common.js` compartido + scripts inline por página | Sin módulos, sin bundler |
| Backend | Node.js + Express | Sirve frontend estático desde `/public` |
| Auth | JWT en localStorage | 24h TTL |
| Iconografía actual | **Emojis Unicode** | Sin librería de iconos |
| Fuentes | System font stack (`-apple-system, Segoe UI, Roboto...`) | Sin fuentes custom cargadas |

**Total código:** 3,774 líneas (1,538 HTML + 475 CSS + 124 JS frontend + 1,637 backend).

---

## 2. Estructura de archivos

```
cotorreo-app/
├── public/
│   ├── index.html          (31 líneas)   Landing
│   ├── login.html          (133 líneas)  PIN pad staff
│   ├── cliente.html        (388 líneas)  Form público
│   ├── lili.html           (476 líneas)  Operativo Lili
│   ├── maestro.html        (164 líneas)  Panel maestro
│   ├── gerencia.html       (156 líneas)  Dashboard $
│   ├── restaurante.html    (270 líneas)  Saloneros
│   ├── css/styles.css      (475 líneas)  Único stylesheet
│   └── js/common.js        (124 líneas)  Auth + helpers
└── server/
    ├── index.js, airtable.js, auth.js
    └── routes/{public,lili,maestro,gerencia}.js
```

---

## 3. Tokens implícitos (lo que se repite hoy)

### 3.1 Colores actuales

La app **NO usa la paleta de marca Cotorreo todavía**. Hoy usa una paleta "warm cream" heredada de los manuales PDF:

| Token actual | HEX | Propósito hoy |
|---|---|---|
| `--primary` | `#0d4a4e` | Teal oscuro (header, botones primarios) |
| `--primary-light` | `#1a6b70` | Gradiente con primary |
| `--gold` | `#d4a056` | Acento dorado |
| `--gold-light` | `#f0d9a8` | Sección eyebrow |
| `--cream` | `#faf7f2` | Fondo página |
| `--paper` | `#ffffff` | Fondo cards |
| `--ink` | `#1a2426` | Texto primario |
| `--ink-soft` | `#4a5759` | Texto secundario |
| `--border` | `#e8e2d6` | Bordes |
| `--green` | `#2d8a47` | Estado éxito |
| `--green-soft` | `#e6f4ea` | Fondo éxito |
| `--amber` / `--amber-soft` | `#b87333` / `#fcf2e1` | Estado advertencia |
| `--red` / `--red-soft` | `#c53030` / `#fce8e6` | Estado error |
| `--coral` | `#e85a4f` | Botones danger |
| `--blue` / `--blue-soft` | `#2c5282` / `#ebf4ff` | Info |

**Total:** 18 colores hardcoded. No siguen la paleta Cotorreo real.

### 3.2 Tipografía actual

- **Familia**: system font stack (sin fuente custom)
- **Tamaños usados**: 11, 12, 13, 14, 15, 16, 18, 24, 28, 32, 36 px
- **Pesos**: 400 (default), 500, 600, 700, sin sistema fijo
- **Line-height**: `1.5` global, `1.2` y `1.25` en headings

### 3.3 Espaciado

Sin sistema de escala. Se observan estos valores en paddings:
`6, 10, 11, 12, 14, 16, 20, 24, 30` px — todos hardcoded.

### 3.4 Border-radius

`6, 8, 10, 12, 50%, 999px`. Dentro del límite del brief (max 16px en elementos).

### 3.5 Box-shadows

Solo 3 niveles:
- `0 1px 3px rgba(0,0,0,0.04)` — cards normales
- `0 2px 8px rgba(0,0,0,0.1)` — header sticky
- `0 4px 12px rgba(13,74,78,0.1)` — landing options hover

✓ Bien, dentro del límite "máximo 3 niveles".

### 3.6 Emojis decorativos

Uso **abundante** de emojis Unicode como reemplazo de iconos:
🎾 🍽️ 📅 🔑 📱 ✅ ❌ ⚠️ 🎂 🆕 ⏰ 🔁 👥 🎓 📊 📋 👋 👻 🌞 🏟️ 🎉 🎁 🚫 💳 📦 🔔 🌟

Total: ~150 ocurrencias distribuidas por las 7 páginas. Algunos son decorativos (deben reemplazarse por iconos Lucide), otros son emocionales (se conservan: ✅ confirmación, 🎂 cumpleaños).

---

## 4. Inconsistencias detectadas

### Críticas (afectan percepción de marca)

| # | Problema | Impacto |
|---|---|---|
| 1 | **Paleta NO es Cotorreo** — usa teal oscuro genérico, no el teal #1FA890 de la marca | Marca ausente, identidad genérica |
| 2 | **Logos ausentes** — solo emojis 🎾 y 🍽️ representan los negocios | Brand recognition débil |
| 3 | **Iconografía mixta emoji + sin sistema** — emojis no siempre se ven igual entre OS | Inconsistencia visual cross-device |
| 4 | **Sin fuente custom** — system stack se ve distinto en iPhone vs Android vs Windows | Falta de cohesión |

### Moderadas (afectan jerarquía y legibilidad)

| # | Problema | Impacto |
|---|---|---|
| 5 | Escala tipográfica sin sistema modular | Tamaños cercanos (13, 14, 15) sin diferencia clara |
| 6 | Espaciados ad-hoc (`6, 10, 11, 12, 14, 16...`) | Imposible mantener consistencia al agregar componentes |
| 7 | Focus state solo cambia color de borde, sin box-shadow | Accesibilidad débil para usuarios con tab keyboard |
| 8 | Color de texto solo 2 niveles (ink, ink-soft) | Falta nivel terciario para hints/labels secundarios |
| 9 | `landing-option` reusado como botón de selección en cliente.html | Misma anatomía con propósitos distintos confunde |

### Menores (pulido)

| # | Problema | Impacto |
|---|---|---|
| 10 | `font-size: 11px` aparece en KPIs y badges | Más chico que mínimo legible recomendado (12px) |
| 11 | Botones de acción inline con tabla de reservas | Mucho contenido en una sola línea en móvil |
| 12 | `border-radius: 12px` en inputs convive con `8px` en otros | Inconsistencia menor |
| 13 | Sin loading skeleton — solo "Cargando..." con animación dots | Funcional pero genérico |
| 14 | Sin transition global en hover/focus | Cambios bruscos |

### No son problemas (clarificaciones)

| # | Patrón | Por qué está bien |
|---|---|---|
| - | Sticky header con gradient | Funcional, claro, no agresivo |
| - | Cards con border + shadow ligera | Limpio, no neumorphism |
| - | PIN pad con teclado 3x4 | Estándar móvil, claro |

---

## 5. Estimación de esfuerzo

### Pantallas a refinar (7)

| # | Pantalla | Estado actual | Complejidad refactor |
|---|---|---|---|
| 1 | `index.html` | 31 líneas, simple | Baja (~20 min) |
| 2 | `cliente.html` paso "selección" | Card con 2 botones grandes | Baja (~30 min, requiere logos) |
| 3 | `cliente.html` paso "WhatsApp" | Form simple | Baja (~20 min) |
| 4 | `cliente.html` form Alpadel | 9 campos, agrupación a hacer | Media (~45 min) |
| 5 | `cliente.html` form Plaza | 9 campos, agrupación + área | Media (~45 min) |
| 6 | `cliente.html` confirmación | Card de éxito básica | Media (~30 min, refinar resumen) |
| 7 | `login.html` PIN pad | Funcional, falta pulido | Baja (~25 min) |

**Total tiempo dev:** ~3.5 horas de Claude + revisión + ajustes
**Total tiempo Vicente:** ~1.5 horas (revisar 7 previews + dar OK)

### Trabajo previo (PASOS 2 y 3)

| Tarea | Tiempo |
|---|---|
| Sistema de diseño (`design-system.md` + `tokens.css`) | 45 min |
| Backups de archivos a modificar | 10 min |
| Documento de recomendaciones de producto | 15 min |

### Pantallas fuera del scope inicial

Estas las dejamos para una segunda iteración (no están en el PASO 4 del brief):
- `lili.html` (panel operativo, 476 líneas — el más grande)
- `maestro.html`
- `gerencia.html`
- `restaurante.html`

Si más adelante quieres incluirlas, son ~3 horas más.

---

## 6. Decisiones técnicas que tomo (con tu OK)

1. **No agrego Tailwind ni framework CSS** — refino el CSS plano con un sistema de tokens. Ya está confirmado.
2. **Lucide para iconos**, inline SVG, controlados por `currentColor`. Filesize ~1KB por icono.
3. **Inter como fuente principal**, vía Google Fonts. 2 pesos: 400 (regular) y 600 (semibold). Fallback `system-ui`.
4. **Mantengo CSS plano organizado por secciones** con comentarios claros, no migro a CSS modules ni nada.
5. **Genero `tokens.css` separado** del `styles.css` para que sea el contrato del sistema de diseño.

---

## 7. Próximos pasos sugeridos

Pendiente tu OK:
- ✅ Aprobar esta auditoría
- ⏭️ Proceder con PASO 2 — `design-system.md` + `tokens.css`
- ⏭️ Después PASO 3 — backups
- ⏭️ Después PASO 4 — refinamiento pantalla por pantalla con previews

---

## 8. Lo que NO encontré en el código (pero el brief asume)

- No hay archivo `package.json` que cargue librerías de iconos — habrá que agregar Lucide inline o vía CDN.
- No hay fuentes custom — habrá que agregar Google Fonts link en `<head>`.
- No hay logos físicos en `/public/assets/logos/` — los necesito de tu lado.

---

**Para arrancar PASO 2 necesito:**

1. Tu **OK** a esta auditoría (o ajustes que veas)
2. Los **2 logos en disco** en `/public/assets/logos/{alpadel.png, cotorreo-plaza.png}`
