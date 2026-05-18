# Decisiones de diseño — cliente paso "validación WhatsApp"

**Fecha:** 16 mayo 2026
**Estado:** Preview entregada
**Archivo:** `/public/cliente-telefono.preview.html`

---

## Qué cambió respecto al actual

### Estructura
- Header consistente con pantalla anterior (logo Grupo Cotorreo 120px)
- **Context badge** nuevo: muestra "Reservando Cancha de pádel" o "Reservando Mesa" según vino de la pantalla anterior. Da contexto al cliente sin que tenga que recordar qué eligió.
- Pregunta clara como título grande
- Subtítulo que explica por qué pedimos el teléfono
- Form en card limpia
- Promesa de WhatsApp como nota tenue al final (no agresiva)

### Input de teléfono
- **Prefijo +506 fijo** a la izquierda del input → el cliente no tiene que escribirlo ni preguntarse si tiene que poner código país
- Placeholder con espaciado real (`8888 8888`) → más legible
- `inputmode="tel"` → en móvil sale el teclado numérico, no el alfabético
- `autocomplete="tel"` → autocompletado del navegador funciona
- Hint con texto secundario explicando que si pega el número completo lo arreglamos

### Feedback inline
- En lugar de `alert()` (que rompe el flujo móvil), uso una **banda de feedback** debajo del botón
- Verde cuando cliente reconocido o procedente
- Rojo cuando hay error de validación
- Ícono semántico al lado del mensaje

### Microinteracciones
- Focus state real en input: borde teal + box-shadow halo (`--shadow-focus`)
- Botón primario con ícono de flecha a la derecha
- `:active` con scale ligero en botón (feedback táctil)

---

## Qué NO toqué

- ✅ Pide solo el teléfono en este paso (no fuerza dar más info)
- ✅ Continúa al siguiente paso (form completo o sino datos pre-rellenados)
- ✅ El cliente puede volver atrás con el botón del header
- ✅ Copy "Te confirmamos por WhatsApp" reforzado al final

---

## Decisiones a discutir

### 1. Context badge
Es nuevo. Muestra "Reservando Cancha de pádel" en pill teal. Útil porque entre pantalla 2 y 3 el cliente puede haberse distraído y olvidado qué eligió. Si te parece ruido visual, lo quito.

### 2. Prefijo +506 visible
Asume CR (que es 99% de los casos). Si alguna vez tienes un cliente extranjero, tendría que escribir su código país completo igual. La alternativa es no poner el prefijo y dejar el campo abierto. **Mi recomendación es mantenerlo** porque simplifica la experiencia para el 99%.

### 3. Promesa WhatsApp al final
"Te confirmamos por WhatsApp en minutos" en gris tenue al pie. Reforzando lo que ya dijo el subtítulo de la pantalla anterior. Si parece redundante, lo quito.

---

## Cumple las reglas

- ✅ 60-30-10 (teal solo en badge contextual, focus, botón primario; el resto neutro)
- ✅ Sin emojis decorativos (icono Lucide WhatsApp en la promesa)
- ✅ Mobile-first: prefijo no ocupa espacio del input, teclado tel nativo
- ✅ Accesibilidad: label asociado, focus visible, contraste AAA
- ✅ Áreas tap: input 44px alto, botón 44px alto

---

## Cómo verlo

👉 https://reservas.grupocotorreo.com/cliente-telefono.preview.html

---

## Para siguiente pantalla

OK aquí → arranco **pantalla 4: form Alpadel** (la más densa, requiere agrupación de campos).
