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
app.use(express.json({ limit: "1mb" }));

// ===== Auth =====
app.post("/api/auth/login", (req, res) => {
  const { pin } = req.body || {};
  if (!pin || !/^\d{4}$/.test(pin))
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
