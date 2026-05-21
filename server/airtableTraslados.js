/**
 * Cliente Airtable para la base de Traslados Grupo Cotorreo.
 * Base distinta a la de Reservas — vive en appA4Exsvfov2JTS6.
 *
 * Por defecto usa el mismo PAT que el cliente principal (AIRTABLE_PAT).
 * Si el PAT principal NO tiene acceso a esta base, Vicente puede definir
 * AIRTABLE_PAT_TRASLADOS como override.
 */

const BASE = process.env.AIRTABLE_BASE_TRASLADOS;
const PAT = process.env.AIRTABLE_PAT_TRASLADOS || process.env.AIRTABLE_PAT;

if (!BASE) {
  console.warn("⚠️ AIRTABLE_BASE_TRASLADOS no configurado — endpoints /api/tickets/* no funcionarán");
}
if (!PAT) {
  console.warn("⚠️ AIRTABLE_PAT (o AIRTABLE_PAT_TRASLADOS) no configurado");
}

// Tablas en la base de Traslados (los nombres son los reales de la app actual)
const TABLES_T = {
  Traslados: "Traslados",
  Catalogo: "Catalogo",
  Pedidos: "Pedidos",
};

// Negocios operativos válidos como destino (espejo del frontend de traslados)
const NEGOCIOS_OPERATIVOS = [
  "Cotorreo Plaza",
  "Cotorreo Taquería",
  "Nube",
  "Bebros",
  "Alpadel",
  "Departamentos",
  "Panadería",
];
const DESTINOS_CONSUMO_PERSONAL = ["Casa"];
const TODOS_DESTINOS = [...NEGOCIOS_OPERATIVOS, ...DESTINOS_CONSUMO_PERSONAL];

const URL_T = (path) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(path)}`;

async function callT(method, path, body) {
  if (!BASE || !PAT) {
    throw new Error("Airtable Traslados no configurado");
  }
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(URL_T(path), opts);
  const text = await r.text();
  if (!r.ok) {
    console.error(`Airtable Traslados ${method} ${path} failed:`, r.status, text);
    throw new Error(`Airtable Traslados ${r.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function createTraslado(fields, options = {}) {
  const body = { records: [{ fields }] };
  if (options.typecast) body.typecast = true;
  const r = await callT("POST", TABLES_T.Traslados, body);
  return r.records[0];
}

async function updateTraslado(recordId, fields, options = {}) {
  const body = { fields };
  const path = options.typecast
    ? `${TABLES_T.Traslados}/${recordId}?typecast=true`
    : `${TABLES_T.Traslados}/${recordId}`;
  return callT("PATCH", path, body);
}

/**
 * Busca traslados existentes que coincidan con destino + rango de fechas.
 * Usado para detectar posibles duplicados antes de crear desde un ticket.
 */
async function listTrasladosPorDestinoYFecha(destino, fechaIni, fechaFin) {
  if (!destino || !fechaIni || !fechaFin) return [];
  // filterByFormula: AND({Destino} = "X", {Fecha} >= ini, {Fecha} <= fin)
  const formula = `AND({Destino} = "${destino}", IS_AFTER({Fecha}, "${fechaIni}"), IS_BEFORE({Fecha}, "${fechaFin}"))`;
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "20",
  }).toString();
  const r = await callT("GET", `${TABLES_T.Traslados}?${qs}`);
  return r.records || [];
}

module.exports = {
  TABLES_T,
  NEGOCIOS_OPERATIVOS,
  DESTINOS_CONSUMO_PERSONAL,
  TODOS_DESTINOS,
  callT,
  createTraslado,
  updateTraslado,
  listTrasladosPorDestinoYFecha,
  isConfigured() { return !!(BASE && PAT); },
};
