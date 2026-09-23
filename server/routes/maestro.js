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
const { validarFechasCR, validarRangoHorario } = require("../horario");
const { withMutex } = require("../mutex");
const { generarReservasParaRecurrente, borrarReservasFuturasDeRecurrente } = require("./lili");

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

    // Traer:
    //  1) Reservas Tipo=Maestro (clases que él imparte).
    //  2) Reservas cualquier tipo cuyo Nombre cliente == nombre del maestro
    //     (las que él reservó como cliente, aunque no fueran Tipo=Maestro).
    // Filtramos por recordId / nombre en JS porque ARRAYJOIN({Maestro}) sobre
    // linked records da el nombre (no el ID) y por consistencia con /mi-facturacion.
    const maestroRec = await get(TABLES.Maestros, id);
    const nombreMaestro = (maestroRec.fields.Nombre || "").trim();
    const nombreSafe = nombreMaestro.replace(/'/g, "\\'");

    const formula = `AND(
      OR({Estado}='Confirmada', {Estado}='Completada'),
      OR({Tipo de reserva}='Maestro', LOWER(TRIM({Nombre cliente}))=LOWER('${nombreSafe}'))
    )`.replace(/\s+/g, " ");

    const r = await list(TABLES.ReservasAlpadel, {
      filterByFormula: formula,
      sort: [{ field: "Fecha y hora inicio", direction: "asc" }],
    });

    const nombreLower = nombreMaestro.toLowerCase();
    const todas = r.records
      .filter((rec) => {
        const tieneLink = Array.isArray(rec.fields.Maestro) && rec.fields.Maestro.includes(id);
        const nombreMatch = (rec.fields["Nombre cliente"] || "").trim().toLowerCase() === nombreLower;
        return tieneLink || nombreMatch;
      })
      .map((rec) => ({
        id: rec.id,
        fechaHora: rec.fields["Fecha y hora inicio"],
        horaFin: rec.fields["Hora fin"],
        cancha: rec.fields["Cancha"],
        estado: rec.fields["Estado"],
        tipo: rec.fields["Tipo de reserva"],
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

    const startCR = new Date(`${fecha}T${hora}:00-06:00`);
    const endCR = new Date(startCR.getTime() + duracion * 3600 * 1000);

    // FUERA DE HORARIO
    const fueraDeHorario = validarFechasCR(startCR, endCR);
    if (fueraDeHorario) return res.status(400).json({ error: fueraDeHorario });

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

    // MUTEX por (maestro, cancha, startISO): serializa POSTs concurrentes del
    // mismo slot para evitar la carrera check-then-write (caso Juan Bao 8-jul:
    // creó dos veces la misma reserva 18:00 Singles y anti-solapamiento no
    // detectó porque ambas leyeron Airtable antes de que ninguna escribiera).
    const claveMutex = `mi-reserva|${req.user.recordId}|${cancha}|${startCR.toISOString()}`;
    const resultado = await withMutex(claveMutex, async () => {
      // Anti-solapamiento DENTRO del mutex → ya no hay race
      const conflicto = await findAlpadelOverlap(cancha, startCR.toISOString(), endCR.toISOString());
      if (conflicto) {
        const fmt = (iso) => new Intl.DateTimeFormat("es-CR", {
          timeZone: "America/Costa_Rica",
          weekday: "short", day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: true,
        }).format(new Date(iso));
        return { code: 409, body: {
          error: `${cancha} ya está reservada de ${fmt(conflicto.inicio)} a ${fmt(conflicto.fin)} (${conflicto.nombre}). Elegí otro horario o la otra cancha.`,
          conflicto,
        }};
      }

      const m = await get(TABLES.Maestros, req.user.recordId);
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
      return { code: 200, body: { ok: true, id: r.id } };
    });
    return res.status(resultado.code).json(resultado.body);
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

    // Mismo motivo que /mis-reservas: filtramos en Airtable por Tipo/Estado/Fechas
    // y filtramos por Maestro=recordId en JS porque ARRAYJOIN({Maestro}) devuelve
    // el primary field (nombre), no el recordId.
    const formula = `AND(
      {Tipo de reserva}='Maestro',
      OR({Estado}='Confirmada', {Estado}='Completada'),
      IS_AFTER({Fecha y hora inicio}, '${inicio}'),
      IS_BEFORE({Fecha y hora inicio}, '${fin}')
    )`.replace(/\s+/g, " ");

    const r = await list(TABLES.ReservasAlpadel, { filterByFormula: formula });
    const ahora = new Date();
    const reservas = r.records
      .filter((x) => Array.isArray(x.fields.Maestro) && x.fields.Maestro.includes(id))
      .map((x) => {
        const fechaHora = x.fields["Fecha y hora inicio"];
        return {
          id: x.id,
          fechaHora,
          cancha: x.fields["Cancha"],
          duracion: x.fields["Duracion horas"] || 0,
          precio: x.fields["Precio"] || 0,
          pasada: new Date(fechaHora) < ahora,
        };
      });
    const pagado = reservas.filter((x) => x.pasada);
    const porPagar = reservas.filter((x) => !x.pasada);
    const agg = (arr) => ({
      clases: arr.length,
      horas: arr.reduce((s, x) => s + x.duracion, 0),
      monto: arr.reduce((s, x) => s + x.precio, 0),
    });
    const pagadoAgg = agg(pagado);
    const porPagarAgg = agg(porPagar);

    res.json({
      mes,
      reservas,
      pagado: pagadoAgg,
      porPagar: porPagarAgg,
      totalHoras: pagadoAgg.horas + porPagarAgg.horas,
      totalAPagar: pagadoAgg.monto + porPagarAgg.monto,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/mis-recurrentes  — recurrentes ACTIVAS del maestro logueado
// ===========================
router.get("/mis-recurrentes", requireAuth(["maestro"]), async (req, res) => {
  try {
    const id = req.user.recordId;
    const r = await list(TABLES.RecurrentesAlpadel, {
      filterByFormula: `{Activa}=TRUE()`,
    });
    // Mismo bug de ARRAYJOIN sobre linked records: filtrar en JS.
    const mias = r.records
      .filter((rec) => Array.isArray(rec.fields.Maestro) && rec.fields.Maestro.includes(id))
      .map((rec) => ({
        id: rec.id,
        referencia: rec.fields.Referencia,
        cancha: rec.fields.Cancha,
        diaSemana: rec.fields["Día semana"],
        horaInicio: rec.fields["Hora inicio"],
        horaFin: rec.fields["Hora fin"],
        fechaInicio: rec.fields["Fecha inicio"],
        fechaFin: rec.fields["Fecha fin"],
        tipo: rec.fields.Tipo,
        notas: rec.fields.Notas,
      }));
    res.json({ recurrentes: mias });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// POST /api/mi-recurrente  — crear recurrente del maestro
// Body: { cancha, diaSemana, horaInicio, horaFin, fechaInicio, fechaFin, notas? }
// ===========================
router.post("/mi-recurrente", requireAuth(["maestro"]), async (req, res) => {
  try {
    const { cancha, diaSemana, horaInicio, horaFin, fechaInicio, fechaFin, notas } = req.body;
    if (!cancha || !diaSemana || !horaInicio || !horaFin || !fechaInicio || !fechaFin) {
      return res.status(400).json({ error: "Faltan datos básicos" });
    }
    // Una recurrente mal armada no crea una reserva fuera de horario: crea
    // decenas, una por semana, hasta la fecha fin.
    const fueraDeHorario = validarRangoHorario(horaInicio, horaFin);
    if (fueraDeHorario) {
      return res.status(400).json({ error: fueraDeHorario });
    }
    const m = await get(TABLES.Maestros, req.user.recordId);
    const referencia = `Recurrente · ${m.fields.Nombre} · ${diaSemana} ${horaInicio}–${horaFin}`;

    // MUTEX + ANTI-DUPLICADO: si el maestro ya tiene una recurrente ACTIVA con
    // exactamente el mismo horario/cancha, devolver esa en lugar de crear
    // duplicada (caso Juan Bao: 3 recurrentes idénticas por doble-click).
    const claveDup = `mi-recurrente|${req.user.recordId}|${cancha}|${diaSemana}|${horaInicio}|${horaFin}`;
    const resultado = await withMutex(claveDup, async () => {
      const existentes = await list(TABLES.RecurrentesAlpadel, {
        filterByFormula: `AND({Activa}=TRUE(), {Cancha}='${cancha}', {Día semana}='${diaSemana}', {Hora inicio}='${horaInicio}', {Hora fin}='${horaFin}')`,
      });
      const yaExiste = (existentes.records || []).find((rec) => (rec.fields.Maestro || []).includes(req.user.recordId));
      if (yaExiste) {
        return { code: 200, body: {
          ok: true, duplicado_detectado: true,
          id: yaExiste.id, referencia: yaExiste.fields.Referencia,
          reservas_generadas: 0, reservas_saltadas: 0,
        }};
      }

      const fields = {
        Referencia: referencia,
        Cancha: cancha,
        "Día semana": diaSemana,
        "Hora inicio": horaInicio,
        "Hora fin": horaFin,
        "Fecha inicio": fechaInicio,
        "Fecha fin": fechaFin,
        Tipo: "Maestro",
        Activa: true,
        Maestro: [req.user.recordId],
        Notas: notas || undefined,
      };
      const r = await create(TABLES.RecurrentesAlpadel, fields, { typecast: true });
      let gen = { creadas: 0, saltadas: 0 };
      try {
        gen = await generarReservasParaRecurrente(r);
      } catch (e) {
        console.error("auto-generar tras POST /mi-recurrente:", e.message);
      }
      return { code: 200, body: {
        ok: true, id: r.id, referencia,
        reservas_generadas: gen.creadas, reservas_saltadas: gen.saltadas,
      }};
    });
    return res.status(resultado.code).json(resultado.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// DELETE /api/mi-recurrente/:id  — desactivar (no borrar) recurrente propia
// ===========================
router.delete("/mi-recurrente/:id", requireAuth(["maestro"]), async (req, res) => {
  try {
    const rec = await get(TABLES.RecurrentesAlpadel, req.params.id);
    const maestros = rec.fields.Maestro || [];
    if (!maestros.includes(req.user.recordId)) {
      return res.status(403).json({ error: "No puedes desactivar recurrentes de otros" });
    }
    const borrarFuturas = String(req.query.borrarFuturas || req.body?.borrarFuturas || "").toLowerCase() === "true";
    let futurasBorradas = 0;
    if (borrarFuturas) {
      futurasBorradas = await borrarReservasFuturasDeRecurrente(rec);
      // Borrar físicamente la recurrente (limpieza total)
      await require("../airtable").call("DELETE", `${TABLES.RecurrentesAlpadel}/${req.params.id}`);
      return res.json({ ok: true, futuras_borradas: futurasBorradas, recurrente_borrada: true });
    }
    await update(TABLES.RecurrentesAlpadel, req.params.id, { Activa: false });
    res.json({ ok: true, futuras_borradas: 0, recurrente_borrada: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
