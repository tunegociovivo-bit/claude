/**
 * Rango UTC de un DÍA LOCAL exacto (para el filtro por fecha del inbox de leads).
 *
 * El selector de calendario da una fecha "YYYY-MM-DD" en el huso del navegador.
 * Para filtrar sin errores de zona horaria, convertimos ese día LOCAL a dos
 * instantes absolutos [from, to): medianoche local del día y medianoche local
 * del día siguiente. El servidor compara `receivedAt` (UTC) con esos instantes,
 * así el filtro coincide con el día que ve el usuario en su reloj.
 *
 * Nota: se usa `new Date(y, m-1, d)` (constructor LOCAL) a propósito — es lo que
 * ancla el rango al huso del cliente. En el servidor solo se comparan instantes.
 */
export function localDayRangeUtc(ymd: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const end = new Date(y, mo - 1, d + 1, 0, 0, 0, 0); // el JS normaliza fin de mes
  // Coherencia: el constructor puede "corregir" fechas imposibles (p. ej. 31/02);
  // verificamos que el día de inicio es el pedido para no aceptar basura.
  if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}
