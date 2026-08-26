/**
 * Horario operativo de las canchas, en un solo lugar.
 *
 * Antes esto no existia: cada ruta validaba que la hora no hubiera pasado y que
 * la cancha estuviera libre, pero ninguna miraba la hora de cierre. Resultado:
 * la app acepto reservas de 21:30 a 22:30 (Juan Bao 31-jul, Jean Carlo 25-ago),
 * media hora despues de cerrar.
 *
 * Si algun dia cambia el horario, se cambia ACA y aplica a todas las vias de
 * reserva: cliente, panel de Lili, panel de maestros y series recurrentes.
 */

const APERTURA_H = 7;   // 07:00
const CIERRE_H = 22;    // 22:00

// "HH:MM" -> minutos desde medianoche. Devuelve null si no parsea.
function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtHora(min) {
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

/**
 * Valida un rango horario contra el horario operativo.
 * Recibe strings "HH:MM" en hora Costa Rica.
 * Devuelve un mensaje de error, o null si esta bien.
 */
function validarRangoHorario(horaInicio, horaFin) {
  const ini = aMinutos(horaInicio);
  const fin = aMinutos(horaFin);
  if (ini == null || fin == null) return "Hora invalida. Usa el formato HH:MM.";
  if (fin <= ini) return "La hora de fin debe ser posterior a la de inicio.";
  if (ini < APERTURA_H * 60) {
    return `Las canchas abren a las ${fmtHora(APERTURA_H * 60)}. No se puede reservar desde las ${fmtHora(ini)}.`;
  }
  if (fin > CIERRE_H * 60) {
    return `Las canchas cierran a las ${fmtHora(CIERRE_H * 60)} y esa reserva terminaria a las ${fmtHora(fin)}. Elegi una hora mas temprana o una duracion menor.`;
  }
  return null;
}

/**
 * Igual que validarRangoHorario pero a partir de dos Date.
 * Las fechas vienen en UTC; el horario se juzga en hora Costa Rica (UTC-6).
 */
function validarFechasCR(startCR, endCR) {
  // Una fecha invalida (mes 13, hora basura, duracion NaN) produce un Date
  // invalido, y toISOString() sobre eso LANZA RangeError. Sin esta guarda, un
  // dato malformado devolvia 500 en vez de un mensaje entendible.
  const invalida = (d) => !(d instanceof Date) || Number.isNaN(d.getTime());
  if (invalida(startCR) || invalida(endCR)) {
    return "Fecha u hora invalida. Revisa los datos de la reserva.";
  }
  const aHHMM = (d) => {
    const cr = new Date(d.getTime() - 6 * 3600 * 1000);
    return String(cr.getUTCHours()).padStart(2, "0") + ":" + String(cr.getUTCMinutes()).padStart(2, "0");
  };
  // Una reserva que cruza la medianoche no es un horario tardio: es un error.
  const cruzaDia =
    new Date(startCR.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10) !==
    new Date(endCR.getTime() - 6 * 3600 * 1000 - 1).toISOString().slice(0, 10);
  if (cruzaDia) return "La reserva no puede pasar de la medianoche.";
  return validarRangoHorario(aHHMM(startCR), aHHMM(endCR));
}

module.exports = { APERTURA_H, CIERRE_H, validarRangoHorario, validarFechasCR };
