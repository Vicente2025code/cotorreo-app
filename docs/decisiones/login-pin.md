# Decisiones de diseño — login PIN equipo

**Fecha:** 16 mayo 2026
**Estado:** Preview entregada
**Archivo:** `/public/login.preview.html`

---

## Qué cambió respecto al actual

### Estructura
- **Bloque de marca arriba (no header sticky)**: el login no necesita navegación, es la raíz. Logo Grupo Cotorreo a 140px con `mix-blend-mode: multiply` y un tag "Acceso interno" debajo en uppercase tenue.
- **Lock icon decorativo** en círculo teal claro arriba del título → señal visual instantánea de "esto es seguro/privado".
- **Pregunta clara como título** ("Ingresá tu PIN") con subtítulo que aclara que el rol se detecta automáticamente.
- **Card con form mínimo**: solo input PIN + botón Entrar.
- **Sin selector de rol** — el backend identifica Lili / Maestros / Gerencia por el PIN. Menos pasos, menos fricción.

### Input PIN
- `type="password"` por defecto + botón ojo para mostrar/ocultar (útil cuando hay duda de qué digitaste).
- `inputmode="numeric"` → teclado numérico nativo en móvil.
- `maxlength="8"` + `pattern="\d{4,8}"` → permite 4 a 8 dígitos (compatible con el cambio reciente de PINs de 4 a 6 dígitos aleatorios).
- `autocomplete="off"` → no queremos que el navegador autocomplete el PIN del staff.
- Letter-spacing amplio y text-align center → se ve como un PIN, no como un password normal.

### Feedback inline
- Tres estados: success (verde), error (rojo), warn (amarillo).
- Spinner animado en el botón mientras "verifica" (simulado a 600ms en preview).
- **Contador de intentos visible**: "PIN incorrecto. Intento X de 3" → da feedback claro antes del bloqueo.
- **Rate limit con bloqueo de 30s** al tercer intento fallido (estado warn amarillo). El botón se deshabilita.

### Salidas alternativas
- **"¿Eres cliente? Reservar aquí"** debajo de la card → si un cliente llega a esta URL por error, le damos el camino de vuelta al flujo público.
- **Footer minimalista** con copyright + link a Gerencia por WhatsApp para PIN olvidado.

---

## Qué NO toqué

- ✅ Flujo de validación cliente (pantalla cliente.html sigue siendo el flujo público sin PIN)
- ✅ Backend `/api/auth/login` (acepta 4-8 dígitos, ya lo arreglamos)
- ✅ Rate limiting del backend (esto es solo UI; el backend tiene su propio limit)

---

## Decisiones a discutir

### 1. Sin selector de rol
Asumo que el PIN determina el rol. Pro: menos clicks, menos confusión. Contra: si Lili quiere entrar como Gerencia algún día (ej. cubriendo a Vicente), necesita el PIN de Gerencia. **Recomiendo mantenerlo así** porque cada PIN ya está asociado a un usuario único en el backend.

### 2. Mostrar/ocultar PIN (ojo)
Útil para el primer login cuando el PIN se acaba de comunicar por WhatsApp. Riesgo bajo en escritorio compartido (cocina) porque el PIN nunca se queda en pantalla más de unos segundos. Si te parece riesgo, lo quito y dejo solo password.

### 3. Bloqueo de 30s tras 3 intentos
En preview el bloqueo es 100% frontend (se puede saltar refrescando). En producción, el backend ya tiene rate limit por IP. Esto es solo UX para que el usuario no insista. **Recomiendo subirlo a 60s en producción** y que coincida con el rate limit real del backend.

### 4. "¿Eres cliente? Reservar aquí"
Link visible al flujo público. Útil para no perder clientes que llegan a `/login` por error. Si te parece que confunde, lo quito.

### 5. Footer con link a Gerencia
WhatsApp directo a tu número (`+50672882394`). Si quieres que vaya a otro número (ej. Lili que sabe quién es cada PIN), lo cambio.

---

## Cumple las reglas

- ✅ 60-30-10 (teal solo en lock icon, focus, botón primario; el resto neutro)
- ✅ Sin emojis (icons Lucide: lock, eye, arrow)
- ✅ Mobile-first: teclado numérico nativo, áreas tap ≥44px
- ✅ Accesibilidad: label asociado, aria-label en toggle, focus visible, contraste AAA
- ✅ Sobrio bancario: lock icon + tipografía limpia + sin animaciones festivas

---

## Cómo verlo

👉 https://cotorreo-app.onrender.com/login.preview.html

**Para probar:**
- PIN `1234` → entra como Lili
- PIN `5678` → entra como Maestros
- PIN `123456` → entra como Gerencia
- Cualquier otro → falla (a los 3 intentos: bloqueo 30s)
- Toggle ojo para ver/ocultar

---

## Próximos pasos

Aprobado el login → tengo las 7 pantallas listas.
Siguiente fase: **consolidar** los `.preview.html` en los archivos reales (`cliente.html`, `login.html`) reemplazando lo que está en producción.
