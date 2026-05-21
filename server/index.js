/**
 * cotorreo-app — servidor principal
 * - Sirve frontend estático desde /public
 * - Expone API REST en /api/*
 * - Auth por PIN → JWT
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const { login } = require("./auth");

const app = express();
app.set("trust proxy", true); // para que req.ip funcione bien detrás de Render
app.use(cors());
// IMPORTANTE: el body parser de tickets debe ir ANTES del global
// porque Express ejecuta los middlewares en orden, y si el global de 1mb
// se ejecuta primero, rechaza imágenes con 413 antes de llegar al router de tickets.
app.use("/api/tickets", express.json({ limit: "30mb" }));
// Body parser global para el resto (reservas, login, etc.) — 1mb es suficiente
app.use(express.json({ limit: "1mb" }));

// ===== Auth =====
app.post("/api/auth/login", (req, res) => {
  const { pin } = req.body || {};
  if (!pin || !/^\d{4,8}$/.test(pin))
    return res.status(400).json({ error: "PIN inválido" });
  const ip = req.ip;
  const result = login(pin, ip);
  if (!result.ok) return res.status(401).json(result);
  res.json(result);
});

// ===== Rutas API =====
app.use("/api", require("./routes/public"));
app.use("/api", require("./routes/lili"));
app.use("/api", require("./routes/maestro"));
app.use("/api", require("./routes/gerencia"));

// El body parser de /api/tickets ya está configurado arriba con 30mb.
// Acá solo montamos el router de las rutas.
app.use("/api", require("./routes/tickets"));

// ===== Health =====
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "cotorreo-app",
    timestamp: new Date().toISOString(),
  });
});

// ===== Frontend estático =====
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));

// SPA fallback: cualquier ruta no-API devuelve index.html
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// 404 para API no encontradas
app.use((req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 cotorreo-app escuchando en :${PORT}`);
});
