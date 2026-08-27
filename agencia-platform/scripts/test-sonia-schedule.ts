/**
 * Tests (ejecutables con tsx, sin framework) del planificador de
 * instrucciones futuras de Sonia:
 *   - Parser temporal determinista (resolveWhen / zonedTimeToUtc):
 *     caso real MARIAM, cambio de mes/año, DST Europe/Madrid, ambigüedades,
 *     pasado, "dentro de N horas", weekday en el mismo día.
 *   - Integración extracción→plan (extracción estubada con EXACTAMENTE el
 *     texto del caso real): dos ejecuciones, instantes correctos, cero
 *     ejecución inmediata, dedupe de duplicados y confirmación enmascarada.
 *
 *   npx tsx scripts/test-sonia-schedule.ts
 *
 * Sale con código != 0 si algún assert falla. NO toca la base de datos ni
 * llama a ningún LLM: la idempotencia a nivel de BD la garantizan el guard
 * por commentId y el unique (commentId, scheduledAt) del modelo
 * SoniaScheduledInstruction.
 */
import {
  formatWallClock,
  looksLikeFutureInstruction,
  maskPhone,
  resolveWhen,
  zonedTimeToUtc
} from "../lib/ai/nv-ia/future-instructions/temporal";
import { buildPlan, renderConfirmation, type Extraction } from "../lib/ai/nv-ia/future-instructions/plan";

let failed = 0;
function ok(cond: boolean, msg: string) {
  console.log((cond ? "✅" : "❌") + " " + msg);
  if (!cond) failed++;
}
function iso(d: Date | undefined | null): string {
  return d ? d.toISOString() : "(null)";
}

const TZ = "Europe/Madrid";
// Caso real: comentario escrito el miércoles 26/08/2026 a las 19:50 (Madrid).
const BASE = zonedTimeToUtc(2026, 8, 26, 19, 50, TZ);

console.log("— zonedTimeToUtc / base —");
ok(BASE.toISOString() === "2026-08-26T17:50:00.000Z", `base 26/08 19:50 Madrid = 17:50Z (got ${iso(BASE)})`);

console.log("— caso real: «mañana jueves … a las 9:00» —");
{
  const r = resolveWhen({ dayWord: "mañana", weekday: "jueves", time: "09:00", raw: "mañana jueves a las 9:00" }, BASE, TZ);
  ok(r.ok === true, "resuelve sin ambigüedad (mañana ES jueves)");
  if (r.ok) {
    ok(r.atUtc.toISOString() === "2026-08-27T07:00:00.000Z", `jueves 27/08 09:00 Madrid = 07:00Z (got ${iso(r.atUtc)})`);
    ok(r.wallClock.includes("27/08/2026 09:00") && r.wallClock.includes(TZ), `wallClock legible: ${r.wallClock}`);
  }
}

console.log("— caso real: «el viernes … a las 9:00» —");
{
  const r = resolveWhen({ weekday: "viernes", time: "09:00", raw: "el viernes a las 9:00" }, BASE, TZ);
  ok(r.ok === true, "resuelve el próximo viernes");
  if (r.ok) ok(r.atUtc.toISOString() === "2026-08-28T07:00:00.000Z", `viernes 28/08 09:00 Madrid = 07:00Z (got ${iso(r.atUtc)})`);
}

console.log("— cambio de mes y de año —");
{
  const b = zonedTimeToUtc(2026, 8, 31, 12, 0, TZ);
  const r = resolveWhen({ dayWord: "mañana", time: "09:00", raw: "mañana a las 9" }, b, TZ);
  ok(r.ok && r.atUtc.toISOString() === "2026-09-01T07:00:00.000Z", `31/08 → mañana = 01/09 (got ${r.ok ? iso(r.atUtc) : (r as any).reason})`);
  const b2 = zonedTimeToUtc(2026, 12, 31, 12, 0, TZ);
  const r2 = resolveWhen({ dayWord: "mañana", time: "09:00", raw: "mañana a las 9" }, b2, TZ);
  // 09:00 Madrid en invierno = 08:00Z (CET) — cubre también el offset DST invierno.
  ok(r2.ok && r2.atUtc.toISOString() === "2027-01-01T08:00:00.000Z", `31/12/2026 → mañana = 01/01/2027 08:00Z (got ${r2.ok ? iso(r2.atUtc) : (r2 as any).reason})`);
}

console.log("— DST Europe/Madrid —");
{
  // Salto de primavera 2026: 29/03, las 02:30 NO existen → se desplaza por el
  // hueco (03:30 CEST = 01:30Z).
  const spring = zonedTimeToUtc(2026, 3, 29, 2, 30, TZ);
  ok(spring.toISOString() === "2026-03-29T01:30:00.000Z", `02:30 inexistente → 01:30Z (got ${iso(spring)})`);
  ok(formatWallClock(spring, TZ).includes("03:30"), `proyecta a 03:30 hora-pared (got ${formatWallClock(spring, TZ)})`);
  // Vuelta de otoño 2026: 25/10, las 02:30 ocurre dos veces → el algoritmo
  // devuelve determinísticamente la ocurrencia de hora de invierno (CET).
  const fall = zonedTimeToUtc(2026, 10, 25, 2, 30, TZ);
  ok(fall.toISOString() === "2026-10-25T01:30:00.000Z", `02:30 ambigua → determinista 01:30Z (CET) (got ${iso(fall)})`);
  // Programar "09:00" a ambos lados del cambio: verano 07:00Z, invierno 08:00Z.
  ok(zonedTimeToUtc(2026, 10, 24, 9, 0, TZ).toISOString() === "2026-10-24T07:00:00.000Z", "09:00 del 24/10 (CEST) = 07:00Z");
  ok(zonedTimeToUtc(2026, 10, 26, 9, 0, TZ).toISOString() === "2026-10-26T08:00:00.000Z", "09:00 del 26/10 (CET) = 08:00Z");
}

console.log("— ambigüedad, pasado, sin hora, mismo weekday —");
{
  // "mañana viernes" cuando mañana es JUEVES → ambigua con propuesta viernes.
  const amb = resolveWhen({ dayWord: "mañana", weekday: "viernes", time: "09:00", raw: "mañana viernes a las 9" }, BASE, TZ);
  ok(amb.ok === false && amb.reason === "ambiguous", "«mañana viernes» (siendo miércoles) → ambiguous");
  ok(amb.ok === false && iso(amb.proposedUtc) === "2026-08-28T07:00:00.000Z", `propuesta = viernes 28 09:00 (got ${amb.ok === false ? iso(amb.proposedUtc) : "?"})`);
  // "hoy a las 9:00" escrito a las 19:50 → pasado, propone mañana 9:00.
  const past = resolveWhen({ dayWord: "hoy", time: "09:00", raw: "hoy a las 9:00" }, BASE, TZ);
  ok(past.ok === false && past.reason === "past", "«hoy a las 9:00» a las 19:50 → past");
  ok(past.ok === false && iso(past.proposedUtc) === "2026-08-27T07:00:00.000Z", "propone el día siguiente a la misma hora");
  // Sin hora → needs_time (no se inventa medianoche).
  const nt = resolveWhen({ weekday: "viernes", raw: "el viernes" }, BASE, TZ);
  ok(nt.ok === false && nt.reason === "needs_time", "sin hora → needs_time");
  // Weekday igual al de hoy → SIGUIENTE semana, nunca hoy.
  const sameDay = resolveWhen({ weekday: "miércoles", time: "09:00", raw: "el miércoles a las 9" }, BASE, TZ);
  ok(sameDay.ok === true && sameDay.ok && iso(sameDay.atUtc) === "2026-09-02T07:00:00.000Z", `«el miércoles» siendo miércoles → +7 días (got ${sameDay.ok ? iso(sameDay.atUtc) : "?"})`);
}

console.log("— dentro de N horas / fecha absoluta —");
{
  const inTwo = resolveWhen({ inAmount: 2, inUnit: "hours", raw: "dentro de dos horas" }, BASE, TZ);
  ok(inTwo.ok === true && iso(inTwo.ok ? inTwo.atUtc : null) === "2026-08-26T19:50:00.000Z", "«dentro de dos horas» = base + 2h");
  const abs = resolveWhen({ dateIso: "2026-09-03", time: "10:15", raw: "el 3 de septiembre a las 10:15" }, BASE, TZ);
  ok(abs.ok === true && iso(abs.ok ? abs.atUtc : null) === "2026-09-03T08:15:00.000Z", "fecha absoluta 03/09 10:15 = 08:15Z");
}

console.log("— integración: EXACTAMENTE el texto del caso real —");
const CASE_TEXT =
  "Quiero que mañana jueves me lo generes de los días 26 y 27 de agosto y me lo mandes por whatsapp al +34680167881 a las 9:00, y quiero que el viernes me generes de los días 27 y 28 y me los mandes por whatsapp al +34680167881 a las 9:00";
{
  ok(looksLikeFutureInstruction(CASE_TEXT), "el pre-filtro barato detecta pistas temporales en el texto");
  // Extracción estubada: la forma EXACTA que el esquema del extractor LLM
  // devuelve para este texto (la capa LLM entiende el idioma; la resolución
  // temporal y el plan son deterministas y es lo que se verifica aquí).
  const extraction: Extraction = {
    actions: [
      {
        summary: "Generar el informe de descarga de leads de los días 26 y 27 de agosto y enviarlo por WhatsApp al +34680167881",
        artifact: "informe de descarga de leads",
        dataRange: "26–27 de agosto",
        channel: "whatsapp",
        recipient: "+34680167881",
        when: { dayWord: "mañana", weekday: "jueves", time: "09:00", raw: "mañana jueves a las 9:00" }
      },
      {
        summary: "Generar el informe de descarga de leads de los días 27 y 28 de agosto y enviarlo por WhatsApp al +34680167881",
        artifact: "informe de descarga de leads",
        dataRange: "27–28 de agosto",
        channel: "whatsapp",
        recipient: "+34680167881",
        when: { weekday: "viernes", time: "09:00", raw: "el viernes a las 9:00" }
      }
    ],
    immediateWork: null
  };
  const plan = buildPlan(extraction, BASE, TZ);
  ok(plan.toSchedule.length === 2, `exactamente 2 ejecuciones programadas (got ${plan.toSchedule.length})`);
  ok(plan.problems.length === 0, "cero ambigüedades");
  ok(iso(plan.toSchedule[0]?.resolved.atUtc) === "2026-08-27T07:00:00.000Z", "1ª: jueves 27/08 09:00 Madrid");
  ok(iso(plan.toSchedule[1]?.resolved.atUtc) === "2026-08-28T07:00:00.000Z", "2ª: viernes 28/08 09:00 Madrid");
  // CRITERIO CLAVE: nada que ejecutar el 26/08 a las 19:51 — el hook suprime
  // el run inmediato cuando immediateWork es null.
  ok(plan.immediateWork === null, "sin trabajo inmediato → NO se ejecuta nada ahora");

  const conf = renderConfirmation(plan, []);
  ok(conf.includes("jueves 27/08/2026 09:00 (Europe/Madrid)"), "confirmación con fecha absoluta 1");
  ok(conf.includes("viernes 28/08/2026 09:00 (Europe/Madrid)"), "confirmación con fecha absoluta 2");
  ok(conf.includes("+34•••••7881"), "destinatario enmascarado en la confirmación");
  ok(!conf.includes("+34680167881"), "el teléfono en claro NO aparece en la confirmación");
  ok(conf.includes("26–27 de agosto") && conf.includes("27–28 de agosto"), "rangos de datos en la confirmación");
}

console.log("— dedupe de comentario reprocesado / acciones duplicadas —");
{
  const dupExtraction: Extraction = {
    actions: [
      {
        summary: "Enviar informe",
        dataRange: "26–27 de agosto",
        channel: "whatsapp",
        recipient: "+34680167881",
        when: { dayWord: "mañana", time: "09:00", raw: "mañana a las 9" }
      },
      {
        summary: "Enviar informe (duplicada por el extractor)",
        dataRange: "26–27 de agosto",
        channel: "whatsapp",
        recipient: "+34680167881",
        when: { weekday: "jueves", time: "09:00", raw: "el jueves a las 9" }
      }
    ],
    immediateWork: null
  };
  const plan = buildPlan(dupExtraction, BASE, TZ);
  ok(plan.toSchedule.length === 1, `mismo instante+canal+destinatario+rango → 1 sola programación (got ${plan.toSchedule.length})`);
}

console.log("— maskPhone —");
ok(maskPhone("+34680167881") === "+34•••••7881", `maskPhone (got ${maskPhone("+34680167881")})`);

console.log("");
if (failed > 0) {
  console.error(`❌ ${failed} test(s) fallidos`);
  process.exit(1);
}
console.log("✅ Todos los tests pasan");
