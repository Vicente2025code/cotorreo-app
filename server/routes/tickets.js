/**
 * Endpoints para procesamiento de tickets de compra.
 *
 * Flujo:
 *   1. Frontend toma foto del ticket
 *   2. POST /api/tickets/parse con la imagen en base64 → GPT-4o mini extrae datos
 *   3. Usuario revisa/edita en el frontend, asigna items a destinos
 *   4. POST /api/tickets/save con items + asignaciones → crea registros en Airtable Traslados
 *      con la imagen como attachment
 */

const express = require("express");
const router = express.Router();
const {
  TABLES_T,
  TODOS_DESTINOS,
  NEGOCIOS_OPERATIVOS,
  callT,
  createTraslado,
  listTrasladosPorDestinoYFecha,
  isConfigured,
} = require("../airtableTraslados");

// ============================================================
// AUTENTICACIÓN SIMPLE
// El frontend de traslados pasa el header `X-Tickets-Key: <secreto>`.
// Si TICKETS_API_KEY está configurado, validamos. Si no, dejamos pasar
// (modo dev) pero logueamos warning.
// ============================================================
function requireTicketsAuth(req, res, next) {
  const expected = process.env.TICKETS_API_KEY;
  if (!expected) {
    console.warn("⚠️ TICKETS_API_KEY no configurado — endpoint sin protección");
    return next();
  }
  const got = req.header("X-Tickets-Key");
  if (got !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ============================================================
// POST /api/tickets/parse
// Recibe { imageBase64: "data:image/jpeg;base64,/9j/..." }
// Llama a GPT-4o mini para extraer datos del ticket.
// Devuelve { comercio, fecha, total, moneda, items: [...] }
// ============================================================
router.post("/tickets/parse", requireTicketsAuth, async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 requerido" });
    }

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY no configurado en el servidor" });
    }

    // Si viene sin prefijo "data:image/...", asumir jpeg
    let dataUrl = imageBase64;
    if (!dataUrl.startsWith("data:")) {
      dataUrl = `data:image/jpeg;base64,${dataUrl}`;
    }

    const prompt = `Eres un asistente que extrae datos de tickets de compra y facturas costarricenses.

Analiza la imagen del ticket y devuelve SOLO un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:

{
  "comercio": "nombre de la tienda/supermercado",
  "fecha": "YYYY-MM-DD",
  "total": 12345.67,
  "moneda": "CRC",
  "items": [
    {
      "producto": "descripción del item",
      "cantidad": 2,
      "unidad": "kg|unidad|lt|paquete|etc",
      "precio_unit": 1500.00,
      "subtotal": 3000.00
    }
  ],
  "notas": "cualquier observación útil"
}

Reglas:
- Si no podés leer el comercio, devolvé "Desconocido"
- Si no hay fecha visible, devolvé la fecha actual en formato ISO
- Los montos son en colones (CRC) por defecto a menos que veas $ o USD
- Si un item tiene cantidad implícita 1, ponela explícitamente
- Si el ticket está borroso o no es un ticket, devolvé items: [] y notas: "No se pudo leer"
- NO inventes items que no veas en la imagen`;

    const openaiBody = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    };

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(openaiBody),
    });

    const openaiJson = await openaiResp.json();
    if (!openaiResp.ok) {
      console.error("OpenAI error:", openaiJson);
      return res.status(502).json({
        error: "Error procesando imagen con IA",
        detail: openaiJson?.error?.message || "unknown",
      });
    }

    const content = openaiJson.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: "Respuesta vacía de IA" });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("OpenAI returned invalid JSON:", content);
      return res.status(502).json({ error: "IA devolvió JSON inválido", raw: content.slice(0, 500) });
    }

    // Normalización defensiva
    parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
    parsed.comercio = parsed.comercio || "Desconocido";
    parsed.moneda = parsed.moneda || "CRC";
    parsed.total = Number(parsed.total) || 0;
    parsed.fecha = parsed.fecha || new Date().toISOString().slice(0, 10);

    // Loguear costo aproximado para tracking
    const usage = openaiJson.usage || {};
    console.log(`📷 Ticket parseado | items: ${parsed.items.length} | tokens in: ${usage.prompt_tokens} out: ${usage.completion_tokens}`);

    res.json({
      ok: true,
      data: parsed,
      meta: {
        model: "gpt-4o-mini",
        tokens: usage,
      },
    });
  } catch (e) {
    console.error("POST /tickets/parse error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// POST /api/tickets/save
// Recibe:
//   {
//     comercio: string,
//     fecha: string,
//     imageBase64?: string (opcional, para attachment),
//     items: [{
//       producto, cantidad, unidad, precio_unit, subtotal,
//       destino: string,  // <-- requerido: a qué negocio va
//       notas?: string
//     }]
//   }
// Crea N registros en tabla Traslados (uno por item).
// Si imageBase64 está presente, lo adjunta al primer registro como ticket.
// ============================================================
router.post("/tickets/save", requireTicketsAuth, async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(500).json({ error: "Airtable Traslados no configurado en el servidor" });
    }

    const {
      comercio,
      fecha,
      items,
      imageBase64,
      notas: notasGlobal,
      // flag para saltarse la verificación de duplicados
      // (se setea desde el frontend cuando el usuario confirma "continuar igual")
      confirmDuplicates,
    } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items requerido (array no vacío)" });
    }

    // Validar destinos
    const destinosInvalidos = items
      .map(it => it.destino)
      .filter(d => d && !TODOS_DESTINOS.includes(d));
    if (destinosInvalidos.length) {
      return res.status(400).json({
        error: `Destinos inválidos: ${[...new Set(destinosInvalidos)].join(", ")}`,
        destinosValidos: TODOS_DESTINOS,
      });
    }

    // Generar un folio base único para este ticket
    const folioBase = `TICK-${Date.now().toString().slice(-8)}`;
    const fechaSave = fecha || new Date().toISOString().slice(0, 10);

    // Schema real de tabla Traslados:
    //   - UN registro por destino (no uno por item)
    //   - Todos los items del destino se empaquetan en Productos_json (JSON string)
    //   - Valor_total = suma de subtotales del grupo
    //   - Estado = "pendiente" (minúscula)
    //
    // Si el ticket tiene items para MÚLTIPLES destinos, creamos varios registros
    // (uno por destino), todos con el mismo folio base pero con sufijo del destino.

    // Agrupar items por destino
    const itemsByDestino = {};
    for (const it of items) {
      const d = it.destino || "Sin asignar";
      if (!itemsByDestino[d]) itemsByDestino[d] = [];
      itemsByDestino[d].push(it);
    }
    const destinosCount = Object.keys(itemsByDestino).length;

    // ═══════════════════════════════════════════════════
    // DETECCIÓN DE POSIBLES DUPLICADOS
    // Antes de crear, revisar si ya hay traslados parecidos:
    //   - Mismo destino
    //   - Fecha ±2 días
    //   - Monto total ±10%
    // Si encuentra y NO viene confirmDuplicates=true, devolver 409.
    // ═══════════════════════════════════════════════════
    if (!confirmDuplicates) {
      const baseFecha = new Date(fechaSave);
      const dayMs = 24 * 60 * 60 * 1000;
      // Rango: 2 días antes y 2 días después
      const fechaIni = new Date(baseFecha.getTime() - 2 * dayMs).toISOString().slice(0, 10);
      const fechaFin = new Date(baseFecha.getTime() + 2 * dayMs).toISOString().slice(0, 10);

      const matchesByDestino = [];

      for (const [destino, itemsList] of Object.entries(itemsByDestino)) {
        const valorTotalNuevo = itemsList.reduce(
          (acc, it) => acc + (Number(it.precio_unit) || 0) * (Number(it.cantidad) || 0),
          0
        );
        if (valorTotalNuevo === 0) continue;

        let candidatos;
        try {
          candidatos = await listTrasladosPorDestinoYFecha(destino, fechaIni, fechaFin);
        } catch (e) {
          console.warn(`No se pudo buscar duplicados para ${destino}:`, e.message);
          candidatos = [];
        }

        // Filtrar por monto similar (±10%)
        const tolerance = 0.10;
        const minVal = valorTotalNuevo * (1 - tolerance);
        const maxVal = valorTotalNuevo * (1 + tolerance);
        const matches = candidatos.filter(c => {
          const v = Number(c.fields?.Valor_total) || 0;
          return v >= minVal && v <= maxVal;
        });

        if (matches.length > 0) {
          matchesByDestino.push({
            destino,
            valor_total_nuevo: Math.round(valorTotalNuevo * 100) / 100,
            candidates: matches.map(c => ({
              id: c.id,
              folio: c.fields?.Folio || "(sin folio)",
              fecha: c.fields?.Fecha || "?",
              valor_total: c.fields?.Valor_total || 0,
              quien_envia: c.fields?.Quien_envia || "?",
              estado: c.fields?.Estado || "?",
            })),
          });
        }
      }

      if (matchesByDestino.length > 0) {
        return res.status(409).json({
          ok: false,
          code: "POSSIBLE_DUPLICATES",
          message: "Hay traslados existentes que podrían ser el mismo ticket",
          duplicates: matchesByDestino,
        });
      }
    }

    const creados = [];
    let folioIndex = 0;
    for (const [destino, itemsList] of Object.entries(itemsByDestino)) {
      folioIndex++;
      // Construir el array Productos_json en el formato que usa la app actual
      // Schema: [{ id, name, unit, qty, price }]
      const productosJson = itemsList.map((it, idx) => ({
        id: `tk_${folioBase}_${folioIndex}_${idx}`,
        name: it.producto || "(sin nombre)",
        unit: it.unidad || "unidad",
        qty: Number(it.cantidad) || 1,
        price: Number(it.precio_unit) || 0,
      }));
      const valorTotal = itemsList.reduce(
        (acc, it) => acc + (Number(it.precio_unit) || 0) * (Number(it.cantidad) || 0),
        0
      );

      // Si hay varios destinos, agregar sufijo al folio para diferenciarlos
      const folioFinal = destinosCount > 1
        ? `${folioBase}-${folioIndex}`
        : folioBase;

      // Los tickets representan compras YA realizadas — el ticket ES la prueba
      // de la transacción. Por eso se crean directamente como "confirmado"
      // (NO "pendiente" como los traslados manuales que esperan recepción humana).
      const nowISO = new Date().toISOString();
      const fields = {
        Folio: folioFinal,
        Quien_envia: comercio || "Compra externa",
        Destino: destino,
        Estado: "confirmado",
        Confirmado_por: `Ticket digital${comercio ? " (" + comercio.slice(0, 40) + ")" : ""}`,
        Fecha_confirmacion: nowISO,
        Fecha: fechaSave,
        Productos_json: JSON.stringify(productosJson),
        Valor_total: valorTotal,
      };

      try {
        const rec = await createTraslado(fields, { typecast: true });
        creados.push({
          id: rec.id,
          folio: folioFinal,
          destino,
          items_count: itemsList.length,
          valor_total: valorTotal,
        });
      } catch (errItem) {
        console.error(`Error creando traslado para destino ${destino}:`, errItem.message);
        creados.push({ error: errItem.message, destino });
      }
    }

    const total_ok = creados.filter(c => !c.error).length;
    const total_errores = creados.length - total_ok;

    res.json({
      ok: total_ok > 0,
      folio: folioBase,
      creados,
      total_items: items.length,
      total_registros: creados.length,
      total_ok,
      total_errores,
      // Si TODO falló, devolver el primer error para que el frontend lo muestre
      error: total_ok === 0 && creados[0] && creados[0].error
        ? creados[0].error
        : undefined,
    });
  } catch (e) {
    console.error("POST /tickets/save error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// GET /api/tickets/destinos
// Devuelve los destinos válidos para el dropdown del frontend
// ============================================================
router.get("/tickets/destinos", (_req, res) => {
  res.json({
    operativos: NEGOCIOS_OPERATIVOS,
    todos: TODOS_DESTINOS,
  });
});

module.exports = router;
