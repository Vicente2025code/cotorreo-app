/**
 * Rutas públicas (sin auth):
 * - GET  /api/disponibilidad/alpadel?fecha=YYYY-MM-DD
 * - GET  /api/disponibilidad/cotorreo?fecha=YYYY-MM-DD
 * - GET  /api/tarifas/alpadel
 * - POST /api/reservas/alpadel  (crear reserva pública)
 * - POST /api/reservas/cotorreo (crear reserva pública)
 */

const express = require("express");
const { TABLES, list, create, upsertCliente } = require("../airtable");

const router = express.Router();

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
      fecha,
      hora,
      duracion,
      cancha,
      notas,
    } = req.body;

    // Validaciones obligatorias
    const faltan = [];
    if (!nombre) faltan.push("nombre");
    if (!telefono) faltan.push("telefono");
    if (!email) faltan.push("email");
    if (!cumpleanos) faltan.push("cumpleanos");
    if (!fecha) faltan.push("fecha");
    if (!hora) faltan.push("hora");
    if (!duracion) faltan.push("duracion");
    if (!cancha || !["Singles", "Dobles"].includes(cancha))
      faltan.push("cancha");
    if (faltan.length) {
      return res.status(400).json({ error: `Faltan: ${faltan.join(", ")}` });
    }

    // Calcular Fecha y hora inicio + Hora fin (en CR, UTC-6)
    const [hH, hM] = hora.split(":").map(Number);
    const startCR = new Date(`${fecha}T${hora}:00-06:00`);
    const endCR = new Date(startCR.getTime() + duracion * 3600 * 1000);

    // Upsert cliente
    const cliente = await upsertCliente({
      nombre,
      telefono,
      email,
      cumpleanos,
      negocio: "Alpadel",
    });

    // Crear reserva
    const reserva = await create(
      TABLES.ReservasAlpadel,
      {
        "Nombre cliente": nombre,
        "Telefono cliente": telefono,
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

    res.json({
      ok: true,
      reserva: {
        id: reserva.id,
        referencia: reserva.fields.Referencia,
        precio: reserva.fields.Precio,
      },
    });
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
      fechaHora,
      personas,
      ocasion,
      area,
      notas,
    } = req.body;

    const faltan = [];
    if (!nombre) faltan.push("nombre");
    if (!telefono) faltan.push("telefono");
    if (!email) faltan.push("email");
    if (!cumpleanos) faltan.push("cumpleanos");
    if (!fechaHora) faltan.push("fechaHora");
    if (!personas) faltan.push("personas");
    if (faltan.length)
      return res.status(400).json({ error: `Faltan: ${faltan.join(", ")}` });

    const cliente = await upsertCliente({
      nombre,
      telefono,
      email,
      cumpleanos,
      negocio: "Plaza Cotorreo",
    });

    const reserva = await create(
      TABLES.ReservasCotorreo,
      {
        "Nombre cliente": nombre,
        "Telefono cliente": telefono,
        "Email cliente": email,
        "Cumpleaños cliente": cumpleanos,
        "Fecha y hora": new Date(fechaHora).toISOString(),
        Personas: Number(personas),
        Ocasion: ocasion || "Ninguna",
        Area: area || undefined,
        Estado: "Confirmada",
        Cliente: [cliente.id],
        Notas: notas || undefined,
        Referencia: `Cotorreo · ${nombre} · ${new Date(fechaHora).toISOString()}`,
      },
      { typecast: true }
    );

    res.json({
      ok: true,
      reserva: {
        id: reserva.id,
        referencia: reserva.fields.Referencia,
      },
    });
  } catch (e) {
    console.error("POST reservas/cotorreo", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
