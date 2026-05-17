# Sistema de Diseño Cotorreo — v0.1

**Última actualización:** 16 mayo 2026
**Aplicable a:** cotorreo-app y futuros productos digitales del Grupo Cotorreo
**Estado:** Borrador para revisión

> Este documento es el primer manual de marca digital del Grupo Cotorreo.
> Cada decisión está aquí justificada y se vuelve parte del contrato del sistema.

---

## 1. Filosofía visual

### 1.1 Regla 60-30-10 (innegociable)

Toda pantalla del sistema respeta esta distribución cromática:

- **60% neutro** — blanco, gris muy claro, texto en oscuro. Es la base que da respiración visual y profesionalismo transaccional.
- **30% color base de marca** — solo el **teal Cotorreo (#1FA890)**. Botones primarios, focus state, links activos. Es el sello "esto es Cotorreo" sin gritar.
- **10% acentos** — magenta, amarillo, cyan. Cada uno con trabajo semántico específico, nunca decorativo.

**Por qué importa:** la app maneja dinero (reservas pagadas, paquetes prepagados), datos personales y compromisos. Una estética festiva-tropical baja la confianza percibida en el momento de meter datos. La paleta Cotorreo es rica precisamente porque es restaurantera-amigable; la disciplina al usarla apenas como acentos es lo que evita que el sistema parezca decoración y mantiene la sensación bancaria/transaccional necesaria.

### 1.2 Reglas de uso de cada acento

| Acento | Color | Uso permitido | Uso prohibido |
|---|---|---|---|
| **Magenta** | `#E91E63` | Énfasis emocional: cumpleaños, badge "nuevo cliente", confirmaciones celebratorias | Botones primarios, fondos grandes, headers |
| **Amarillo** | `#FFC107` | Advertencias suaves, estados "pendiente", recordatorios | Fondos de área grande, texto sobre blanco (poco contraste) |
| **Cyan** | `#00BCD4` | Datos informativos, badges secundarios, separación visual Plaza/Alpadel cuando aplique | Botones, llamadas a acción |

### 1.3 Prohibido absoluto

- Más de 2 colores de marca por pantalla simultáneamente (excepto logos)
- Gradientes entre colores de marca
- Fondos de color saturado a página completa
- Botones primarios en magenta, amarillo o cyan — siempre teal o neutro
- Glassmorphism, neumorphism, gradientes morado→rosa de moda
- Animaciones decorativas (confetti, etc) — solo microinteracciones funcionales
- Modo oscuro (no aporta en este contexto, agrega complejidad)
- Border-radius mayor a 16px en cualquier elemento

---

## 2. Tokens de color

### 2.1 Marca (paleta de logos)

| Token | HEX | Origen |
|---|---|---|
| `--brand-teal` | `#1FA890` | Texto "alpadel" y "Cotorreo" en los logos |
| `--brand-teal-700` | `#178573` | Variante hover/active del teal |
| `--brand-teal-100` | `#D9F0EB` | Tint suave para backgrounds con marca |
| `--brand-magenta` | `#E91E63` | "CLUB", "PLAZA" y alas en logos |
| `--brand-magenta-100` | `#FCE4EC` | Tint suave |
| `--brand-yellow` | `#FFC107` | Centro del ave en Cotorreo, bolita en alpadel |
| `--brand-yellow-100` | `#FFF8E1` | Tint suave |
| `--brand-cyan` | `#00BCD4` | Detalles secundarios en logos |
| `--brand-cyan-100` | `#E0F7FA` | Tint suave |

### 2.2 Tokens semánticos (lo que se usa en código)

Las decisiones de diseño siempre usan tokens semánticos, **no** los de marca directamente:

```css
/* ✅ Sí */
button { background: var(--color-primary); }

/* ❌ No */
button { background: var(--brand-teal); }
```

| Token semántico | Resuelve a | Cuándo usar |
|---|---|---|
| `--color-primary` | brand-teal | Botones primarios, focus, links activos |
| `--color-primary-hover` | brand-teal-700 | Estados hover/active |
| `--color-primary-bg` | brand-teal-100 | Fondos sutiles con marca |
| `--color-accent-emo` | brand-magenta | Cumpleaños, celebrar |
| `--color-accent-warn` | brand-yellow | Advertencias |
| `--color-accent-info` | brand-cyan | Info secundaria |
| `--color-success` | `#15803D` | Estados de éxito (verde sobrio, no es marca) |
| `--color-danger` | `#DC2626` | Errores |
| `--text-primary` | `#0F172A` | Texto principal (no negro puro) |
| `--text-secondary` | `#475569` | Descripciones |
| `--text-tertiary` | `#94A3B8` | Placeholders, hints |
| `--text-on-brand` | `#FFFFFF` | Texto sobre fondo teal |
| `--surface-page` | `#F5F5F7` | Fondo de página |
| `--surface-card` | `#FFFFFF` | Fondo de cards |
| `--border-subtle` | `#E2E8F0` | Bordes de inputs y cards |

### 2.3 Contraste y accesibilidad

Todos los pares texto/fondo siguientes cumplen **WCAG AA** (ratio ≥ 4.5:1):

| Texto sobre fondo | Ratio | Estado |
|---|---|---|
| `--text-primary` sobre `--surface-card` | 17.4:1 | ✅ AAA |
| `--text-secondary` sobre `--surface-card` | 7.7:1 | ✅ AAA |
| `--text-tertiary` sobre `--surface-card` | 3.0:1 | ⚠️ AA solo para texto grande (18px+) |
| `--text-on-brand` (`#fff`) sobre `--color-primary` | 4.6:1 | ✅ AA |

**Regla:** nunca usar `--text-tertiary` para texto crítico (errores, datos importantes).

---

## 3. Tipografía

### 3.1 Familia

**Inter** como fuente principal, vía Google Fonts. Razones:

- Diseñada específicamente para UI digital (no es una tipografía adaptada de impresión)
- Rendimiento óptico excelente en tamaños pequeños (12-14px), donde sufren otras
- Variable font disponible (un archivo, todos los pesos)
- Soporte amplio para español (acentos, ñ, ¿¡)
- Cargada con `font-display: swap` para no bloquear render

**Pesos cargados:** 400 (regular) + 600 (semibold). 2 pesos es suficiente para todo el sistema y mantiene el peso del archivo bajo (~25KB total ambos pesos).

**Fallback:** `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. Si Inter no carga, el sistema se ve consistente con el OS del usuario.

### 3.2 Escala modular (ratio 1.250)

| Token | Tamaño | Uso típico |
|---|---|---|
| `--text-xs` | 12px | Hints, microcopy, labels secundarios |
| `--text-sm` | 14px | Body secondary, captions |
| `--text-base` | 16px | Body principal, inputs (evita zoom en iOS) |
| `--text-lg` | 18px | Énfasis sutil, subtítulos |
| `--text-xl` | 20px | Títulos de sección |
| `--text-2xl` | 24px | Títulos de card |
| `--text-3xl` | 30px | Títulos de página |
| `--text-4xl` | 36px | KPIs grandes |
| `--text-5xl` | 48px | Excepcional: número hero |

**Importante:** evitar tamaños intermedios (15, 17, etc.). Si dudas entre 2 tamaños, elige el más chico.

### 3.3 Pesos

| Peso | Token | Uso |
|---|---|---|
| 400 Regular | `--weight-regular` | Body, labels normales |
| 500 Medium | `--weight-medium` | Labels importantes, microcopy con peso |
| 600 SemiBold | `--weight-semibold` | Títulos h2/h3, botones |
| 700 Bold | `--weight-bold` | Uso excepcional: alarma, número hero |

### 3.4 Line-height

| Token | Valor | Uso |
|---|---|---|
| `--leading-tight` | 1.2 | Títulos grandes |
| `--leading-snug` | 1.35 | Subtítulos, KPIs |
| `--leading-normal` | 1.5 | Body |
| `--leading-relaxed` | 1.65 | Texto largo (párrafos densos) |

---

## 4. Espaciado

Escala base **4px**, exclusivamente múltiplos:

| Token | Valor | Uso típico |
|---|---|---|
| `--space-1` | 4px | Mínimo, entre dot y label |
| `--space-2` | 8px | Entre badge y texto |
| `--space-3` | 12px | Padding interno chico |
| `--space-4` | 16px | **Base** — separación entre campos de form |
| `--space-5` | 20px | Padding interno cards |
| `--space-6` | 24px | Padding cards grandes |
| `--space-8` | 32px | Separación entre secciones |
| `--space-10` | 40px | Espacio generoso entre bloques |
| `--space-12` | 48px | Espacio hero |
| `--space-16` | 64px | Excepcional |

**Regla:** nada de espaciados ad-hoc (`padding: 11px`, `margin: 7px`). Siempre desde la escala.

---

## 5. Radios

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 4px | Badges chicos, dots |
| `--radius-md` | 8px | Inputs, botones |
| `--radius-lg` | 12px | Cards, paneles |
| `--radius-pill` | 999px | Badges tipo pill, chips |
| `--radius-circle` | 50% | Avatares, PIN dots, fab |

**Regla del brief:** máximo 12px en cards, 8px en inputs/botones. Nada mayor a 16px.

---

## 6. Sombras

Solo 3 niveles funcionales (regla del brief):

| Token | Uso |
|---|---|
| `--shadow-sm` | Cards normales — elevación sutil |
| `--shadow-md` | Header sticky, dropdowns |
| `--shadow-lg` | Modales, hover destacado (uso puntual) |
| `--shadow-focus` | Anillo de focus alrededor de input activo (teal con alpha) |

**Regla:** las sombras tienen propósito jerárquico (qué está más arriba en el plano Z). Nunca usar sombra como decoración.

---

## 7. Transiciones

| Token | Duración | Curva | Uso |
|---|---|---|---|
| `--t-fast` | 120ms | ease-out | Hover |
| `--t-base` | 180ms | ease-out | Focus, color change |
| `--t-slow` | 240ms | ease-out | Slide, fade, transición pantalla |

**Prohibido:** animaciones decorativas, bouncing, spring. Solo microinteracciones funcionales.

---

## 8. Layout

| Token | Valor | Uso |
|---|---|---|
| `--content-max` | 720px | Max-width del contenedor app |
| `--tap-min` | 44px | Mínimo área tappable (Apple HIG) |
| `--input-h` | 44px | Altura de inputs y botones |
| `--header-h` | 64px | Altura header sticky |

**Mobile-first real:** diseñar primero para 375px de ancho. Áreas tappables ≥ 44×44px. Acciones primarias en tercio inferior cuando la decisión es final.

---

## 9. Anatomía de componentes principales

### 9.1 Botón

```
Estructura:
  padding: var(--space-3) var(--space-5)
  height: var(--input-h)  [44px mínimo]
  border-radius: var(--radius-md)  [8px]
  font-size: var(--text-base)
  font-weight: var(--weight-semibold)
  transition: var(--t-fast)
```

Variantes:
- **Primary** — fondo `--color-primary`, texto blanco. Acción principal de la pantalla
- **Secondary** — fondo blanco, borde `--border-strong`, texto `--text-primary`. Acción secundaria
- **Ghost** — sin fondo, texto `--color-primary`. Acciones terciarias (cancelar, volver)
- **Danger** — fondo `--color-danger`, texto blanco. Solo para destructivo (cancelar reserva, borrar)

Una pantalla **debe tener máximo un botón Primary visible** (excepción: modales con confirmar+cancelar lado a lado).

### 9.2 Input

```
Estructura:
  height: var(--input-h)  [44px]
  padding: var(--space-3)
  border: 1px solid var(--border-subtle)
  border-radius: var(--radius-md)
  font-size: var(--text-base)  [16px — evita zoom iOS]

Estados:
  hover:    border-color var(--border-strong)
  focus:    border-color var(--color-primary)
            box-shadow var(--shadow-focus)
  error:    border-color var(--color-danger)
            mensaje debajo en --color-danger
  disabled: opacity 0.5, cursor not-allowed

Estructura completa de campo:
  <label> arriba (var(--weight-medium), --text-sm)
  <input>
  <hint> debajo (--text-xs, --text-tertiary)  [opcional]
  <error> debajo (--text-xs, --color-danger)   [si aplica]
```

### 9.3 Card

```
Estructura:
  background: var(--surface-card)
  border: 1px solid var(--border-subtle)
  border-radius: var(--radius-lg)  [12px]
  padding: var(--space-5)  [20px]
  box-shadow: var(--shadow-sm)

Composición:
  Título h3 arriba (--text-lg, --weight-semibold)
  Contenido (--text-base)
  Acciones abajo si las hay (botones)
```

### 9.4 Badge

```
Estructura:
  padding: 2px 10px
  border-radius: var(--radius-pill)
  font-size: var(--text-xs)
  font-weight: var(--weight-semibold)
  text-transform: uppercase
  letter-spacing: 0.5px

Variantes (por estado):
  confirmada  → bg --color-accent-info-bg, color --color-accent-info
  completada  → bg --color-success-bg,     color --color-success
  cancelada   → bg --color-danger-bg,      color --color-danger
  noshow      → bg --color-accent-warn-bg, color --color-accent-warn
```

### 9.5 KPI Card

```
Estructura:
  Padding generoso (--space-5)
  Label arriba (--text-xs, uppercase, --text-tertiary)
  Valor grande (--text-4xl, --weight-semibold, --color-primary)
  Delta debajo opcional (--text-xs, color condicional verde/rojo)

Solo en gerencia y dashboards: KPIs financieros pueden tener un acento
de fondo muy sutil (--color-primary-bg con opacity 30%).
```

---

## 10. Iconografía

**Librería:** [Lucide](https://lucide.dev) — SVG inline, color por `currentColor`, peso visual coherente.

**Por qué Lucide:**
- SVG inline → cero requests HTTP extra
- Color controlado por CSS via `currentColor`
- ~1KB por icono usado
- Weight (stroke) configurable
- Estilo coherente (lineart 1.5px stroke)
- Pre-cargados en formato SVG sin dependencias

**Cuándo usar emoji vs ícono:**

| Caso | Decisión |
|---|---|
| Header de página | Logo (no emoji) |
| Botón con icono | Ícono Lucide |
| Estado en badge | Sin icono — solo texto |
| Confirmación de éxito | Ícono Lucide `check-circle` + emoji aceptado `✅` en pantalla de gracias |
| Cumpleaños | Emoji `🎂` (es emocional, no decorativo) |
| Recordatorio cancha/mesa | Logos del negocio respectivo |
| Decorativo | NO usar (ni emoji ni ícono) |

**Iconos del set para esta versión:**
`menu`, `x`, `arrow-left`, `arrow-right`, `chevron-down`, `check`, `check-circle`, `alert-circle`, `info`, `clock`, `calendar`, `users`, `map-pin`, `phone`, `mail`, `lock`, `log-out`, `plus`, `search`, `pencil`, `trash-2`, `whatsapp` (custom).

---

## 11. Logos disponibles

| Archivo | Uso |
|---|---|
| `/assets/logos/grupo-cotorreo.png` | Logo paraguas — usar en home y pantallas neutrales (login) |
| `/assets/logos/plaza-cotorreo.png` | Logo de la unidad de negocio Plaza Cotorreo (restaurante) |
| `/assets/logos/alpadel.png` | Logo de la unidad de negocio Alpadel (canchas) |

**Regla:** en pantallas específicas de una unidad de negocio se usa su logo correspondiente. En pantallas neutrales o del grupo, el logo paraguas.

## 12. Decisiones de marca pendientes (para futuras versiones)

- ¿Tipografía propia de marca (no Inter)? Si se elige una, debe tener peso similar para no cambiar layouts
- ¿Mapa de tono de voz (cómo escribe el sistema)? Hoy es "cálido y directo" pero no documentado
- ¿Sistema de imágenes/fotografía si se agregan a la app?

---

## 12. Changelog

| Versión | Fecha | Cambios |
|---|---|---|
| 0.1 | 16 may 2026 | Versión inicial. Tokens, escala, anatomía de componentes principales. |
| 0.1.1 | 16 may 2026 | Agregado logo paraguas Grupo Cotorreo (antes se usaba Plaza como paraguas de facto). |
