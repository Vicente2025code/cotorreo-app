# Decisiones de diseño — `index.html` (home)

**Fecha:** 16 mayo 2026
**Estado:** Preview entregada — pendiente revisión Vicente
**Archivo preview:** `/public/index.preview.html`

---

## Qué cambió respecto al actual

### Tipografía
- ❌ Sistema font stack → ✅ **Inter** (Google Fonts, 400 + 600)
- ❌ "Grupo Cotorreo" tipográfico → ✅ **Logo Plaza Cotorreo** como brand-mark paraguas
- Jerarquía clara: logo > tagline (--text-sm) > pregunta (--text-xl) > títulos opciones (--text-lg) > descripciones (--text-sm)

### Color
- ❌ Cream `#faf7f2` y teal oscuro `#0d4a4e` → ✅ **Paleta semántica del sistema**:
  - Fondo: `--surface-page` (#F5F5F7)
  - Cards: `--surface-card` (#FFFFFF)
  - Acento marca: `--color-primary` (#1FA890) **solo** en hover de cards e ícono
- Ningún gradiente
- Magenta/amarillo/cyan **NO usados aquí** (no aportan en home)

### Iconografía
- ❌ Emojis decorativos `🎾 🍽️ 📅 🔑` en cards
- ✅ **Iconos Lucide inline** (calendario para "Reservar", candado para "Soy del equipo")
- Chevron derecho sutil indica que la card es navegable
- Logo Plaza Cotorreo en el header (no emoji)

### Layout
- ❌ Cards apiladas en grid 1fr 1fr (en móvil ya cambia a 1 columna pero el código duplica el patrón landing-option de cliente)
- ✅ Cards **horizontales** (icono | título+desc | chevron) — patrón estándar de listas tappables
- Max-width 420px en options para que no se estiren feas en desktop
- Padding generoso (`--space-5` interno, `--space-4` entre cards)

### Microinteracciones
- Hover: borde cambia a teal + sombra sube de `--shadow-sm` a `--shadow-md` + lift `-1px` + chevron se desplaza 2px a la derecha
- Active: vuelve al baseline (responde al tap)
- Todas las transiciones con `--t-fast` (120ms)

### Accesibilidad
- `alt` en logo
- `aria-hidden="true"` en SVG decorativos (icono y chevron) — el título de la card ya describe la acción
- Áreas tappables 60×96px aprox (sobre el mínimo 44×44)
- Foco visible (browser default sobre `<a>`)
- Texto sobre fondo: ratio 17.4:1 (AAA)

---

## Qué NO toqué (regla del brief)

- ✅ Brevedad: solo 2 opciones
- ✅ Texto literal: "Reservar", "Soy del equipo", tagline igual
- ✅ Destinos: `/cliente.html` y `/login.html`
- ✅ Estructura conceptual: 1 selector con 2 caminos claros

---

## Decisiones que vale la pena discutir

### 1. Logo paraguas
Uso `plaza-cotorreo.png` como brand-mark del grupo en el header. El brief dice "Plaza Cotorreo opera como paraguas Cotorreo de facto, ya que no hay logo paraguas separado". Si después diseñas un logo Grupo Cotorreo, ese reemplaza este en `index.html` y todo lo demás se mantiene.

### 2. Color del icono "Soy del equipo"
Lo dejo en `--color-primary` (teal). Alternativa: en gris neutro para que solo el de cliente destaque. Mi argumento: ambos son acciones primarias diferentes, no compiten — la jerarquía la hace el orden visual, no el color.

### 3. Tagline
Mantengo "Sistema de reservas — Plaza Cotorreo y Alpadel" pero invertí el orden (antes Alpadel primero). Razón: el logo del header es Plaza, mantengo coherencia. **Reversible si prefieres el orden original.**

### 4. Footer
Agregué "Grupo Cotorreo · Ciudad Quesada, San Carlos" como ancla geográfica sutil. **Es opcional**, si prefieres home sin footer, lo quito.

---

## Cómo verlo antes de aprobar

1. Abre en tu compu: `cotorreo-app/public/index.preview.html` (doble click en explorador)
2. Compara con el actual: https://cotorreo-app.onrender.com/
3. Pruébalo en celular: copia el contenido a un archivo, súbelo a tu Drive como HTML y visítalo

O si prefieres, pusheamos el preview a Render como `/index.preview.html` (URL pública) para que veas la versión real con CDN.

---

## Para arrancar siguiente pantalla

Necesito tu OK aquí. Después arranco con **`cliente.html` paso "selección"** (siguiente del orden del brief).
