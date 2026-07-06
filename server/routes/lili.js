/**
 * Rutas operativas (Lili, Gerencia, Saloneros).
 * - GET    /api/reservas/hoy
 * - GET    /api/reservas/semana
 * - PATCH  /api/reservas/:tipo/:id/estado
 * - POST   /api/reservas/alpadel/manual
 * - POST   /api/reservas/cotorreo/manual
 * - GET    /api/paquetes
 * - POST   /api/paquetes
 * - GET    /api/recurrentes
 * - POST   /api/recurrentes
 * - PATCH  /api/recurrentes/:id
 * - GET    /api/maestros
 * - GET    /api/maestros/:id/facturacion?mes=YYYY-MM
 * - GET    /api/clientes/buscar?q=...
 * - GET    /api/cumpleanos/mes
 */

const express = require("express");
const { TABLES, list, get, create, update, upsertCliente, findClienteByTelefono, normalizeTelefono, parseFechaHoraCR, findAlpadelOverlap } = require("../airtable");
const { requireAuth } = require("../auth");
const { withMutex } = require("../mutex");
const mantenimiento = require("../airtableMantenimiento");

const router = express.Router();

// Roles que pueden operar: lili, gerencia, saloneros
const OPERATIVO = ["lili", "gerencia", "saloneros"];
const ADMIN = ["lili", "gerencia"];

// Record IDs de usuarios en tabla Usuarios de la base Mantenimiento (para "Reportado por")
const USER_REC_BY_ROL = {
  lili: "recGLO0rlj3MeTeyQ",       // Lili (Supervisor)
  gerencia: "recdLbQkejwhIPyqo",   // Vicente (Administrador)
};

// Helpers de fecha
function todayCR() {
  const now = new Date();
  // CR es UTC-6
  const cr = new Date(now.getTime() - 6 * 3600 * 1000);
  return cr.toISOString().slice(0, 10);
}

function startOfDayCR(fecha) {
  return `${fecha}T00:00:00.000-06:00`;
}
function endOfDayCR(fecha) {
  return `${fecha}T23:59:59.999-06:00`;
}

// ===========================
// GET /api/reservas/hoy
// Devuelve { alpadel: [], cotorreo: [] }
// ===========================
router.get("/reservas/hoy", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const fecha = req.query.fecha || todayCR();
    const ini = startOfDayCR(fecha);
    const fin = endOfDayCR(fecha);

    const formAl = `AND(IS_AFTER({Fecha y hora inicio}, '${ini}'), IS_BEFORE({Fecha y hora inicio}, '${fin}'))`;
    const formCo = `AND(IS_AFTER({Fecha y hora}, '${ini}'), IS_BEFORE({Fecha y hora}, '${fin}'))`;

    const [al, co] = await Promise.all([
      list(TABLES.ReservasAlpadel, {
        filterByFormula: formAl,
        sort: [{ field: "Fecha y hora inicio", direction: "asc" }],
      }),
      list(TABLES.ReservasCotorreo, {
        filterByFormula: formCo,
        sort: [{ field: "Fecha y hora", direction: "asc" }],
      }),
    ]);

    res.json({
      fecha,
      alpadel: al.records.map(simplifyAlpadel),
      cotorreo: co.records.map(simplifyCotorreo),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

function simplifyAlpadel(r) {
  const f = r.fields;
  return {
    id: r.id,
    fechaHora: f["Fecha y hora inicio"],
    horaFin: f["Hora fin"],
    nombre: f["Nombre cliente"],
    telefono: f["Telefono cliente"],
    cancha: f["Cancha"],
    tipo: f["Tipo de reserva"],
    estado: f["Estado"],
    notas: f["Notas"],
    precio: f["Precio"],
    duracion: f["Duracion horas"],
    maestroId: (f["Maestro"] || [])[0] || null,
    paqueteId: (f["Paquete usado"] || [])[0] || null,
  };
}
function simplifyCotorreo(r) {
  const f = r.fields;
  return {
    id: r.id,
    fechaHora: f["Fecha y hora"],
    nombre: f["Nombre cliente"],
    telefono: f["Telefono cliente"],
    personas: f["Personas"],
    ocasion: f["Ocasion"],
    area: f["Area"],
    estado: f["Estado"],
    notas: f["Notas"],
    precio: f["Precio"],
  };
}

// ===========================
// GET /api/reservas/calendario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve { alpadel: [], cotorreo: [], desde, hasta }
// Excluye reservas Canceladas para no llenar el calendario de ruido
// ===========================
router.get("/reservas/calendario", requireAuth([...OPERATIVO, "maestro"]), async (req, res) => {
  try {
    const desde = req.query.desde || todayCR();
    const hasta = req.query.hasta || desde;
    const ini = startOfDayCR(desde);
    const fin = endOfDayCR(hasta);

    // Maestros solo ven reservas de canchas (Alpadel), no de mesas (Cotorreo).
    // Para ellos saltamos la query a Cotorreo y devolvemos cotorreo vacío.
    const esMaestro = req.user && req.user.rol === "maestro";

    const formAl = `AND(IS_AFTER({Fecha y hora inicio}, '${ini}'), IS_BEFORE({Fecha y hora inicio}, '${fin}'), {Estado} != 'Cancelada')`;
    const formCo = `AND(IS_AFTER({Fecha y hora}, '${ini}'), IS_BEFORE({Fecha y hora}, '${fin}'), {Estado} != 'Cancelada')`;

    const [al, co] = await Promise.all([
      list(TABLES.ReservasAlpadel, {
        filterByFormula: formAl,
        sort: [{ field: "Fecha y hora inicio", direction: "asc" }],
      }),
      esMaestro
        ? Promise.resolve({ records: [] })
        : list(TABLES.ReservasCotorreo, {
            filterByFormula: formCo,
            sort: [{ field: "Fecha y hora", direction: "asc" }],
          }),
    ]);

    res.json({
      desde,
      hasta,
      alpadel: al.records.map(simplifyAlpadel),
      cotorreo: co.records.map(simplifyCotorreo),
    });
  } catch (e) {
    console.error("GET /reservas/calendario", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// PATCH /api/reservas/:tipo/:id/estado
// Body: { estado: "Completada" | "No-show" | "Cancelada" | "Confirmada" }
// ===========================
router.patch(
  "/reservas/:tipo/:id/estado",
  requireAuth(OPERATIVO),
  async (req, res) => {
    try {
      const { tipo, id } = req.params;
      const { estado } = req.body;
      const validos = ["Confirmada", "Completada", "No-show", "Cancelada"];
      if (!validos.includes(estado))
        return res.status(400).json({ error: "Estado inválido" });

      const tableId =
        tipo === "alpadel" ? TABLES.ReservasAlpadel : TABLES.ReservasCotorreo;
      const updated = await update(tableId, id, { Estado: estado });
      res.json({ ok: true, id: updated.id, estado: updated.fields.Estado });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ===========================
// POST /api/reservas/alpadel/manual
// Crea reserva sin pasar por el form público (vos / Lili / saloneros)
// ===========================
router.post(
  "/reservas/alpadel/manual",
  requireAuth(OPERATIVO),
  async (req, res) => {
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
        tipo, // Regular, Paquete, Maestro, Bloqueo, Cortesia
        maestroId, // si tipo=Maestro
        paqueteId, // si tipo=Paquete
        notas,
      } = req.body;

      if (!fecha || !hora || !duracion || !cancha)
        return res.status(400).json({ error: "Faltan datos básicos" });

      const startCR = new Date(`${fecha}T${hora}:00-06:00`);
      const endCR = new Date(startCR.getTime() + duracion * 3600 * 1000);

      // BLOQUEO ANTI-PASADO — no permitir reservas para horas que ya pasaron.
      // El operativo puede forzar con `force: true` si está registrando una reserva pasada legítima.
      if (!req.body.force && startCR.getTime() <= Date.now()) {
        const fmtCR = new Intl.DateTimeFormat("es-CR", {
          timeZone: "America/Costa_Rica",
          weekday: "short", day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: true,
        }).format(startCR);
        return res.status(400).json({
          error: `Esa hora (${fmtCR}) ya pasó. Usá force=true si querés registrarla igual.`,
        });
      }

      // BLOQUEO ANTI-SOLAPAMIENTO — verifica que la cancha esté libre antes de crear.
      // El operativo puede forzar con `force: true` si sabe lo que hace (ej. dobles paralelos en torneo).
      if (!req.body.force) {
        const conflicto = await findAlpadelOverlap(cancha, startCR.toISOString(), endCR.toISOString());
        if (conflicto) {
          const fmtCR = (iso) => new Intl.DateTimeFormat("es-CR", {
            timeZone: "America/Costa_Rica",
            weekday: "short", day: "numeric", month: "short",
            hour: "2-digit", minute: "2-digit", hour12: false,
          }).format(new Date(iso));
          return res.status(409).json({
            error: `${cancha} ya está reservada de ${fmtCR(conflicto.inicio)} a ${fmtCR(conflicto.fin)} para ${conflicto.nombre} (${conflicto.tipo || "Regular"}). Cambia el horario o envía force=true para sobreescribir.`,
            conflicto,
          });
        }
      }

      const fields = {
        "Fecha y hora inicio": startCR.toISOString(),
        "Hora fin": endCR.toISOString(),
        Cancha: cancha,
        Estado: "Confirmada",
        "Tipo de reserva": tipo || "Regular",
        Notas: notas || undefined,
      };

      // Si es Bloqueo o Cortesía no necesita cliente
      if (tipo === "Bloqueo") {
        fields["Nombre cliente"] = nombre || "BLOQUEO";
        fields.Referencia = `Alpadel · BLOQUEO · ${startCR.toISOString()}`;
      } else if (tipo === "Maestro") {
        if (!maestroId)
          return res
            .status(400)
            .json({ error: "tipo=Maestro requiere maestroId" });
        fields.Maestro = [maestroId];
        // Obtener nombre del maestro
        const m = await get(TABLES.Maestros, maestroId);
        fields["Nombre cliente"] = m.fields.Nombre;
        fields.Referencia = `Alpadel · ${m.fields.Nombre} · ${startCR.toISOString()}`;
      } else {
        // Regular / Paquete / Cortesía → necesita cliente
        if (!nombre || !telefono)
          return res
            .status(400)
            .json({ error: "Para este tipo se necesita nombre y telefono" });
        const { cumpleanosDia, cumpleanosMes, clienteId } = req.body;
        let cliente;
        if (clienteId) {
          cliente = await get(TABLES.Clientes, clienteId);
        } else {
          cliente = await upsertCliente({
            nombre,
            telefono,
            email,
            cumpleanos,
            cumpleanosDia,
            cumpleanosMes,
            negocio: "Alpadel",
          });
        }
        fields.Cliente = [cliente.id];
        fields["Nombre cliente"] = nombre;
        fields["Telefono cliente"] = normalizeTelefono(telefono);
        fields["Email cliente"] = email;
        if (cumpleanos) fields["Cumpleaños cliente"] = cumpleanos;
        if (tipo === "Paquete" && paqueteId) {
          fields["Paquete usado"] = [paqueteId];
        }
        fields.Referencia = `Alpadel · ${nombre} · ${startCR.toISOString()}`;
      }

      const r = await create(TABLES.ReservasAlpadel, fields, { typecast: true });
      res.json({ ok: true, reserva: simplifyAlpadel(r) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ===========================
// POST /api/reservas/cotorreo/manual
// ===========================
router.post(
  "/reservas/cotorreo/manual",
  requireAuth(OPERATIVO),
  async (req, res) => {
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
        clienteId,
      } = req.body;

      if (!nombre || !telefono || !fechaHora || !personas)
        return res.status(400).json({ error: "Faltan datos" });

      const cliente = clienteId
        ? await get(TABLES.Clientes, clienteId)
        : await upsertCliente({
            nombre,
            telefono,
            email,
            cumpleanos,
            cumpleanosDia,
            cumpleanosMes,
            negocio: "Plaza Cotorreo",
          });

      const r = await create(
        TABLES.ReservasCotorreo,
        {
          "Nombre cliente": nombre,
          "Telefono cliente": normalizeTelefono(telefono),
          "Email cliente": email,
          "Cumpleaños cliente": cumpleanos,
          // BUG FIX timezone: parseFechaHoraCR interpreta el input "YYYY-MM-DDTHH:MM" como hora CR (UTC-6).
          // Antes `new Date(fechaHora)` lo interpretaba como UTC en Render → -6h al renderizar (7pm aparecía como 1pm).
          "Fecha y hora": parseFechaHoraCR(fechaHora).toISOString(),
          Personas: Number(personas),
          Ocasion: ocasion || "Ninguna",
          Area: area || undefined,
          Estado: "Confirmada",
          Cliente: [cliente.id],
          Notas: notas || undefined,
          Referencia: `Cotorreo · ${nombre} · ${parseFechaHoraCR(fechaHora).toISOString()}`,
        },
        { typecast: true }
      );
      res.json({ ok: true, reserva: simplifyCotorreo(r) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ===========================
// POST /api/clientes/manual  — capturar cliente sin reserva
// Útil para que el operativo registre contactos que pasaron por el negocio
// pero no reservaron en ese momento (CRM básico).
// Body: { nombre, telefono, email?, cumpleanosDia?, cumpleanosMes?, negocio? }
// Si el teléfono ya existe, devuelve el cliente existente (no duplica).
// ===========================
router.post("/clientes/manual", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const { nombre, telefono, email, cumpleanosDia, cumpleanosMes, negocio } = req.body || {};
    if (!nombre || !telefono) {
      return res.status(400).json({ error: "Falta nombre o teléfono" });
    }
    const phone = normalizeTelefono(telefono);
    if (!phone) return res.status(400).json({ error: "Teléfono inválido" });

    // Detectar si el teléfono ya existe para informar al frontend
    const existente = await findClienteByTelefono(phone);
    const cliente = await upsertCliente({
      nombre, telefono, email,
      cumpleanosDia, cumpleanosMes,
      negocio,
    });
    res.json({
      ok: true,
      ya_existia: !!existente,
      cliente: {
        id: cliente.id,
        nombre: cliente.fields["Nombre completo"],
        telefono: cliente.fields.Telefono,
        email: cliente.fields.Email,
      },
    });
  } catch (e) {
    console.error("POST /clientes/manual", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/paquetes  (lista todos los activos)
// ===========================
router.get("/paquetes", requireAuth(OPERATIVO), async (_req, res) => {
  try {
    const r = await list(TABLES.Paquetes, {
      filterByFormula: `{Estado}='Activo'`,
      sort: [{ field: "Fecha vencimiento", direction: "asc" }],
    });
    res.json({
      paquetes: r.records.map((rec) => ({
        id: rec.id,
        referencia: rec.fields.Referencia,
        clienteId: (rec.fields.Cliente || [])[0],
        horasCompradas: rec.fields["Horas compradas"],
        horasUsadas: rec.fields["Horas usadas"] || 0,
        horasRestantes: rec.fields["Horas restantes"],
        precioTotal: rec.fields["Precio total"],
        fechaCompra: rec.fields["Fecha compra"],
        fechaVencimiento: rec.fields["Fecha vencimiento"],
        estado: rec.fields.Estado,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/paquetes", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const { clienteId, horasCompradas, precioTotal, notas } = req.body;
    if (!clienteId || !horasCompradas || !precioTotal)
      return res.status(400).json({ error: "Faltan datos" });

    const cliente = await get(TABLES.Clientes, clienteId);
    const fechaCompra = new Date().toISOString().slice(0, 10);

    const r = await create(
      TABLES.Paquetes,
      {
        Referencia: `PAQ-${cliente.fields["Nombre completo"]}-${fechaCompra}`,
        Cliente: [clienteId],
        "Horas compradas": Number(horasCompradas),
        "Precio total": Number(precioTotal),
        "Fecha compra": fechaCompra,
        Notas: notas || undefined,
      },
      { typecast: true }
    );
    res.json({ ok: true, paquete: r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/recurrentes / POST / PATCH
// ===========================
router.get("/recurrentes", requireAuth(OPERATIVO), async (_req, res) => {
  try {
    const r = await list(TABLES.RecurrentesAlpadel, {
      filterByFormula: `{Activa}=TRUE()`,
    });
    res.json({ recurrentes: r.records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: borrar reservas FUTURAS (aún no ocurridas) vinculadas a una recurrente.
// Busca por 2 vías porque el linked record se rompe cuando la recurrente se
// borra físicamente:
//   1) Reservas con {Reserva recurrente origen} apuntando al recurrenteId.
//   2) Reservas HUÉRFANAS: mismo patrón (día, hora, cancha, maestro/cliente)
//      que la recurrente, aunque ya no tengan el linked record.
// Devuelve la cantidad borrada.
async function borrarReservasFuturasDeRecurrente(recurrente) {
  const ahoraISO = new Date().toISOString();
  const recurId = typeof recurrente === "string" ? recurrente : recurrente.id;
  const f = typeof recurrente === "string" ? null : recurrente.fields;

  // 1) Vía linked record
  const formula1 = `AND( IS_AFTER({Fecha y hora inicio}, '${ahoraISO}'), NOT({Reserva recurrente origen}='') )`;
  const r1 = await list(TABLES.ReservasAlpadel, { filterByFormula: formula1 });
  const linked = (r1.records || []).filter((rec) => (rec.fields["Reserva recurrente origen"] || []).includes(recurId));

  // 2) Vía patrón (huérfanas): reservas Tipo=Maestro con el mismo maestro/cancha
  //    y misma hora. Solo si tenemos los fields de la recurrente.
  let huerfanas = [];
  if (f) {
    const maestroId = (f.Maestro || [])[0];
    const clienteId = (f.Cliente || [])[0];
    const cancha = f.Cancha;
    const horaInicio = f["Hora inicio"];
    const tipo = f.Tipo || "Maestro";
    if (cancha && horaInicio) {
      const formula2 = `AND( IS_AFTER({Fecha y hora inicio}, '${ahoraISO}'), {Cancha}='${cancha}', {Tipo de reserva}='${tipo}' )`;
      const r2 = await list(TABLES.ReservasAlpadel, { filterByFormula: formula2 });
      const dejaId = new Set(linked.map((x) => x.id));
      huerfanas = (r2.records || []).filter((rec) => {
        if (dejaId.has(rec.id)) return false; // ya está en linked
        // Filtrar por maestro/cliente igual a la recurrente
        if (maestroId && !(rec.fields.Maestro || []).includes(maestroId)) return false;
        if (clienteId && !(rec.fields.Cliente || []).includes(clienteId)) return false;
        // Filtrar por hora exacta (HH:MM CR). La reserva guarda ISO UTC.
        const iso = rec.fields["Fecha y hora inicio"] || "";
        const d = new Date(iso);
        // CR = UTC-6
        const cr = new Date(d.getTime() - 6 * 3600 * 1000);
        const hhCR = String(cr.getUTCHours()).padStart(2, "0");
        const mmCR = String(cr.getUTCMinutes()).padStart(2, "0");
        return `${hhCR}:${mmCR}` === horaInicio;
      });
    }
  }

  const todos = [...linked, ...huerfanas];
  let borradas = 0;
  for (const rec of todos) {
    try {
      await require("../airtable").call("DELETE", `${TABLES.ReservasAlpadel}/${rec.id}`);
      borradas++;
    } catch (e) {
      console.error("borrar futura", rec.id, e.message);
    }
  }
  return borradas;
}

// DELETE /api/recurrentes/:id?borrarFuturas=true
// - Sin borrarFuturas (default): solo Activa=false (queda como registro histórico).
// - Con borrarFuturas=true: borra reservas futuras (linked + huérfanas) y
//   BORRA FÍSICAMENTE la recurrente, así el patrón desaparece limpio.
router.delete("/recurrentes/:id", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const borrarFuturas = String(req.query.borrarFuturas || req.body?.borrarFuturas || "").toLowerCase() === "true";
    let futurasBorradas = 0;
    if (borrarFuturas) {
      // Primero leer la recurrente para conocer patrón (maestro/cancha/hora)
      const recur = await get(TABLES.RecurrentesAlpadel, req.params.id);
      futurasBorradas = await borrarReservasFuturasDeRecurrente(recur);
      // Luego borrar físicamente la recurrente
      await require("../airtable").call("DELETE", `${TABLES.RecurrentesAlpadel}/${req.params.id}`);
      return res.json({ ok: true, futuras_borradas: futurasBorradas, recurrente_borrada: true });
    }
    await update(TABLES.RecurrentesAlpadel, req.params.id, { Activa: false });
    res.json({ ok: true, futuras_borradas: 0, recurrente_borrada: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: materializa las reservas individuales de UNA recurrente desde
// max(hoy, Fecha inicio) hasta Fecha fin. Idempotente. Exportada al final.
// Usada tanto por el endpoint manual /recurrentes/generar como por los
// POST /recurrentes y POST /mi-recurrente (auto-generación al crear).
async function generarReservasParaRecurrente(recur, yaExisten = null) {
  const DIAS_NUM = { "Domingo": 0, "Lunes": 1, "Martes": 2, "Miércoles": 3, "Jueves": 4, "Viernes": 5, "Sábado": 6 };
  const f = recur.fields;
  const diaNum = DIAS_NUM[f["Día semana"]];
  if (diaNum == null || !f.Cancha || !f["Hora inicio"] || !f["Hora fin"]) {
    return { creadas: 0, saltadas: 0, detalles: [] };
  }
  const ahora = new Date();
  const fechaInicio = f["Fecha inicio"] ? new Date(f["Fecha inicio"] + "T00:00:00-06:00") : ahora;
  const fechaFin = f["Fecha fin"]
    ? new Date(f["Fecha fin"] + "T23:59:59-06:00")
    : new Date(ahora.getTime() + 365 * 86400000);
  const desde = new Date(Math.max(ahora.getTime(), fechaInicio.getTime()));
  const limite = fechaFin;

  // Si no recibimos el set de existentes, lo construimos consultando Airtable
  // para esta recurrente puntual.
  if (yaExisten == null) {
    yaExisten = new Set();
    const existentes = await list(TABLES.ReservasAlpadel, {
      filterByFormula: `AND( IS_AFTER({Fecha y hora inicio}, '${desde.toISOString()}'), IS_BEFORE({Fecha y hora inicio}, '${limite.toISOString()}'), NOT({Reserva recurrente origen}='') )`.replace(/\s+/g, " "),
    });
    for (const x of existentes.records) {
      const recurId = (x.fields["Reserva recurrente origen"] || [])[0];
      const fecha = x.fields["Fecha y hora inicio"];
      if (recurId === recur.id && fecha) yaExisten.add(`${recurId}|${fecha}`);
    }
  }

  let cursor = new Date(desde);
  cursor.setUTCHours(12, 0, 0, 0);
  let creadas = 0, saltadas = 0;
  const detalles = [];

  while (cursor.getTime() <= limite.getTime()) {
    const crDayShift = new Date(cursor.getTime() - 6 * 3600 * 1000);
    if (crDayShift.getUTCDay() === diaNum) {
      const y = crDayShift.getUTCFullYear();
      const mo = String(crDayShift.getUTCMonth() + 1).padStart(2, "0");
      const d = String(crDayShift.getUTCDate()).padStart(2, "0");
      const fechaCR = `${y}-${mo}-${d}`;
      const startCR = new Date(`${fechaCR}T${f["Hora inicio"]}:00-06:00`);
      const endCR = new Date(`${fechaCR}T${f["Hora fin"]}:00-06:00`);

      if (startCR.getTime() <= Date.now()) {
        saltadas++; cursor.setUTCDate(cursor.getUTCDate() + 1); continue;
      }
      const key = `${recur.id}|${startCR.toISOString()}`;
      if (yaExisten.has(key)) {
        saltadas++; cursor.setUTCDate(cursor.getUTCDate() + 1); continue;
      }

      const fields = {
        "Fecha y hora inicio": startCR.toISOString(),
        "Hora fin": endCR.toISOString(),
        Cancha: f.Cancha,
        Estado: "Confirmada",
        "Tipo de reserva": f.Tipo || "Regular",
        "Reserva recurrente origen": [recur.id],
        Referencia: f.Referencia,
        Notas: f.Notas || undefined,
      };
      const cliente = (f.Cliente || [])[0];
      const maestro = (f.Maestro || [])[0];
      if (cliente) fields.Cliente = [cliente];
      if (maestro) {
        fields.Maestro = [maestro];
        if (!cliente) {
          try {
            const m = await get(TABLES.Maestros, maestro);
            fields["Nombre cliente"] = m.fields.Nombre;
          } catch (_) {}
        }
      }
      try {
        await create(TABLES.ReservasAlpadel, fields, { typecast: true });
        yaExisten.add(key);
        creadas++;
        if (detalles.length < 50) detalles.push(`${f.Referencia || "(s/r)"} → ${fechaCR} ${f["Hora inicio"]}`);
      } catch (e) {
        saltadas++;
        console.error("generarReservasParaRecurrente create error", e.message);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { creadas, saltadas, detalles };
}

// POST /api/recurrentes/generar — materializa TODAS las reservas pendientes
// de las recurrentes activas. Útil como herramienta de mantenimiento o si
// algo falló en la generación automática al crear.
router.post("/recurrentes/generar", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const recurResp = await list(TABLES.RecurrentesAlpadel, { filterByFormula: `{Activa}=TRUE()` });
    if (!recurResp.records.length) {
      return res.json({ ok: true, recurrentes_activas: 0, creadas: 0, saltadas: 0, detalles: [] });
    }

    // Traer todas las reservas ya existentes vinculadas a alguna recurrente,
    // desde hoy hasta el MAX de fechas fin — para detectar duplicados.
    const ahora = new Date();
    const TOPE_DEFAULT = new Date(ahora.getTime() + 365 * 86400000);
    const fechasFin = recurResp.records
      .map(r => r.fields["Fecha fin"])
      .filter(Boolean)
      .map(s => new Date(s + "T23:59:59-06:00").getTime());
    const hasta = fechasFin.length
      ? new Date(Math.max(TOPE_DEFAULT.getTime(), ...fechasFin))
      : TOPE_DEFAULT;
    const existentesResp = await list(TABLES.ReservasAlpadel, {
      filterByFormula: `AND( IS_AFTER({Fecha y hora inicio}, '${ahora.toISOString()}'), IS_BEFORE({Fecha y hora inicio}, '${hasta.toISOString()}'), NOT({Reserva recurrente origen}='') )`.replace(/\s+/g, " "),
    });
    const yaExisten = new Set();
    for (const r of existentesResp.records) {
      const recurId = (r.fields["Reserva recurrente origen"] || [])[0];
      const fecha = r.fields["Fecha y hora inicio"];
      if (recurId && fecha) yaExisten.add(`${recurId}|${fecha}`);
    }

    let creadas = 0, saltadas = 0;
    const detalles = [];
    for (const recur of recurResp.records) {
      const r = await generarReservasParaRecurrente(recur, yaExisten);
      creadas += r.creadas;
      saltadas += r.saltadas;
      detalles.push(...r.detalles);
    }
    res.json({
      ok: true,
      recurrentes_activas: recurResp.records.length,
      creadas,
      saltadas,
      detalles: detalles.slice(0, 50),
    });
  } catch (e) {
    console.error("POST /recurrentes/generar", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/recurrentes", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const {
      referencia,
      clienteId,
      maestroId,
      cancha,
      diaSemana,
      horaInicio,
      horaFin,
      fechaInicio,
      fechaFin,
      tipo,
    } = req.body;

    // MUTEX + ANTI-DUPLICADO: si ya existe una recurrente activa con el
    // mismo maestro/cliente + cancha + día + hora inicio + hora fin, devolver
    // esa en lugar de crear una copia. Clave incluye maestroId/clienteId
    // para que 2 maestros distintos puedan reservar el mismo horario.
    const claveDup = `recurrente|${maestroId || ""}|${clienteId || ""}|${cancha}|${diaSemana}|${horaInicio}|${horaFin}`;
    const resultado = await withMutex(claveDup, async () => {
      // Anti-duplicado: buscar activa con match completo
      const existentes = await list(TABLES.RecurrentesAlpadel, {
        filterByFormula: `AND({Activa}=TRUE(), {Cancha}='${cancha}', {Día semana}='${diaSemana}', {Hora inicio}='${horaInicio}', {Hora fin}='${horaFin}')`,
      });
      const yaExiste = (existentes.records || []).find((rec) => {
        const mIds = rec.fields.Maestro || [];
        const cIds = rec.fields.Cliente || [];
        return (maestroId && mIds.includes(maestroId)) || (clienteId && cIds.includes(clienteId));
      });
      if (yaExiste) {
        return { code: 200, body: {
          ok: true, duplicado_detectado: true,
          recurrente: yaExiste, reservas_generadas: 0, reservas_saltadas: 0,
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
        Tipo: tipo,
        Activa: true,
      };
      if (clienteId) fields.Cliente = [clienteId];
      if (maestroId) fields.Maestro = [maestroId];

      const r = await create(TABLES.RecurrentesAlpadel, fields, { typecast: true });
      // Auto-generar reservas pendientes.
      let gen = { creadas: 0, saltadas: 0 };
      try {
        gen = await generarReservasParaRecurrente(r);
      } catch (e) {
        console.error("auto-generar tras POST /recurrentes:", e.message);
      }
      return { code: 200, body: {
        ok: true, recurrente: r,
        reservas_generadas: gen.creadas, reservas_saltadas: gen.saltadas,
      }};
    });
    return res.status(resultado.code).json(resultado.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/maestros
// ===========================
router.get("/maestros", requireAuth(OPERATIVO), async (_req, res) => {
  try {
    const r = await list(TABLES.Maestros, {
      filterByFormula: `{Activo}=TRUE()`,
    });
    res.json({
      maestros: r.records.map((m) => ({
        id: m.id,
        nombre: m.fields.Nombre,
        email: m.fields.Email,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/maestros/:id/facturacion?mes=YYYY-MM
// ===========================
router.get(
  "/maestros/:id/facturacion",
  requireAuth(ADMIN),
  async (req, res) => {
    try {
      const { id } = req.params;
      const mes = req.query.mes || new Date().toISOString().slice(0, 7);
      const [year, month] = mes.split("-").map(Number);
      const inicio = `${mes}-01T00:00:00-06:00`;
      const lastDay = new Date(year, month, 0).getDate();
      const fin = `${mes}-${String(lastDay).padStart(2, "0")}T23:59:59-06:00`;

      // Necesitamos el nombre del maestro para también buscar reservas donde el
      // cliente sea el propio maestro (caso: reservó como Regular antes de ser
      // dado de alta como maestro). Petición de Vicente: contar TODAS las
      // reservas del maestro, no solo las marcadas Tipo='Maestro'.
      const maestroRec = await get(TABLES.Maestros, id);
      const nombreMaestro = (maestroRec.fields.Nombre || "").trim();
      // Escape simple para apóstrofos en el nombre (no esperado en estos casos).
      const nombreSafe = nombreMaestro.replace(/'/g, "\\'");

      // Filtramos en Airtable por estado y fechas. La inclusión por maestro o
      // por nombre se hace en JS porque ARRAYJOIN sobre linked records devuelve
      // el primary field (no el recordId) y mezclarlo con un OR por nombre se
      // vuelve complicado.
      const formula = `AND(
        OR({Estado}='Confirmada', {Estado}='Completada'),
        IS_AFTER({Fecha y hora inicio}, '${inicio}'),
        IS_BEFORE({Fecha y hora inicio}, '${fin}'),
        OR({Tipo de reserva}='Maestro', LOWER(TRIM({Nombre cliente}))=LOWER('${nombreSafe}'))
      )`.replace(/\s+/g, " ");

      const r = await list(TABLES.ReservasAlpadel, {
        filterByFormula: formula,
        sort: [{ field: "Fecha y hora inicio", direction: "asc" }],
      });

      const nombreLower = nombreMaestro.toLowerCase();
      const reservas = r.records
        .filter((rec) => {
          const tieneLink = Array.isArray(rec.fields.Maestro) && rec.fields.Maestro.includes(id);
          const nombreMatch = (rec.fields["Nombre cliente"] || "").trim().toLowerCase() === nombreLower;
          return tieneLink || nombreMatch;
        })
        .map(simplifyAlpadel);

      // PAGO AL MAESTRO (distinto al precio que se cobra al cliente):
      //   Singles                : ₡2,500/h
      //   Dobles AM  (<16:00 CR) : ₡4,000/h
      //   Dobles PM (≥16:00 CR)  : ₡8,000/h
      // Aplica IGUAL para todos los maestros. La tarifa del campo {Precio} de
      // Airtable es lo que se le cobra al cliente, NO lo que se le paga al
      // maestro — por eso aquí lo recalculamos.
      function tarifaMaestro(cancha, fechaHoraISO) {
        if (cancha === "Singles") return 2500;
        const d = new Date(fechaHoraISO);
        // CR es UTC-6, ningún DST.
        const horaCR = (d.getUTCHours() - 6 + 24) % 24;
        return horaCR >= 16 ? 8000 : 4000;
      }
      reservas.forEach((x) => {
        x.tarifaMaestroHora = tarifaMaestro(x.cancha, x.fechaHora);
        x.pagoMaestro = x.tarifaMaestroHora * (x.duracion || 0);
      });
      const totalHoras = reservas.reduce((s, x) => s + (x.duracion || 0), 0);
      // totalAFacturar = lo que el GRUPO debe pagar AL MAESTRO (usando tarifa maestro)
      const totalAFacturar = reservas.reduce((s, x) => s + (x.pagoMaestro || 0), 0);

      res.json({
        mes,
        maestroId: id,
        reservas,
        totalHoras,
        totalAFacturar,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ===========================
// GET /api/clientes/buscar?q=texto
// ===========================
router.get("/clientes/buscar", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json({ clientes: [] });

    const formula = `OR(
      SEARCH(LOWER('${q}'), LOWER({Nombre completo})),
      SEARCH('${q}', {Telefono}),
      SEARCH(LOWER('${q}'), LOWER({Email}))
    )`.replace(/\s+/g, " ");

    const r = await list(TABLES.Clientes, {
      filterByFormula: formula,
      maxRecords: 20,
    });

    res.json({
      clientes: r.records.map((c) => ({
        id: c.id,
        nombre: c.fields["Nombre completo"],
        telefono: c.fields.Telefono,
        email: c.fields.Email,
        cumpleanos: c.fields.Cumpleanos,
        totalReservas: c.fields["Total general"] || 0,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/cumpleanos/mes  — cumpleañeros del mes actual
// ===========================
router.get("/cumpleanos/mes", requireAuth(OPERATIVO), async (req, res) => {
  try {
    const mes = parseInt(req.query.mes || new Date().getMonth() + 1, 10);
    const r = await list(TABLES.Clientes, {
      filterByFormula: `MONTH({Cumpleanos}) = ${mes}`,
    });
    res.json({
      mes,
      clientes: r.records.map((c) => ({
        id: c.id,
        nombre: c.fields["Nombre completo"],
        telefono: c.fields.Telefono,
        cumpleanos: c.fields.Cumpleanos,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/tickets — tickets de mantenimiento pendientes
// ===========================
router.get("/tickets", requireAuth(OPERATIVO), async (req, res) => {
  try {
    if (!mantenimiento.isConfigured()) {
      return res.status(500).json({ error: "Mantenimiento no configurado" });
    }
    const [records, usuariosMap] = await Promise.all([
      mantenimiento.listTicketsActivos(),
      mantenimiento.getUsuariosMap(),
    ]);
    const tickets = records.map((rec) => {
      const f = rec.fields || {};
      const ejecArr = f["Ejecutor asignado"] || [];
      const reporArr = f["Reportado por"] || [];
      return {
        id: rec.id,
        descripcion: f["Descripción del problema"] || "",
        negocio: f["Negocio"] || "",
        area: f["Área"] || "",
        urgencia: f["Urgencia real"] || f["Urgencia reportada"] || "",
        estado: f["Estado"] || "Nuevo",
        ejecutor_id: ejecArr[0] || null,
        ejecutor_nombre: ejecArr[0] ? usuariosMap[ejecArr[0]] || "—" : null,
        reportado_por: reporArr[0] ? usuariosMap[reporArr[0]] || "—" : null,
        fecha_compromiso: f["Fecha compromiso"] || null,
        fotos: (f["Fotos del problema"] || []).map((p) => ({
          url: p.url,
          thumb: (p.thumbnails && p.thumbnails.large && p.thumbnails.large.url) || p.url,
        })),
      };
    });
    // Ordenar: sin asignar primero, después urgencia, después fecha compromiso
    const urgOrden = { Critica: 0, "Crítica": 0, Alta: 1, Media: 2, Baja: 3 };
    tickets.sort((a, b) => {
      const aAsign = a.ejecutor_id ? 1 : 0;
      const bAsign = b.ejecutor_id ? 1 : 0;
      if (aAsign !== bAsign) return aAsign - bAsign;
      const ua = urgOrden[a.urgencia] ?? 9;
      const ub = urgOrden[b.urgencia] ?? 9;
      if (ua !== ub) return ua - ub;
      const fa = a.fecha_compromiso || "9999-12-31";
      const fb = b.fecha_compromiso || "9999-12-31";
      return fa.localeCompare(fb);
    });
    const sinAsignar = tickets.filter((t) => !t.ejecutor_id).length;
    res.json({
      total: tickets.length,
      sin_asignar: sinAsignar,
      tickets,
    });
  } catch (e) {
    console.error("GET /tickets", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// POST /api/tickets — crear nuevo ticket (Lili reporta)
// Body: { descripcion, negocio, area, urgencia_reportada, fotos: [url] }
// ===========================
router.post("/tickets", requireAuth(OPERATIVO), async (req, res) => {
  try {
    if (!mantenimiento.isConfigured()) {
      return res.status(500).json({ error: "Mantenimiento no configurado" });
    }
    const { descripcion, negocio, area, urgencia_reportada, fotos } = req.body || {};
    if (!descripcion || typeof descripcion !== "string" || descripcion.trim().length < 3) {
      return res.status(400).json({ error: "Descripción requerida (mín 3 chars)" });
    }
    if (negocio && !mantenimiento.NEGOCIOS_VALIDOS.includes(negocio)) {
      return res.status(400).json({ error: "Negocio no válido", validos: mantenimiento.NEGOCIOS_VALIDOS });
    }
    if (area && !mantenimiento.AREAS_VALIDAS.includes(area)) {
      return res.status(400).json({ error: "Área no válida", validas: mantenimiento.AREAS_VALIDAS });
    }
    if (urgencia_reportada && !mantenimiento.URGENCIAS_VALIDAS.includes(urgencia_reportada)) {
      return res.status(400).json({ error: "Urgencia no válida", validas: mantenimiento.URGENCIAS_VALIDAS });
    }
    // El usuario que reporta = el rol que está autenticado
    const rol = req.user && req.user.rol;
    const reportadoPorId = USER_REC_BY_ROL[rol] || USER_REC_BY_ROL.lili;
    const created = await mantenimiento.createTicket({
      descripcion: descripcion.trim(),
      negocio,
      area,
      urgenciaReportada: urgencia_reportada,
      reportadoPorId,
      fotos: Array.isArray(fotos) ? fotos.filter(Boolean).slice(0, 5) : [],
    });
    res.json({
      ok: true,
      ticket_id: created.id,
      estado: "Nuevo",
      mensaje: "Ticket creado. Vicente lo revisará para asignar ejecutor.",
    });
  } catch (e) {
    console.error("POST /tickets", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// PATCH /api/tickets/:id — editar ticket (estado, descripción, negocio, área, urgencia)
// NO permite cambiar Ejecutor asignado.
// ===========================
router.patch("/tickets/:id", requireAuth(OPERATIVO), async (req, res) => {
  try {
    if (!mantenimiento.isConfigured()) {
      return res.status(500).json({ error: "Mantenimiento no configurado" });
    }
    const { id } = req.params;
    if (!id || !id.startsWith("rec")) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const { descripcion, negocio, area, urgencia_reportada, estado, notas, fecha_compromiso, materiales } = req.body || {};
    // Validaciones
    if (descripcion !== undefined && (typeof descripcion !== "string" || descripcion.trim().length < 3)) {
      return res.status(400).json({ error: "Descripción mín 3 chars" });
    }
    if (negocio && !mantenimiento.NEGOCIOS_VALIDOS.includes(negocio)) {
      return res.status(400).json({ error: "Negocio no válido", validos: mantenimiento.NEGOCIOS_VALIDOS });
    }
    if (area && !mantenimiento.AREAS_VALIDAS.includes(area)) {
      return res.status(400).json({ error: "Área no válida", validas: mantenimiento.AREAS_VALIDAS });
    }
    if (urgencia_reportada && !mantenimiento.URGENCIAS_VALIDAS.includes(urgencia_reportada)) {
      return res.status(400).json({ error: "Urgencia no válida" });
    }
    if (estado && !mantenimiento.ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ error: "Estado no válido", validos: mantenimiento.ESTADOS_VALIDOS });
    }
    if (fecha_compromiso !== undefined && fecha_compromiso !== "" && fecha_compromiso !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha_compromiso)) {
      return res.status(400).json({ error: "Fecha compromiso debe ser YYYY-MM-DD" });
    }
    const updated = await mantenimiento.updateTicket(id, {
      descripcion: descripcion !== undefined ? descripcion.trim() : undefined,
      negocio,
      area,
      urgenciaReportada: urgencia_reportada,
      estado,
      notas,
      fechaCompromiso: fecha_compromiso,
      materiales,
    });
    if (!updated) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }
    res.json({ ok: true, ticket_id: id, mensaje: "Ticket actualizado" });
  } catch (e) {
    console.error("PATCH /tickets/:id", e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// GET /api/tickets/opciones — devuelve dropdowns válidos
// ===========================
router.get("/tickets/opciones", requireAuth(OPERATIVO), async (req, res) => {
  res.json({
    negocios: mantenimiento.NEGOCIOS_VALIDOS,
    areas: mantenimiento.AREAS_VALIDAS,
    urgencias: mantenimiento.URGENCIAS_VALIDAS,
    estados: mantenimiento.ESTADOS_VALIDOS,
  });
});

module.exports = router;
module.exports.generarReservasParaRecurrente = generarReservasParaRecurrente;
module.exports.borrarReservasFuturasDeRecurrente = borrarReservasFuturasDeRecurrente;
