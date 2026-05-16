/**
 * common.js — helpers compartidos por todas las vistas
 */

const TOKEN_KEY = "cotorreo_token";
const USER_KEY = "cotorreo_user";

// ===== Auth helpers =====
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function getUser() {
  const u = localStorage.getItem(USER_KEY);
  return u ? JSON.parse(u) : null;
}
function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = "/";
}

// ===== Fetch wrapper con auth =====
async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(path, opts);
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) {
      logout();
      throw new Error("Sesión expirada");
    }
    throw new Error(json.error || `HTTP ${r.status}`);
  }
  return json;
}

// ===== Formato fechas/horas (Costa Rica) =====
function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Costa_Rica",
  });
}

function fmtFechaCorta(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "America/Costa_Rica",
  });
}

function fmtHora(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Costa_Rica",
  });
}

function fmtMonto(n) {
  return "₡" + (n || 0).toLocaleString("es-MX");
}

function todayISO() {
  const cr = new Date(Date.now() - 6 * 3600 * 1000);
  return cr.toISOString().slice(0, 10);
}

// ===== UI helpers =====
function showAlert(msg, type = "info", container = document.body) {
  const div = document.createElement("div");
  div.className = `alert ${type}`;
  div.textContent = msg;
  container.insertBefore(div, container.firstChild);
  setTimeout(() => div.remove(), 4000);
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") e.className = v;
    else if (k === "onClick") e.addEventListener("click", v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

// ===== Protección de rutas =====
function requireRole(roles) {
  const user = getUser();
  const token = getToken();
  if (!token || !user) {
    window.location.href = "/login.html";
    return false;
  }
  if (roles && !roles.includes(user.rol)) {
    showAlert("No tienes permiso para esta vista", "error");
    setTimeout(() => (window.location.href = "/login.html"), 1500);
    return false;
  }
  return true;
}
