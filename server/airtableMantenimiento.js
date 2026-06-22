/**
 * Cliente Airtable para la base de Mantenimiento (Grupo Cotorreo).
 * Base distinta a la de Reservas — vive en appbyPA6LKCt9ORJg.
 *
 * Usa el mismo PAT principal (AIRTABLE_PAT) — el PAT del servidor tiene
 * acceso a todas las bases del workspace.
 */

const BASE = "appbyPA6LKCt9ORJg";
const PAT = process.env.AIRTABLE_PAT;

const TABLES_M = {
  Tickets: "tblhJuT7yz27Zl3O7",
  Usuarios: "tblPF6BROB8OrgfCx",
  Negocios: "tblegx33wFdVqY4fL",
};

const NEGOCIOS_VALIDOS = [
  "Nube",
  "Cotorreo Taquería",
  "Cotorreo Plaza",
  "Alpadel",
  "Depto Amarillo ",
  "Depto Morado ",
  "Depto Naranja ",
  "Casa",
  "Bebros",
];

const AREAS_VALIDAS = [
  "Cocina ",
  "Baños ",
  "Eléctrico ",
  "Plomería",
  "Climatización ",
  "Estructura Exterior ",
  "Equipamiento ",
  "Maquinas de jjuego",
];

const URGENCIAS_VALIDAS = ["Baja", "Media", "Alta", "Critica"];

const ESTADOS_ACTIVOS = [
  "Nuevo",
  "En revisión",
  "Pendiente presupuesto",
  "Asignado",
  "En proceso",
  "Vencido",
];

const URL = (path) => `https://api.airtable.com/v0/${BASE}/${path}`;

async function callM(method, path, body) {
  if (!PAT) throw new Error("AIRTABLE_PAT no configurado");
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(URL(path), opts);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Airtable Mantenimiento ${method} ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

// Devuelve tickets activos paginando
async function listTicketsActivos() {
  const formula = ESTADOS_ACTIVOS.map((e) => `{Estado}="${e}"`).join(",");
  const filter = `OR(${formula})`;
  const out = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("filterByFormula", filter);
    if (offset) params.set("offset", offset);
    const data = await callM("GET", `${encodeURIComponent("Tickets")}?${params.toString()}`);
    for (const rec of data.records || []) out.push(rec);
    offset = data.offset;
  } while (offset && out.length < 500);
  return out;
}

// Lookup nombres de ejecutores asignados (resuelve linked record IDs → nombres)
async function getUsuariosMap() {
  const data = await callM("GET", `${encodeURIComponent("Usuarios")}?pageSize=100`);
  const map = {};
  for (const rec of data.records || []) {
    map[rec.id] = rec.fields.Nombre || "(sin nombre)";
  }
  return map;
}

// Crea ticket con Estado="Nuevo". Reportado_por_id es el record id del usuario en tabla Usuarios.
async function createTicket({ descripcion, negocio, area, urgenciaReportada, reportadoPorId, fotos }) {
  const fields = {
    "Descripción del problema": descripcion,
    Estado: "Nuevo",
  };
  if (negocio) fields["Negocio"] = negocio;
  if (area) fields["Área"] = area;
  if (urgenciaReportada) fields["Urgencia reportada"] = urgenciaReportada;
  if (reportadoPorId) fields["Reportado por"] = [reportadoPorId];
  if (fotos && fotos.length) {
    fields["Fotos del problema"] = fotos.map((url) => ({ url }));
  }
  const data = await callM("POST", encodeURIComponent("Tickets"), {
    records: [{ fields }],
  });
  return data.records[0];
}

function isConfigured() {
  return !!PAT;
}

module.exports = {
  BASE,
  TABLES_M,
  NEGOCIOS_VALIDOS,
  AREAS_VALIDAS,
  URGENCIAS_VALIDAS,
  ESTADOS_ACTIVOS,
  callM,
  listTicketsActivos,
  getUsuariosMap,
  createTicket,
  isConfigured,
};
