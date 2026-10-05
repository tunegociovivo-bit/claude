import type { CommentThreadMessage } from "./comment-thread";

export type WaitingJob = { id: string; status: string; deviceSerial: string; scheduledAt: Date; lastError: string | null; message: CommentThreadMessage };
export type WaitingContext = {
  now: Date;
  byId: ReadonlyMap<string, WaitingJob>;
  online: (deviceSerial: string) => boolean;
  blocked: (deviceSerial: string) => string | null;
  timezone?: string;
};

const PENDING = ["PENDING_APPROVAL", "QUEUED", "RUNNING", "WAITING_USER", "FAILED"];

function clock(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Explica en lenguaje claro por qué un mensaje todavía no se ha publicado. */
export function threadWaitingReason(job: WaitingJob, context: WaitingContext): string | null {
  const tz = context.timezone ?? "Europe/Madrid";
  switch (job.status) {
    case "COMPLETED": case "REJECTED": case "CANCELLED": return null;
    case "PENDING_APPROVAL": return "Falta aprobarlo.";
    case "RUNNING": return "Publicándose ahora en el móvil.";
    case "WAITING_USER": case "FAILED": return job.lastError ? `Parado: ${job.lastError}` : "Parado: se reactivará automáticamente.";
  }
  const parent = job.message.parentJobId ? context.byId.get(job.message.parentJobId) : undefined;
  if (parent && parent.status !== "COMPLETED") return `Esperando a que se publique #${parent.message.order}, al que responde.`;
  const previous = job.message.previousJobId ? context.byId.get(job.message.previousJobId) : undefined;
  if (previous && PENDING.includes(previous.status) && previous.status !== "FAILED" && previous.status !== "WAITING_USER") {
    return `Esperando su turno: antes va #${previous.message.order}.`;
  }
  if (job.scheduledAt > context.now) {
    return job.lastError ? `Reintento programado para las ${clock(job.scheduledAt, tz)}. Último error: ${job.lastError}` : `Programado para las ${clock(job.scheduledAt, tz)}.`;
  }
  if (!context.online(job.deviceSerial)) return "La pantalla de este móvil no está abierta en /moviles o el móvil está desconectado. Ábrela para que publique.";
  const blocked = context.blocked(job.deviceSerial);
  if (blocked) return `El móvil no puede publicar todavía: ${blocked}`;
  return "En cola: lo publicará en su próximo turno (en menos de un minuto).";
}
