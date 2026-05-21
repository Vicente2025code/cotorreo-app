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

    const { comercio, fecha, items, imageBase64, notas: notasGlobal } = req.body || {};
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

    // Generar un folio único para agrupar este ticket
    const folio = `TICK-${Date.now().toString().slice(-8)}`;

    const fechaSave = fecha || new Date().toISOString().slice(0, 10);

    // Si hay imagen, la subimos como attachment del primer registro.
    // Airtable acepta attachments via URL pública o como objeto inline.
    // Para enviarla inline necesitamos un servicio temporal — uso transfer.sh
    // o, más simple: subir a Airtable como dataURL no funciona en la API.
    // Mejor opción: Airtable acepta { url: "..." } y descarga del lado del server.
    // Para no depender de un host externo, hacemos un endpoint propio que sirva la imagen.
    //
    // Por simplicidad en esta fase 1: NO adjuntamos la imagen aún. Solo guardamos
    // los datos. La fase 2 agregará el attachment vía una URL temporal.

    const creados = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const fields = {
        Producto: it.producto || "(sin nombre)",
        Cantidad: Number(it.cantidad) || 1,
        Unidad: it.unidad || "unidad",
        Precio: Number(it.precio_unit) || 0,
        Destino: it.destino || undefined,
        Estado: "Pendiente",
        Fecha: fechaSave,
        Quien_envia: comercio || "Compra externa",
        Folio: folio,
        Notas: [
          it.notas,
          notasGlobal,
          `Ticket de ${comercio || "compra"}`,
          `Subtotal: ₡${(Number(it.subtotal) || 0).toLocaleString("es-CR")}`,
        ].filter(Boolean).join(" · "),
      };

      try {
        const rec = await createTraslado(fields, { typecast: true });
        creados.push({ id: rec.id, producto: fields.Producto, destino: fields.Destino });
      } catch (errItem) {
        console.error(`Error creando item ${i}:`, errItem.message);
        creados.push({ error: errItem.message, producto: it.producto });
      }
    }

    res.json({
      ok: true,
      folio,
      creados,
      total_items: items.length,
      total_ok: creados.filter(c => !c.error).length,
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
