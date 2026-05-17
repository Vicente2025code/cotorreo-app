/**
 * Cliente Airtable centralizado. PAT vive solo aquí (lado servidor).
 */

const BASE = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_PAT;

if (!BASE || !PAT) {
  console.error("❌ Faltan AIRTABLE_BASE_ID o AIRTABLE_PAT en .env");
  process.exit(1);
}

// IDs de tablas (fijos en la base "Grupo Cotorreo Reservas")
const TABLES = {
  Clientes: "tblBoPYVIvUjawN2g",
  ReservasAlpadel: "tblXWSFfWsNgNq8MI",
  ReservasCotorreo: "tblnqBGCmnQ3sdsdt",
  Maestros: "tbluEoXLg5fDFwr3B",
  Paquetes: "tblmMqUC0BKHYvqrt",
  RecurrentesAlpadel: "tblTWrL2pNf9a72ll",
};

const URL = (path) => `https://api.airtable.com/v0/${BASE}/${path}`;

async function call(method, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(URL(path), opts);
  const text = await r.text();
  if (!r.ok) {
    console.error(`Airtable ${method} ${path} failed:`, r.status, text);
    throw new Error(`Airtable ${r.status}: ${text}`);
  }
  return JSON.parse(text);
}

// ===== Lectura =====

/**
 * List records con filterByFormula opcional.
 * @param {string} tableId
 * @param {object} opts { filterByFormula, sort, maxRecords, view }
 */
async function list(tableId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
  if (opts.maxRecords) params.set("maxRecords", opts.maxRecords);
  if (opts.view) params.set("view", opts.view);
  if (opts.sort) {
    opts.sort.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction || "asc");
    });
  }
  const qs = params.toString();
  return call("GET", `${tableId}${qs ? "?" + qs : ""}`);
}

async function get(tableId, recordId) {
  return call("GET", `${tableId}/${recordId}`);
}

// ===== Escritura =====

async function create(tableId, fields, options = {}) {
  const body = { records: [{ fields }] };
  if (options.typecast) body.typecast = true;
  const r = await call("POST", tableId, body);
  return r.records[0];
}

async function update(tableId, recordId, fields, options = {}) {
  const body = { fields };
  const path = options.typecast
    ? `${tableId}/${recordId}?typecast=true`
    : `${tableId}/${recordId}`;
  return call("PATCH", path, body);
}

// ===== Helpers de negocio =====

/**
 * Busca o crea un cliente por teléfono. Devuelve el record completo.
 */
/**
 * Construye fecha de cumpleaños sin año.
 * Acepta: { cumpleanosDia, cumpleanosMes } o cumpleanos directo (YYYY-MM-DD).
 * Guarda siempre como 2000-MM-DD (año fijo, el workflow de cumple ignora año).
 */
function buildCumpleanos({ cumpleanos, cumpleanosDia, cumpleanosMes }) {
  if (cumpleanos && /^\d{4}-\d{2}-\d{2}$/.test(cumpleanos)) return cumpleanos;
  if (cumpleanosDia && cumpleanosMes) {
    const d = String(cumpleanosDia).padStart(2, "0");
    const m = String(cumpleanosMes).padStart(2, "0");
    return `2000-${m}-${d}`;
  }
  return null;
}

/**
 * Busca un cliente por teléfono normalizado. Devuelve record o null.
 */
async function findClienteByTelefono(telefono) {
  const phoneClean = (telefono || "").replace(/[^0-9]/g, "");
  if (!phoneClean) return null;
  const found = await list(TABLES.Clientes, {
    filterByFormula: `SUBSTITUTE({Telefono}, " ", "") = "${phoneClean}"`,
    maxRecords: 1,
  });
  return found.records && found.records.length > 0 ? found.records[0] : null;
}

async function upsertCliente({ nombre, telefono, email, cumpleanos, cumpleanosDia, cumpleanosMes, negocio }) {
  const phoneClean = (telefono || "").replace(/[^0-9]/g, "");
  if (!phoneClean) throw new Error("Teléfono requerido");

  const existing = await findClienteByTelefono(phoneClean);
  if (existing) return existing;

  const cumpleFecha = buildCumpleanos({ cumpleanos, cumpleanosDia, cumpleanosMes });

  const created = await create(
    TABLES.Clientes,
    {
      "Nombre completo": nombre,
      Telefono: phoneClean,
      Email: email || undefined,
      Cumpleanos: cumpleFecha || undefined,
      "Negocios que visita": negocio ? [negocio] : undefined,
    },
    { typecast: true }
  );
  return created;
}

module.exports = {
  TABLES,
  call,
  list,
  get,
  create,
  update,
  upsertCliente,
  findClienteByTelefono,
  buildCumpleanos,
};
