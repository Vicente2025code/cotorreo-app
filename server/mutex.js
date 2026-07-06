/**
 * Mutex en memoria por clave. Previene race conditions en flujos check-then-write.
 *
 * Contexto: Airtable no tiene locks ni UNIQUE constraints. Si N requests con
 * la misma clave llegan concurrentemente, todos leen el estado ANTES de que
 * ninguno haya escrito, y todos pasan las validaciones → duplicados.
 *
 * Este helper serializa: el primer request ejecuta `fn`, los demás con la
 * misma clave esperan su Promise y reciben el MISMO resultado sin volver
 * a ejecutar fn. Como Render corre un solo proceso Node, un Map global es
 * suficiente para todo el servicio.
 *
 * La entrada se mantiene 5s post-resolución para atrapar retries tardíos.
 */
const _mutex = new Map();

async function withMutex(clave, fn) {
  if (_mutex.has(clave)) {
    return await _mutex.get(clave);
  }
  const p = (async () => {
    try {
      return await fn();
    } finally {
      setTimeout(() => _mutex.delete(clave), 5000);
    }
  })();
  _mutex.set(clave, p);
  return await p;
}

module.exports = { withMutex };
