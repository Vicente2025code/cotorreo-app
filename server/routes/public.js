/**
 * Rutas públicas (sin auth):
 * - GET  /api/disponibilidad/alpadel?fecha=YYYY-MM-DD
 * - GET  /api/disponibilidad/cotorreo?fecha=YYYY-MM-DD
 * - GET  /api/tarifas/alpadel
 * - POST /api/reservas/alpadel  (crear reserva pública)
 * - POST /api/reservas/cotorreo (crear reserva pública)
 */

const express = require("express");
const { validarFechasCR } = require("../horario");
const { TABLES, list, create, update, upsertCliente, findClienteByTelefono, buildCumpleanos, normalizeTelefono, parseFechaHoraCR, findAlpadelOverlap, findDuplicadoReciente } = require("../airtable");
const { withMutex } = require("../mutex");

const router = express.Router();

// ===========================
// Rate limit en memoria (sin nuevas dependencias)
// Protege endpoints sensibles contra enumeración / spam.
// ===========================
function createRateLimiter({ max, windowMs, message = "Demasiadas solicitudes, intentá en un momento." }) {
  const buckets = new Map(); // ip → [timestamps]
  return (req, res, next) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const now = Date.now();
    const fresh = (buckets.get(ip) || []).filter(ts => now - ts < windowMs);
    if (fresh.length >= max) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    fresh.push(now);
    buckets.set(ip, fresh);
    // Limpieza ocasional para evitar memory leak en IPs viejas
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (v.every(ts => now - ts >= windowMs)) buckets.delete(k);
      }
    }
    next();
  };
}

// /api/clientes/check: 15 requests/min por IP.
// El bot legítimo hace ~1 por reserva. Un atacante enumerando se topa con 429.
const checkLimiter = createRateLimiter({
  max: 15,
  windowMs: 60_000,
  message: "Demasiadas consultas. Esperá un minuto."
});

// Horario operativo
const HORAS = [];
for (let h = 7; h < 22; h++) {
  HORAS.push(`${String(h).padStart(2, "0")}:00`);
  HORAS.push(`${String(h).padStart(2, "0")}:30`);
}
HORAS.push("22:00");

// ===========================
// GET /api/disponibilidad/alpadel?fecha=YYYY-MM-DD
// Devuelve horas libres por cancha para esa fecha
// ===========================
router.get("/disponibilidad/alpadel", async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: "Falta o mal formato de fecha (YYYY-MM-DD)" });
    }

    const inicio = `${fecha}T00:00:00.000Z`;
    const fin = `${fecha}T23:59:59.999Z`;

    const formula = `AND(
      IS_AFTER({Fecha y hora inicio}, '${inicio}'),
      IS_BEFORE({Fecha y hora inicio}, '${fin}'),
      OR({Estado}='Confirmada', {Estado}='Completada')
    )`.replace(/\s+/g, " ");

    const result = await list(TABLES.ReservasAlpadel, { filterByFormula: formula });

    // Construir set de slots ocupados por cancha
    const ocupados = { Singles: new Set(), Dobles: new Set() };
    for (const r of result.records || []) {
      const f = r.fields;
      if (!f["Fecha y hora inicio"] || !f["Hora fin"]) continue;
      const ini = new Date(f["Fecha y hora inicio"]);
      const finR = new Date(f["Hora fin"]);
      const cancha = f["Cancha"];
      if (!ocupados[cancha]) continue;
      // Marcar cada slot de 30 min ocupado
      let cur = new Date(ini);
      while (cur < finR) {
        const h = String(cur.getUTCHours() - 6).padStart(2, "0"); // UTC-6 CR
        const m = String(cur.getUTCMinutes()).padStart(2, "0");
        if (h >= "00" && h <= "23") ocupados[cancha].add(`${h}:${m}`);
        cur = new Date(cur.getTime() + 30 * 60 * 1000);
      }
    }

    res.json({
      fecha,
      horas: HORAS,
      ocupados: {
        Singles: [...ocupados.Singles],
        Dobles: [...ocupados.Dobles],
      },
    });
  } catch (e) {
    console.error("disponibilidad/alpadel", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/disponibilidad/cotorreo?fecha=YYYY-MM-DD
// Para mesa solo devuelve cuántas reservas hay por hora (no bloquea)
// ===========================
router.get("/disponibilidad/cotorreo", async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: "Falta o mal formato de fecha" });
    }

    const inicio = `${fecha}T00:00:00.000Z`;
    const fin = `${fecha}T23:59:59.999Z`;

    const formula = `AND(
      IS_AFTER({Fecha y hora}, '${inicio}'),
      IS_BEFORE({Fecha y hora}, '${fin}'),
      OR({Estado}='Confirmada', {Estado}='Completada')
    )`.replace(/\s+/g, " ");

    const result = await list(TABLES.ReservasCotorreo, { filterByFormula: formula });

    const porHora = {};
    let totalPersonas = 0;
    for (const r of result.records || []) {
      const f = r.fields;
      const personas = f["Personas"] || 0;
      totalPersonas += personas;
      const d = new Date(f["Fecha y hora"]);
      const h = String(d.getUTCHours() - 6).padStart(2, "0");
      const m = String(d.getUTCMinutes()).padStart(2, "0");
      const slot = `${h}:${m}`;
      porHora[slot] = (porHora[slot] || 0) + personas;
    }

    res.json({ fecha, horas: HORAS, porHora, totalPersonas });
  } catch (e) {
    console.error("disponibilidad/cotorreo", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/clientes/check?telefono=...
// Verifica si el teléfono ya existe. Solo devuelve { existe, nombre }.
// NO devuelve email/cumpleaños/historial por privacidad.
// ===========================
router.get("/clientes/check", checkLimiter, async (req, res) => {
  try {
    const { telefono } = req.query;
    if (!telefono) return res.status(400).json({ error: "Falta telefono" });
    const cliente = await findClienteByTelefono(telefono);
    if (!cliente) return res.json({ existe: false });
    res.json({
      existe: true,
      nombre: cliente.fields["Nombre completo"] || "",
      // No exponer email ni cumpleaños — privacidad
    });
  } catch (e) {
    console.error("GET clientes/check", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// POST /api/marketing/optin
// Body: { telefono, optIn (bool), source ("reserva_alpadel" | "reserva_cotorreo") }
// Marca al cliente como suscrito a comunicaciones de marketing.
// Idempotente: si ya estaba opt-in, actualiza solo la fecha.
// ===========================
const optinLimiter = createRateLimiter({
  max: 20,
  windowMs: 60_000,
  message: "Demasiadas solicitudes."
});

router.post("/marketing/optin", optinLimiter, async (req, res) => {
  try {
    const { telefono, optIn, source } = req.body || {};
    if (!telefono) return res.status(400).json({ error: "Falta telefono" });
    if (typeof optIn !== "boolean") return res.status(400).json({ error: "Falta optIn (bool)" });
    if (!source) return res.status(400).json({ error: "Falta source" });

    const cliente = await findClienteByTelefono(telefono);
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    await update(
      TABLES.Clientes,
      cliente.id,
      {
        "Marketing optin": optIn,
        "Marketing optin fecha": optIn ? today : null,
        "Marketing optin source": optIn ? source : null
      },
      { typecast: true }
    );

    console.log(`✅ Marketing optin ${optIn ? "ACTIVADO" : "DESACTIVADO"} para cliente ${cliente.id} (source: ${source})`);
    res.json({ ok: true, optIn });
  } catch (e) {
    console.error("POST marketing/optin", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/tarifas/alpadel  (info pública)
// ===========================
router.get("/tarifas/alpadel", (_req, res) => {
  res.json({
    descripcion: "Tarifas para clientes regulares",
    horario_operativo: "07:00 a 22:00",
    duraciones_disponibles: [0.5, 1, 1.5, 2, 2.5, 3],
    tarifas: {
      "L-S 7am-4pm": { Dobles: 6000, Singles: 4000 },
      "L-S 4pm-10pm": { Dobles: 12000, Singles: 6000 },
      "Domingos": { Dobles: 6000, Singles: 4000 },
    },
    paquetes: [
      { horas: 3, precio: 30000, hora_equivalente: 10000 },
      { horas: 5, precio: 47500, hora_equivalente: 9500 },
      { horas: 10, precio: 90000, hora_equivalente: 9000 },
    ],
    moneda: "CRC",
  });
});

// ===========================
// POST /api/reservas/alpadel
// Body: { nombre, telefono, email, cumpleanos, fecha, hora, duracion, cancha, notas }
// ===========================
router.post("/reservas/alpadel", async (req, res) => {
  try {
    const {
      nombre,
      telefono,
      email,
      cumpleanos,
      cumpleanosDia,
      cumpleanosMes,
      fecha,
      hora,
      duracion,
      cancha,
      notas,
    } = req.body;

    const faltan = [];
    if (!nombre) faltan.push("nombre");
    if (!telefono) faltan.push("telefono");
    if (!fecha) faltan.push("fecha");
    if (!hora) faltan.push("hora");
    if (!duracion) faltan.push("duracion");
    if (!cancha || !["Singles", "Dobles"].includes(cancha))
      faltan.push("cancha");

    // Email y cumpleaños solo obligatorios para clientes nuevos
    const existing = await findClienteByTelefono(telefono);
    if (!existing) {
      if (!email) faltan.push("email");
      if (!cumpleanos && !(cumpleanosDia && cumpleanosMes))
        faltan.push("cumpleanos");
    }

    if (faltan.length) {
      return res.status(400).json({ error: `Faltan: ${faltan.join(", ")}` });
    }

    const startCR = new Date(`${fecha}T${hora}:00-06:00`);
    const endCR = new Date(startCR.getTime() + duracion * 3600 * 1000);

    // FUERA DE HORARIO — la app aceptaba 21:30 a 22:30 porque nadie miraba el cierre.
    const fueraDeHorario = validarFechasCR(startCR, endCR);
    if (fueraDeHorario) return res.status(400).json({ error: fueraDeHorario });

    const telefonoNorm = normalizeTelefono(telefono);

    // MUTEX POR CLAVE — la clave describe la reserva única. Requests
    // concurrentes con la misma clave se serializan: el primero ejecuta todo
    // el flujo y los demás reciben SU MISMO resultado. Sin duplicados aunque
    // lleguen 9 POST en 1 milisegundo.
    const claveMutex = `alpadel|${telefonoNorm}|${cancha}|${startCR.toISOString()}`;
    const resultado = await withMutex(claveMutex, async () => {
      // ANTI-PASADO
      if (startCR.getTime() <= Date.now()) {
        const fmtCR = new Intl.DateTimeFormat("es-CR", {
          timeZone: "America/Costa_Rica",
          weekday: "short", day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: true,
        }).format(startCR);
        return { code: 400, body: { error: `Esa hora (${fmtCR}) ya pasó. Elegí una fecha y hora a futuro.` } };
      }

      // ANTI-DUPLICADO ventana 60s — atrapa retries que llegan tras terminar
      // el primer request (fuera del mutex vivo).
      const dup = await findDuplicadoReciente({
        tabla: TABLES.ReservasAlpadel,
        campoInicio: "Fecha y hora inicio",
        fields: {
          Cancha: cancha,
          "Fecha y hora inicio": startCR.toISOString(),
          "Telefono cliente": telefonoNorm,
        },
        ventanaSeg: 60,
      });
      if (dup) {
        return { code: 200, body: {
          ok: true, duplicado_detectado: true,
          reserva: { id: dup.id, referencia: dup.fields.Referencia, precio: dup.fields.Precio },
        }};
      }

      // ANTI-SOLAPAMIENTO
      const conflicto = await findAlpadelOverlap(cancha, startCR.toISOString(), endCR.toISOString());
      if (conflicto) {
        const fmtCR = (iso) => new Intl.DateTimeFormat("es-CR", {
          timeZone: "America/Costa_Rica",
          weekday: "short", day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(new Date(iso));
        return { code: 409, body: {
          error: `Esa cancha ya está reservada de ${fmtCR(conflicto.inicio)} a ${fmtCR(conflicto.fin)}. Elegí otro horario o la otra cancha.`,
          conflicto,
        }};
      }

      const cliente = existing || await upsertCliente({
        nombre, telefono, email, cumpleanos, cumpleanosDia, cumpleanosMes,
        negocio: "Alpadel",
      });

      const reserva = await create(
        TABLES.ReservasAlpadel,
        {
          "Nombre cliente": nombre,
          "Telefono cliente": telefonoNorm,
          "Email cliente": email,
          "Cumpleaños cliente": cumpleanos,
          "Fecha y hora inicio": startCR.toISOString(),
          "Hora fin": endCR.toISOString(),
          Cancha: cancha,
          Estado: "Confirmada",
          "Tipo de reserva": "Regular",
          Cliente: [cliente.id],
          Notas: notas || undefined,
          Referencia: `Alpadel · ${nombre} · ${startCR.toISOString()}`,
        },
        { typecast: true }
      );
      return { code: 200, body: {
        ok: true,
        reserva: {
          id: reserva.id,
          referencia: reserva.fields.Referencia,
          precio: reserva.fields.Precio,
        },
      }};
    });
    return res.status(resultado.code).json(resultado.body);
  } catch (e) {
    console.error("POST reservas/alpadel", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// POST /api/reservas/cotorreo
// Body: { nombre, telefono, email, cumpleanos, fechaHora, personas, ocasion, area, notas }
// ===========================
router.post("/reservas/cotorreo", async (req, res) => {
  try {
    const {
      nombre,
      telefono,
      email,
      cumpleanos,
      cumpleanosDia,
      cumpleanosMes,
      fechaHora,
      personas,
      ocasion,
      area,
      notas,
    } = req.body;

    // Blindaje anti-bypass: si la fecha solicitada cae en un día bloqueado
    // (env var COTORREO_FECHAS_BLOQUEADAS), rechazar 503 aunque intenten
    // saltar el UI. Lili/Salonero usan /reservas/cotorreo/manual — ese
    // endpoint no aplica este bloqueo.
    const fechasBloqRaw = process.env.COTORREO_FECHAS_BLOQUEADAS || "";
    const fechasBloqueadas = fechasBloqRaw.split(",").map(s => s.trim()).filter(Boolean);
    if (fechaHora && fechasBloqueadas.length > 0) {
      // Extraer YYYY-MM-DD en zona CR. fechaHora puede venir como "2026-08-15T19:00"
      // (local sin TZ del datetime-local input) → tomamos los primeros 10 chars.
      const fechaCR = String(fechaHora).slice(0, 10);
      if (fechasBloqueadas.includes(fechaCR)) {
        return res.status(503).json({
          error: process.env.COTORREO_MENSAJE_BLOQUEO || `Ese día (${fechaCR}) no aceptamos reservas online. Podés llegar directo — atendemos por orden de llegada.`,
        });
      }
    }

    const faltan = [];
    if (!nombre) faltan.push("nombre");
    if (!telefono) faltan.push("telefono");
    if (!fechaHora) faltan.push("fechaHora");
    if (!personas) faltan.push("personas");

    const existing = await findClienteByTelefono(telefono);
    if (!existing) {
      if (!email) faltan.push("email");
      if (!cumpleanos && !(cumpleanosDia && cumpleanosMes))
        faltan.push("cumpleanos");
    }

    if (faltan.length)
      return res.status(400).json({ error: `Faltan: ${faltan.join(", ")}` });

    const startMesa = parseFechaHoraCR(fechaHora);
    const telefonoNormMesa = normalizeTelefono(telefono);
    const claveMutexMesa = `cotorreo|${telefonoNormMesa}|${startMesa ? startMesa.toISOString() : "no-start"}`;

    const resultadoMesa = await withMutex(claveMutexMesa, async () => {
      // ANTI-PASADO
      if (startMesa && startMesa.getTime() <= Date.now()) {
        const fmtCR = new Intl.DateTimeFormat("es-CR", {
          timeZone: "America/Costa_Rica",
          weekday: "short", day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: true,
        }).format(startMesa);
        return { code: 400, body: { error: `Esa hora (${fmtCR}) ya pasó. Elegí una fecha y hora a futuro.` } };
      }

      // ANTI-DUPLICADO ventana 60s
      const dupMesa = await findDuplicadoReciente({
        tabla: TABLES.ReservasCotorreo,
        campoInicio: "Fecha y hora",
        fields: {
          "Fecha y hora": startMesa.toISOString(),
          "Telefono cliente": telefonoNormMesa,
        },
        ventanaSeg: 60,
      });
      if (dupMesa) {
        return { code: 200, body: {
          ok: true, duplicado_detectado: true,
          reserva: { id: dupMesa.id, referencia: dupMesa.fields.Referencia },
        }};
      }

      const cliente = existing || await upsertCliente({
        nombre, telefono, email, cumpleanos, cumpleanosDia, cumpleanosMes,
        negocio: "Plaza Cotorreo",
      });

      const reserva = await create(
        TABLES.ReservasCotorreo,
        {
          "Nombre cliente": nombre,
          "Telefono cliente": telefonoNormMesa,
          "Email cliente": email,
          "Cumpleaños cliente": cumpleanos,
          "Fecha y hora": startMesa.toISOString(),
          Personas: Number(personas),
          Ocasion: ocasion || "Ninguna",
          Area: area || undefined,
          Estado: "Confirmada",
          Cliente: [cliente.id],
          Notas: notas || undefined,
          Referencia: `Cotorreo · ${nombre} · ${startMesa.toISOString()}`,
        },
        { typecast: true }
      );
      return { code: 200, body: {
        ok: true,
        reserva: { id: reserva.id, referencia: reserva.fields.Referencia },
      }};
    });
    return res.status(resultadoMesa.code).json(resultadoMesa.body);
  } catch (e) {
    console.error("POST reservas/cotorreo", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
