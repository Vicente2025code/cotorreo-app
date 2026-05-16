/**
 * Auth por PIN → JWT.
 * Rate limit: 5 intentos fallidos por IP → bloqueo 5 min.
 */

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = "24h";

// Lee PINs desde variables de entorno
function loadPins() {
  const pins = {};
  for (let i = 1; i <= 99; i++) {
    const key = `PIN_${String(i).padStart(4, "0")}`;
    if (process.env[key]) {
      const [nombre, rol, recordId] = process.env[key].split("|");
      pins[String(i).padStart(4, "0")] = {
        pin: String(i).padStart(4, "0"),
        nombre,
        rol,
        recordId: recordId || null,
      };
    }
  }
  return pins;
}

const PINS = loadPins();
console.log(`🔑 ${Object.keys(PINS).length} PINs cargados`);

// === Rate limit en memoria (suficiente para esta escala) ===
const attempts = new Map(); // ip → { count, blockedUntil }
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 5 * 60 * 1000; // 5 min

function checkRateLimit(ip) {
  const entry = attempts.get(ip);
  if (!entry) return { ok: true };
  if (entry.blockedUntil && Date.now() < entry.blockedUntil) {
    return {
      ok: false,
      retryIn: Math.ceil((entry.blockedUntil - Date.now()) / 1000),
    };
  }
  if (entry.blockedUntil && Date.now() >= entry.blockedUntil) {
    attempts.delete(ip);
  }
  return { ok: true };
}

function recordFailure(ip) {
  const entry = attempts.get(ip) || { count: 0, blockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = Date.now() + BLOCK_MS;
  }
  attempts.set(ip, entry);
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

// === Login ===
function login(pin, ip) {
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return {
      ok: false,
      error: `Demasiados intentos. Espera ${rl.retryIn}s.`,
    };
  }

  const user = PINS[pin];
  if (!user) {
    recordFailure(ip);
    return { ok: false, error: "PIN incorrecto" };
  }

  clearAttempts(ip);
  const token = jwt.sign(
    { nombre: user.nombre, rol: user.rol, recordId: user.recordId },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

  console.log(
    `[AUTH] ${user.nombre} (${user.rol}) login OK desde ${ip} @ ${new Date().toISOString()}`
  );

  return {
    ok: true,
    token,
    user: { nombre: user.nombre, rol: user.rol },
  };
}

// === Middleware de auth ===
function requireAuth(allowedRoles = null) {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Sin token" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (allowedRoles && !allowedRoles.includes(decoded.rol)) {
        return res
          .status(403)
          .json({ error: "Sin permiso para esta acción" });
      }
      req.user = decoded;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }
  };
}

module.exports = { login, requireAuth, PINS };
