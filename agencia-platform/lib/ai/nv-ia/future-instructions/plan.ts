/**
 * Capa PURA del planificador de instrucciones futuras: tipos de la extracción,
 * construcción del plan (resolución temporal + dedupe) y render de los textos
 * (confirmación al usuario y descripción de la task 🔁). Sin BD, sin red —
 * todo testeable con tsx (scripts/test-sonia-schedule.ts).
 */
import { maskPhone, resolveWhen, type ResolvedWhen, type WhenSpec } from "./temporal";

export type ExtractedAction = {
  /** Qué hay que hacer, autocontenido ("generar informe de leads y enviarlo"). */
  summary: string;
  /** Artefacto/entregable ("informe de descargas de leads"), si lo hay. */
  artifact?: string | null;
  /** Rango de datos pedido ("26–27 de agosto") — no confundir con el instante. */
  dataRange?: string | null;
  channel?: "whatsapp" | "email" | "comment" | "other" | null;
  recipient?: string | null;
  when: WhenSpec;
};

export type Extraction = {
  actions: ExtractedAction[];
  /** Trabajo pedido PARA AHORA (null si todo el comentario es futuro). */
  immediateWork: string | null;
};

export type PlannedItem = {
  action: ExtractedAction;
  resolved: ResolvedWhen;
};

export type Plan = {
  timeZone: string;
  toSchedule: Array<PlannedItem & { resolved: Extract<ResolvedWhen, { ok: true }> }>;
  problems: Array<PlannedItem & { resolved: Extract<ResolvedWhen, { ok: false }> }>;
  immediateWork: string | null;
};

export function buildPlan(extraction: Extraction, nowUtc: Date, timeZone: string): Plan {
  const toSchedule: Plan["toSchedule"] = [];
  const problems: Plan["problems"] = [];
  for (const action of extraction.actions) {
    const resolved = resolveWhen(action.when ?? {}, nowUtc, timeZone);
    if (resolved.ok) toSchedule.push({ action, resolved });
    else problems.push({ action, resolved });
  }
  // Dedupe de instantes idénticos dentro del mismo comentario (el LLM puede
  // partir una frase en dos acciones iguales): mismo instante + mismo canal +
  // mismo destinatario + mismo rango ⇒ una sola programación.
  const seen = new Set<string>();
  const deduped = toSchedule.filter((item) => {
    const key = `${item.resolved.atUtc.getTime()}|${item.action.channel ?? ""}|${item.action.recipient ?? ""}|${item.action.dataRange ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { timeZone, toSchedule: deduped, problems, immediateWork: extraction.immediateWork };
}

function describeItem(action: ExtractedAction): string {
  const bits: string[] = [];
  if (action.artifact) bits.push(action.artifact);
  if (action.dataRange) bits.push(`datos: ${action.dataRange}`);
  if (action.channel === "whatsapp") bits.push(`WhatsApp a ${action.recipient ? maskPhone(action.recipient) : "(sin destinatario)"}`);
  else if (action.channel === "email") bits.push(`email a ${action.recipient ?? "(sin destinatario)"}`);
  else if (action.channel) bits.push(action.channel);
  return bits.length ? bits.join(" · ") : action.summary;
}

/** Texto de confirmación para el comentario de Sonia en la tarea. El teléfono
 *  del destinatario va SIEMPRE enmascarado — nunca en claro. */
export function renderConfirmation(plan: Plan, warnings: string[]): string {
  const lines: string[] = [];
  if (plan.toSchedule.length > 0) {
    lines.push(`🗓️ **He programado ${plan.toSchedule.length === 1 ? "esta ejecución" : `estas ${plan.toSchedule.length} ejecuciones`}** (no ejecuto nada ahora):`);
    for (const item of plan.toSchedule) {
      lines.push(`- **${item.resolved.wallClock}** → ${describeItem(item.action)}`);
    }
  }
  if (plan.problems.length > 0) {
    lines.push("");
    lines.push("⚠️ **Necesito aclaración antes de programar esto** (no lo ejecuto por mi cuenta):");
    for (const p of plan.problems) {
      const prop = p.resolved.proposedWallClock ? ` ¿Te refieres a **${p.resolved.proposedWallClock}**? Confírmamelo y lo programo.` : "";
      lines.push(`- ${describeItem(p.action)} — ${p.resolved.detail}.${prop}`);
    }
  }
  for (const w of warnings) {
    lines.push("");
    lines.push(`⚠️ ${w}`);
  }
  if (plan.immediateWork) {
    lines.push("");
    lines.push(`▶️ Del resto del comentario me pongo ahora con: ${plan.immediateWork}`);
  }
  return lines.join("\n");
}

/** Descripción de la task 🔁 que ejecutará la acción en su instante. */
export function renderFollowupDescription(opts: {
  originTaskId: string;
  commentId: string;
  timeZone: string;
  item: Plan["toSchedule"][number];
  sourceText: string;
}): string {
  const { action } = opts.item;
  return [
    `Ejecución programada de una instrucción futura del usuario.`,
    ``,
    `**Qué hacer ahora (es el momento acordado):** ${action.summary}`,
    action.dataRange ? `**Rango de datos pedido:** ${action.dataRange}` : null,
    action.channel ? `**Canal de entrega:** ${action.channel}${action.recipient ? ` → ${action.recipient}` : ""}` : null,
    ``,
    `**Contexto completo:** lee la tarea original ${opts.originTaskId} (título, descripción, comentarios y adjuntos) antes de generar nada — el informe debe seguir el mismo formato que los anteriores de esa tarea.`,
    `Programado desde el comentario ${opts.commentId}; instante acordado: ${opts.item.resolved.wallClock}.`,
    ``,
    `Instrucción original del usuario:`,
    `«${opts.sourceText.slice(0, 1500)}»`,
    ``,
    `_(Auto-creada por Sonia como ejecución programada de la task ${opts.originTaskId})_`
  ]
    .filter((l) => l !== null)
    .join("\n");
}
