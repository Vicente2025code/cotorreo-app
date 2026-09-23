/**
 * Rutas Gerencia — dashboards con $$$.
 * - GET /api/dashboard/kpis
 * - GET /api/dashboard/ingresos?desde=&hasta=
 * - GET /api/dashboard/top-clientes
 * - GET /api/dashboard/no-shows?mes=YYYY-MM
 * - GET /api/dashboard/comparativo
 */

const express = require("express");
const { TABLES, list } = require("../airtable");
const { requireAuth } = require("../auth");

const router = express.Router();

function todayCR() {
  const cr = new Date(Date.now() - 6 * 3600 * 1000);
  return cr.toISOString().slice(0, 10);
}

function mesActual() {
  return todayCR().slice(0, 7);
}

function rangoMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    inicio: `${mes}-01T00:00:00-06:00`,
    fin: `${mes}-${String(lastDay).padStart(2, "0")}T23:59:59-06:00`,
  };
}

async function sumarPrecio(tableId, campoFecha, inicio, fin) {
  const formula = `AND(
    IS_AFTER({${campoFecha}}, '${inicio}'),
    IS_BEFORE({${campoFecha}}, '${fin}'),
    OR({Estado}='Confirmada', {Estado}='Completada')
  )`.replace(/\s+/g, " ");
  const r = await list(tableId, { filterByFormula: formula });
  // BUG FIX: el campo "Precio" es una fórmula en Airtable. Cuando la fórmula falla
  // (ej. reserva sin Cancha o sin Tipo), Airtable devuelve un objeto {specialValue:"NaN"}
  // en lugar de un número. JavaScript hacía `0 + {object}` que convierte todo a string
  // y concatena los demás valores. Fix: forzar Number() para que NaN se vuelva 0.
  const total = r.records.reduce(
    (s, x) => s + (Number(x.fields["Precio"]) || 0),
    0
  );
  return { total, count: r.records.length, records: r.records };
}

// ===========================
// GET /api/dashboard/kpis
// ===========================
router.get("/dashboard/kpis", requireAuth(["gerencia"]), async (_req, res) => {
  try {
    const hoy = todayCR();
    const mes = mesActual();
    const { inicio: iniMes, fin: finMes } = rangoMes(mes);
    const iniHoy = `${hoy}T00:00:00-06:00`;
    const finHoy = `${hoy}T23:59:59-06:00`;

    const [alHoy, coHoy, alMes, coMes] = await Promise.all([
      sumarPrecio(TABLES.ReservasAlpadel, "Fecha y hora inicio", iniHoy, finHoy),
      sumarPrecio(TABLES.ReservasCotorreo, "Fecha y hora", iniHoy, finHoy),
      sumarPrecio(TABLES.ReservasAlpadel, "Fecha y hora inicio", iniMes, finMes),
      sumarPrecio(TABLES.ReservasCotorreo, "Fecha y hora", iniMes, finMes),
    ]);

    res.json({
      hoy: {
        ingresos: alHoy.total + coHoy.total,
        reservas: alHoy.count + coHoy.count,
        alpadel: { ingresos: alHoy.total, reservas: alHoy.count },
        cotorreo: { ingresos: coHoy.total, reservas: coHoy.count },
      },
      mes: {
        ingresos: alMes.total + coMes.total,
        reservas: alMes.count + coMes.count,
        alpadel: { ingresos: alMes.total, reservas: alMes.count },
        cotorreo: { ingresos: coMes.total, reservas: coMes.count },
      },
      fecha: hoy,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/dashboard/comparativo  — mes actual vs mes anterior
// ===========================
router.get("/dashboard/comparativo", requireAuth(["gerencia"]), async (_req, res) => {
  try {
    const ahora = new Date();
    const mesActualStr = mesActual();
    const fechaAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    const mesAnteriorStr = `${fechaAnterior.getFullYear()}-${String(
      fechaAnterior.getMonth() + 1
    ).padStart(2, "0")}`;

    const { inicio: iniActual, fin: finActual } = rangoMes(mesActualStr);
    const { inicio: iniAnterior, fin: finAnterior } = rangoMes(mesAnteriorStr);

    const [alAct, coAct, alAnt, coAnt] = await Promise.all([
      sumarPrecio(TABLES.ReservasAlpadel, "Fecha y hora inicio", iniActual, finActual),
      sumarPrecio(TABLES.ReservasCotorreo, "Fecha y hora", iniActual, finActual),
      sumarPrecio(TABLES.ReservasAlpadel, "Fecha y hora inicio", iniAnterior, finAnterior),
      sumarPrecio(TABLES.ReservasCotorreo, "Fecha y hora", iniAnterior, finAnterior),
    ]);

    const actual = {
      mes: mesActualStr,
      ingresos: alAct.total + coAct.total,
      reservas: alAct.count + coAct.count,
    };
    const anterior = {
      mes: mesAnteriorStr,
      ingresos: alAnt.total + coAnt.total,
      reservas: alAnt.count + coAnt.count,
    };
    const pct = (a, b) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

    res.json({
      actual,
      anterior,
      cambio: {
        ingresos: pct(actual.ingresos, anterior.ingresos),
        reservas: pct(actual.reservas, anterior.reservas),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/dashboard/top-clientes
// ===========================
router.get("/dashboard/top-clientes", requireAuth(["gerencia"]), async (_req, res) => {
  try {
    const r = await list(TABLES.Clientes, {
      sort: [{ field: "Total general", direction: "desc" }],
      maxRecords: 10,
    });
    res.json({
      top: r.records.map((c) => ({
        id: c.id,
        nombre: c.fields["Nombre completo"],
        telefono: c.fields.Telefono,
        totalReservas: c.fields["Total general"] || 0,
        alpadel: c.fields["Total reservas Alpadel"] || 0,
        cotorreo: c.fields["Total reservas Cotorreo"] || 0,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/dashboard/no-shows
// ===========================
router.get("/dashboard/no-shows", requireAuth(["gerencia"]), async (req, res) => {
  try {
    const mes = req.query.mes || mesActual();
    const { inicio, fin } = rangoMes(mes);

    const formulaAl = `AND(
      IS_AFTER({Fecha y hora inicio}, '${inicio}'),
      IS_BEFORE({Fecha y hora inicio}, '${fin}'),
      {Estado}='No-show'
    )`.replace(/\s+/g, " ");
    const formulaCo = `AND(
      IS_AFTER({Fecha y hora}, '${inicio}'),
      IS_BEFORE({Fecha y hora}, '${fin}'),
      {Estado}='No-show'
    )`.replace(/\s+/g, " ");

    const [al, co] = await Promise.all([
      list(TABLES.ReservasAlpadel, { filterByFormula: formulaAl }),
      list(TABLES.ReservasCotorreo, { filterByFormula: formulaCo }),
    ]);

    res.json({
      mes,
      alpadel: al.records.map((x) => ({
        id: x.id,
        cliente: x.fields["Nombre cliente"],
        fechaHora: x.fields["Fecha y hora inicio"],
      })),
      cotorreo: co.records.map((x) => ({
        id: x.id,
        cliente: x.fields["Nombre cliente"],
        fechaHora: x.fields["Fecha y hora"],
        personas: x.fields["Personas"],
      })),
      total: al.records.length + co.records.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/dashboard/maestros-facturacion?meses=12
// Cuánto factura cada maestro, mes por mes.
//
// SOLO GERENCIA a propósito: cada maestro ve únicamente lo suyo en su pestaña
// "Mi mes" (/api/mi-facturacion). Acá se ve el de todos y comparado, que es
// justamente lo que no deben ver entre ellos.
//
// Usa la MISMA regla que /api/mi-facturacion — Tipo de reserva = Maestro y
// Estado Confirmada o Completada — para que los números cuadren con lo que
// cada maestro ve en su propio panel.
// ===========================
router.get("/dashboard/maestros-facturacion", requireAuth(["gerencia"]), async (req, res) => {
  try {
    const meses = Math.min(Math.max(parseInt(req.query.meses, 10) || 12, 1), 24);

    const [maestrosR, reservasR] = await Promise.all([
      list(TABLES.Maestros, {}),
      list(TABLES.ReservasAlpadel, {
        filterByFormula:
          "AND({Tipo de reserva}='Maestro', OR({Estado}='Confirmada', {Estado}='Completada'))",
      }),
    ]);

    const nombres = {};
    for (const m of maestrosR.records) nombres[m.id] = m.fields.Nombre || "(sin nombre)";

    // El mes se calcula en hora Costa Rica, no en UTC: una clase de las 6pm del
    // 31 cae en UTC al día 1 del mes siguiente y se contaría en el mes que no es.
    const mesCR = (iso) =>
      new Date(new Date(iso).getTime() - 6 * 3600 * 1000).toISOString().slice(0, 7);
    const mesHoy = mesActual();

    const porMes = {};
    for (const r of reservasR.records) {
      const fh = r.fields["Fecha y hora inicio"];
      if (!fh) continue;
      const mes = mesCR(fh);
      for (const id of r.fields.Maestro || []) {
        if (!nombres[id]) continue;
        porMes[mes] = porMes[mes] || {};
        porMes[mes][id] = porMes[mes][id] || { clases: 0, horas: 0, monto: 0 };
        porMes[mes][id].clases += 1;
        porMes[mes][id].horas += r.fields["Duracion horas"] || 0;
        porMes[mes][id].monto += r.fields["Precio"] || 0;
      }
    }

    const filas = Object.keys(porMes)
      .sort()
      .reverse()
      .slice(0, meses)
      .map((mes) => {
        const detalle = porMes[mes];
        return {
          mes,
          // Los meses posteriores al actual son reservas agendadas, NO facturado.
          // Mezclarlos con lo cobrado da una cifra que no existe.
          futuro: mes > mesHoy,
          enCurso: mes === mesHoy,
          total: Object.values(detalle).reduce((s, v) => s + v.monto, 0),
          maestros: Object.entries(detalle).map(([id, v]) => ({ id, nombre: nombres[id], ...v })),
        };
      });

    res.json({
      maestros: Object.entries(nombres).map(([id, nombre]) => ({ id, nombre })),
      meses: filas,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
