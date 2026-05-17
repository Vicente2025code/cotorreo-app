# Decisiones de diseño — `cliente.html` paso "selección"

**Fecha:** 16 mayo 2026
**Estado:** Preview entregada — pendiente revisión Vicente
**Archivo preview:** `/public/cliente-seleccion.preview.html`

---

## Qué cambió respecto al actual

### Layout
- ❌ Header gradient con título grande + flecha sola → ✅ **Header sticky limpio**: back button + logo paraguas centrado
- ❌ Cards verticales con icono emoji enorme → ✅ **Cards horizontales** con logo real de cada negocio
- Misma anatomía que home (consistencia entre pantallas)

### Logos de unidad de negocio (diferenciación por marca, no por color)
- Card "Cancha" → logo `alpadel.png` (72×72px en wrap con fondo muted)
- Card "Mesa" → logo `plaza-cotorreo.png`
- **No fuerzo un color de Plaza distinto al de Alpadel** (regla del brief)
- La diferenciación la hace el logo, no la paleta

### Tipografía
- Título `--text-2xl` (24px) — "¿Qué quieres reservar?"
- Subtítulo `--text-sm` — "Te confirmamos por WhatsApp en minutos." (refuerza el copy de marca)
- Nombre del negocio `--text-lg` semibold
- Descripción `--text-sm` color secundario

### Color
- Sin gradiente festivo
- Wrap del logo en `--surface-muted` para dar "moldura" al logo sin competir con sus colores
- Hover de card: borde a teal + lift + chevron desplazado (igual patrón que home)

### Microinteracciones
- Back button: hover cambia color de texto y fondo sutil
- Card hover: borde teal + transform -1px + chevron derecha 2px
- Active: vuelve al baseline

---

## Qué NO toqué

- ✅ Brevedad: solo 2 opciones (cancha o mesa)
- ✅ Flujo: este paso lleva al siguiente (validar WhatsApp). Lo respeto.
- ✅ Copy "Te confirmamos por WhatsApp" → lo reforcé en el subtítulo
- ✅ Decisión: cliente elige negocio primero, después da teléfono (orden actual)

---

## Decisiones a discutir

### 1. Copy de las cards
Hoy decían:
- 🎾 **Cancha** / Alpadel
- 🍽️ **Mesa** / Plaza Cotorreo

Ahora:
- **Cancha de pádel** / Alpadel · cancha 1 dobles o cancha 2 singles
- **Mesa en restaurante** / Plaza Cotorreo · varias áreas disponibles

Argumento: el cliente que llega del bot WhatsApp ya sabe qué quiere reservar. El subtítulo le da pista de las opciones que va a encontrar (canchas o áreas). **Reversible si prefieres el original más corto.**

### 2. Tamaño del logo en card
72×72px con padding interno. Pude hacerlos más grandes (96×96) para énfasis de marca o más chicos (56×56) para más texto al lado. 72 es el punto medio que mantiene legible el logo y deja respirar el copy.

### 3. Subtítulo de página
"Te confirmamos por WhatsApp en minutos." — copy ligeramente más cálido que el actual. Si prefieres más seco, "Te confirmamos por WhatsApp" sin "en minutos".

---

## Cumple las reglas

- ✅ 60-30-10: teal solo en hover, resto neutro. Los logos tienen sus colores propios (3 unidades de magenta+amarillo+cyan en 2 logos), pero **están contenidos en wraps** que actúan como "moldura", no se esparcen al fondo
- ✅ Sin emojis decorativos
- ✅ Áreas tappables: 72px de alto la card
- ✅ Back button accesible: 40×40 con aria-label "Volver al inicio"

---

## Cómo verlo

# 👉 https://cotorreo-app.onrender.com/cliente-seleccion.preview.html

(Se va a deployar tras el siguiente push.)

---

## Para arrancar siguiente pantalla

OK aquí → reemplazo el paso "selección" en cliente.html → arranco **pantalla 3: validación WhatsApp**.
