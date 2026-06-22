/**
 * Rutas Maestro — solo ven SUS datos.
 * - GET    /api/mi-perfil
 * - GET    /api/mis-reservas
 * - POST   /api/mi-reserva
 * - DELETE /api/mi-reserva/:id
 * - GET    /api/mi-facturacion?mes=YYYY-MM
 */

const express = require("express");
const { TABLES, list, create, update, get, findAlpadelOverlap } = require("../airtable");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/mi-perfil", requireAuth(["maestro"]), async (req, res) => {
  try {
    const m = await get(TABLES.Maestros, req.user.recordId);
    res.json({
      id: m.id,
      nombre: m.fields.Nombre,
      email: m.fields.Email,
      telefono: m.fields.Telefono,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/mis-reservas", requireAuth(["maestro"]), async (req, res) => {
  try {
    const id = req.user.recordId;
    const ahora = new Date().toISOString();
    const formula = `AND(
      FIND('${id}', ARRAYJOIN({Maestro})) > 0,
      OR({Estado}='Confirmada', {Estado}='Completada')
    )`.replace(/\s+/g, " ");

    const r = await list(TABLES.ReservasAlpadel, {
      filterByFormula: formula,
      sort: [{ field: "Fecha y hora inicio", direction: "asc" }],
    });

    const todas = r.records.map((rec) => ({
      id: rec.id,
      fechaHora: rec.fields["Fecha y hora inicio"],
      horaFin: rec.fields["Hora fin"],
      cancha: rec.fields["Cancha"],
      estado: rec.fields["Estado"],
      notas: rec.fields["Notas"],
      duracion: rec.fields["Duracion horas"],
      precio: rec.fields["Precio"],
    }));

    const futuras = todas.filter((x) => x.fechaHora >= ahora);
    const pasadas = todas.filter((x) => x.fechaHora < ahora);

    res.json({ futuras, pasadas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/mi-reserva", requireAuth(["maestro"]), async (req, res) => {
  try {
    const { fecha, hora, duracion, cancha, notas } = req.body;
    if (!fecha || !hora || !duracion || !cancha)
      return res.status(400).json({ error: "Faltan datos" });

    const m = await get(TABLES.Maestros, req.user.recordId);
    const startCR = new Date(`${fecha}T${hora}:00-06:00`);
    const endCR = new Date(startCR.getTime() + duracion * 3600 * 1000);

    // BLOQUEO ANTI-PASADO — no permitir reservas para horas que ya pasaron
    if (startCR.getTime() <= Date.now()) {
      const fmtCR = new Intl.DateTimeFormat("es-CR", {
        timeZone: "America/Costa_Rica",
        weekday: "short", day: "numeric", month: "short",
        hour: "2-digit", minute: "2-digit", hour12: true,
      }).format(startCR);
      return res.status(400).json({
        error: `Esa hora (${fmtCR}) ya pasó. Elegí una fecha y hora a futuro.`,
      });
    }

    // BLOQUEO ANTI-SOLAPAMIENTO — verifica que la cancha esté libre antes de crear
    const conflicto = await findAlpadelOverlap(cancha, startCR.toISOString(), endCR.toISOString());
    if (conflicto) {
      const fmt = (iso) => new Intl.DateTimeFormat("es-CR", {
        timeZone: "America/Costa_Rica",
        weekday: "short", day: "numeric", month: "short",
        hour: "2-digit", minute: "2-digit", hour12: true,
      }).format(new Date(iso));
      return res.status(409).json({
        error: `${cancha} ya está reservada de ${fmt(conflicto.inicio)} a ${fmt(conflicto.fin)} (${conflicto.nombre}). Elegí otro horario o la otra cancha.`,
        conflicto,
      });
    }

    const r = await create(
      TABLES.ReservasAlpadel,
      {
        "Fecha y hora inicio": startCR.toISOString(),
        "Hora fin": endCR.toISOString(),
        Cancha: cancha,
        Estado: "Confirmada",
        "Tipo de reserva": "Maestro",
        Maestro: [req.user.recordId],
        "Nombre cliente": m.fields.Nombre,
        Notas: notas || undefined,
        Referencia: `Alpadel · ${m.fields.Nombre} · ${startCR.toISOString()}`,
      },
      { typecast: true }
    );
    res.json({ ok: true, id: r.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/mi-reserva/:id", requireAuth(["maestro"]), async (req, res) => {
  try {
    // Verificar que la reserva sea de este maestro antes de cancelar
    const reserva = await get(TABLES.ReservasAlpadel, req.params.id);
    const maestros = (reserva.fields.Maestro || []);
    if (!maestros.includes(req.user.recordId)) {
      return res.status(403).json({ error: "No puedes cancelar reservas de otros" });
    }
    await update(TABLES.ReservasAlpadel, req.params.id, {
      Estado: "Cancelada",
      Notas:
        (reserva.fields.Notas || "") +
        `\n[Cancelada por ${req.user.nombre} el ${new Date().toISOString()}]`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/mi-facturacion", requireAuth(["maestro"]), async (req, res) => {
  try {
    const id = req.user.recordId;
    const mes = req.query.mes || new Date().toISOString().slice(0, 7);
    const [year, month] = mes.split("-").map(Number);
    const inicio = `${mes}-01T00:00:00-06:00`;
    const lastDay = new Date(year, month, 0).getDate();
    const fin = `${mes}-${String(lastDay).padStart(2, "0")}T23:59:59-06:00`;

    const formula = `AND(
      FIND('${id}', ARRAYJOIN({Maestro})) > 0,
      {Tipo de reserva}='Maestro',
      OR({Estado}='Confirmada', {Estado}='Completada'),
      IS_AFTER({Fecha y hora inicio}, '${inicio}'),
      IS_BEFORE({Fecha y hora inicio}, '${fin}')
    )`.replace(/\s+/g, " ");

    const r = await list(TABLES.ReservasAlpadel, { filterByFormula: formula });
    const reservas = r.records.map((x) => ({
      id: x.id,
      fechaHora: x.fields["Fecha y hora inicio"],
      cancha: x.fields["Cancha"],
      duracion: x.fields["Duracion horas"],
      precio: x.fields["Precio"],
    }));
    const totalHoras = reservas.reduce((s, x) => s + (x.duracion || 0), 0);
    const totalAPagar = reservas.reduce((s, x) => s + (x.precio || 0), 0);

    res.json({ mes, reservas, totalHoras, totalAPagar });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
