/**
 * Planificador de instrucciones FUTURAS en comentarios de tareas.
 *
 * Antes de que Sonia ejecute un comentario, este módulo detecta si el texto
 * contiene acciones con fecha/hora futura ("mañana jueves a las 9:00…",
 * "el viernes…", "dentro de dos horas…"). Si las hay:
 *   - NO se ejecutan ahora: se crea UNA ejecución programada por instante,
 *     reutilizando la primitiva existente (task «🔁» con dueDate — la recoge
 *     el cron /api/v1/internal/sonia-followup-cron y crea el AiAgentRun).
 *   - Se persiste un registro auditable por acción (SoniaScheduledInstruction)
 *     con origen, timezone, instante, payload normalizado, estado e intentos.
 *   - Se confirma en la tarea con fechas absolutas, zona horaria, rango de
 *     datos y destinatario enmascarado; las expresiones ambiguas o pasadas se
 *     devuelven como pregunta con el ajuste propuesto, nunca se ejecutan
 *     "interpretadas" en silencio.
 *
 * El LLM solo extrae estructura (acciones + WhenSpec, ver ./plan.ts); la
 * resolución temporal es determinista (./temporal.ts). Idempotencia por
 * commentId: reprocesar el mismo comentario no duplica programaciones (guard
 * en BD + unique commentId+scheduledAt).
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { formatWallClock, looksLikeFutureInstruction } from "./temporal";
import { buildPlan, renderConfirmation, renderFollowupDescription, type Extraction } from "./plan";

export { buildPlan, renderConfirmation, renderFollowupDescription } from "./plan";
export type { Extraction, ExtractedAction, Plan } from "./plan";

export const DEFAULT_TIMEZONE = "Europe/Madrid";

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          summary: { type: "string" },
          artifact: { type: "string" },
          dataRange: { type: "string" },
          channel: { type: "string", enum: ["whatsapp", "email", "comment", "other"] },
          recipient: { type: "string" },
          when: {
            type: "object",
            properties: {
              dateIso: { type: "string" },
              dayWord: { type: "string", enum: ["hoy", "mañana", "pasado mañana"] },
              weekday: { type: "string" },
              inAmount: { type: "number" },
              inUnit: { type: "string", enum: ["minutes", "hours", "days", "weeks"] },
              time: { type: "string" },
              raw: { type: "string" }
            }
          }
        },
        required: ["summary", "when"]
      }
    },
    immediateWork: { type: "string" }
  },
  required: ["actions"]
};

const EXTRACTION_SYSTEM = `Eres un parser de instrucciones dentro de un gestor de tareas en español.
Tu ÚNICO trabajo es detectar, en un comentario, las acciones que el usuario pide para un MOMENTO FUTURO concreto, y separarlas del trabajo pedido para AHORA.

Reglas estrictas:
- Una acción va en "actions" SOLO si el usuario indica cuándo debe ocurrir (expresión relativa o absoluta: "mañana", "el viernes", "dentro de dos horas", "el 3 de septiembre", "a las 9:00" referida a otro día…).
- NO resuelvas fechas relativas a fechas absolutas: devuelve la expresión troceada en "when" (dayWord/weekday/dateIso/inAmount+inUnit/time) y el texto original en when.raw. La resolución la hace el sistema, no tú.
- "when.time" en formato 24h "HH:MM". "when.weekday" en minúsculas ("jueves"). "when.dateIso" SOLO si el usuario dio fecha absoluta (usa el año en curso si no lo dijo; si dio día y mes, "YYYY-MM-DD").
- Cada instante distinto = una acción distinta (aunque compartan frase).
- EXCEPCIÓN IMPORTANTE: generar un archivo y enviar ESE MISMO archivo son una sola entrega, no dos acciones aisladas. El summary debe ordenar generar + enviar y conservar el rango y destinatario.
- Para esa entrega combinada, usa la hora de envío si es posterior y viable. Si la hora de envío ya pasó o es anterior a la hora de generación indicada en la misma cláusula (ej.: hoy generar 17:20 y enviar 9:00), usa la hora FUTURA de generación para hacer ambas cosas juntas. Nunca programes el envío en el pasado ni antes de que exista el archivo.
- Un día/fecha mencionado aplica a toda su cláusula hasta la siguiente conjunción que introduzca otro día (ej.: «hoy ... y el viernes ...» son dos entregas).
- Si una cláusula futura dice generar un rango y enviarlo a una hora, aunque no dé otra hora de generación, genera y envía en el mismo followup a la hora de envío.
- "summary" debe ser AUTOCONTENIDO: leyéndolo solo, otra persona sabría exactamente qué generar/enviar sin ver el comentario original. Incluye el rango de datos y el destinatario dentro del summary además de en sus campos.
- "dataRange": el rango de datos/fechas del CONTENIDO pedido (no confundir con el momento de ejecución).
- "recipient": tal cual lo escribió el usuario (teléfono, email…).
- "immediateWork": lo que pide hacer YA, o null si todo es futuro. El saludo o contexto no es trabajo.
- No inventes acciones, canales ni destinatarios que no estén en el texto.
Devuelve SOLO el JSON.`;

export async function extractFutureActions(opts: {
  workspaceId: string;
  text: string;
  nowUtc: Date;
  timeZone: string;
}): Promise<Extraction> {
  const nowWall = formatWallClock(opts.nowUtc, opts.timeZone);
  const out = await completeJson<Extraction>({
    workspaceId: opts.workspaceId,
    system: EXTRACTION_SYSTEM,
    user:
      `Ahora es: ${nowWall} — SOLO como referencia de "hoy"; recuerda: NO conviertas expresiones relativas a fechas.\n\n` +
      `Comentario del usuario:\n«${opts.text.slice(0, 4000)}»\n\nExtrae el JSON:`,
    schema: EXTRACTION_SCHEMA,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 1500
  });
  return {
    actions: Array.isArray(out?.actions) ? out.actions : [],
    immediateWork: typeof out?.immediateWork === "string" && out.immediateWork.trim() ? out.immediateWork.trim() : null
  };
}

export type PlanOutcome = {
  scheduled: number;
  problems: number;
  immediateWork: string | null;
  /** true si ya se había procesado este comentario (idempotencia). */
  alreadyProcessed: boolean;
};

export async function planFutureInstructions(opts: {
  workspaceId: string;
  taskId: string;
  commentId: string;
  commentText: string;
}): Promise<PlanOutcome | null> {
  // Filtro barato: sin pistas temporales no gastamos ni un token.
  if (!looksLikeFutureInstruction(opts.commentText)) return null;

  // Idempotencia: si este comentario ya generó programaciones (reintento del
  // hook, reprocesado manual, webhook duplicado), no se duplica nada.
  const prior = await prisma.soniaScheduledInstruction.findFirst({
    where: { workspaceId: opts.workspaceId, commentId: opts.commentId },
    select: { id: true }
  });
  if (prior) return { scheduled: 0, problems: 0, immediateWork: null, alreadyProcessed: true };

  const ws = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  const timeZone: string = settings?.timezone || settings?.aiAgent?.timezone || DEFAULT_TIMEZONE;
  const aiUserId: string | undefined = settings?.aiAgent?.userId;

  const nowUtc = new Date();
  const extraction = await extractFutureActions({
    workspaceId: opts.workspaceId,
    text: opts.commentText,
    nowUtc,
    timeZone
  });
  if (extraction.actions.length === 0) return null;

  const plan = buildPlan(extraction, nowUtc, timeZone);

  // Capacidades: si alguna acción es WhatsApp, comprobamos que el workspace
  // tenga el proveedor configurado — si no, se avisa AL PROGRAMAR (nunca
  // prometer un envío automático imposible).
  const warnings: string[] = [];
  const wantsWhatsapp = [...plan.toSchedule, ...plan.problems].some((i) => i.action.channel === "whatsapp");
  if (wantsWhatsapp) {
    try {
      const { getWahaConfig } = await import("@/lib/leads/waha");
      await getWahaConfig(opts.workspaceId);
    } catch (e: any) {
      warnings.push(
        `El envío por WhatsApp no está operativo ahora mismo (${e?.message ?? "sin configurar"}): programaré la generación igualmente, pero el envío quedará pendiente de que se arregle la configuración o lo mande un humano.`
      );
    }
  }

  const parent = await prisma.task.findFirst({
    where: { id: opts.taskId, workspaceId: opts.workspaceId },
    select: { projectId: true, title: true }
  });

  let scheduled = 0;
  for (const item of plan.toSchedule) {
    const description = renderFollowupDescription({
      originTaskId: opts.taskId,
      commentId: opts.commentId,
      timeZone,
      item,
      sourceText: opts.commentText
    });
    // Task 🔁 = la primitiva de programación existente (sonia-followup-cron).
    const followup = await prisma.task.create({
      data: {
        workspaceId: opts.workspaceId,
        title: `🔁 ${item.action.summary.slice(0, 180)}`,
        description,
        status: "TODO",
        priority: "MEDIUM",
        projectId: parent?.projectId ?? null,
        dueDate: item.resolved.atUtc
      } as any
    });
    try {
      await prisma.soniaScheduledInstruction.create({
        data: {
          workspaceId: opts.workspaceId,
          taskId: opts.taskId,
          commentId: opts.commentId,
          followupTaskId: followup.id,
          sourceText: opts.commentText.slice(0, 4000),
          timezone: timeZone,
          scheduledAt: item.resolved.atUtc,
          payload: {
            summary: item.action.summary,
            artifact: item.action.artifact ?? null,
            dataRange: item.action.dataRange ?? null,
            channel: item.action.channel ?? null,
            recipient: item.action.recipient ?? null,
            when: item.action.when,
            wallClock: item.resolved.wallClock
          } as any,
          status: "SCHEDULED"
        }
      });
      scheduled++;
    } catch (e: any) {
      // Carrera con otro procesado del mismo comentario (unique commentId+
      // scheduledAt): retira la task duplicada y sigue.
      await prisma.task.delete({ where: { id: followup.id } }).catch(() => undefined);
      if ((e as any)?.code !== "P2002") throw e;
    }
  }

  // Registro auditable también de lo NO programado (ambiguo/pasado/sin hora):
  // queda visible qué se entendió y por qué no se ejecutó.
  for (const p of plan.problems) {
    await prisma.soniaScheduledInstruction
      .create({
        data: {
          workspaceId: opts.workspaceId,
          taskId: opts.taskId,
          commentId: opts.commentId,
          sourceText: opts.commentText.slice(0, 4000),
          timezone: timeZone,
          scheduledAt: p.resolved.proposedUtc ?? nowUtc,
          payload: {
            summary: p.action.summary,
            channel: p.action.channel ?? null,
            recipient: p.action.recipient ?? null,
            when: p.action.when,
            problem: { reason: p.resolved.reason, detail: p.resolved.detail }
          } as any,
          status: "NEEDS_CLARIFICATION",
          lastError: p.resolved.detail
        }
      })
      .catch(() => undefined);
  }

  // Confirmación inequívoca en la tarea (autor: la user IA del workspace).
  if (aiUserId && (plan.toSchedule.length > 0 || plan.problems.length > 0)) {
    await prisma.comment
      .create({
        data: {
          workspaceId: opts.workspaceId,
          authorId: aiUserId,
          targetType: "TASK",
          targetId: opts.taskId,
          body: renderConfirmation(plan, warnings)
        }
      })
      .catch((e: any) => console.warn("[sonia schedule] confirmación fallo:", e?.message));
  }

  return {
    scheduled,
    problems: plan.problems.length,
    immediateWork: plan.immediateWork,
    alreadyProcessed: false
  };
}
