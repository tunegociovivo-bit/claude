import { prisma } from "@/lib/db/prisma";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

const RECOVERABLE_STATUSES = new Set(["FAILED", "REQUIRES_HUMAN"]);

const ANTHROPIC_BILLING_ERRORS = [
  "credit balance is too low",
  "plans & billing",
  "purchase credits"
];

const OWNER_LEADS_DELIVERY_TASK_ID = "cmssnkeu600o021fdb8xfytz6";
const OWNER_LEADS_DELIVERY_MARKER = "RECUPERACION_ENTREGA_LEADS_2026_09_04_V4";

export function isRecoverableAnthropicBillingFailure(run: {
  status: string;
  error: string | null;
}): boolean {
  if (!RECOVERABLE_STATUSES.has(run.status) || !run.error) return false;

  const normalizedError = run.error.toLowerCase();
  return ANTHROPIC_BILLING_ERRORS.some((message) => normalizedError.includes(message));
}

export async function recoverRecentAnthropicBillingFailures(options?: {
  hours?: number;
  limit?: number;
}): Promise<number> {
  const hours = options?.hours ?? 24;
  const limit = options?.limit ?? 20;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const failedCandidates = await prisma.aiAgentRun.findMany({
    where: {
      status: { in: ["FAILED", "REQUIRES_HUMAN"] },
      createdAt: { gte: cutoff },
      error: { not: null }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  let recovered = 0;
  for (const failedRun of failedCandidates) {
    if (!isRecoverableAnthropicBillingFailure(failedRun)) continue;

    const newerRun = await prisma.aiAgentRun.findFirst({
      where: {
        taskId: failedRun.taskId,
        createdAt: { gt: failedRun.createdAt }
      },
      select: { id: true }
    });
    if (newerRun) continue;

    const retry = await prisma.aiAgentRun.create({
      data: {
        workspaceId: failedRun.workspaceId,
        taskId: failedRun.taskId,
        requesterId: failedRun.requesterId,
        trigger: failedRun.trigger,
        triggerContext:
          "Recuperación automática tras rechazo de Anthropic por saldo. Completa la petición original usando el proveedor alternativo OpenAI."
      }
    });
    processRunInBackground(retry.id);
    recovered += 1;
  }

  return recovered;
}

/**
 * Reparación puntual solicitada por el propietario: el encargo original decía
 * "envíame" pero el teléfono estaba en la conversación de soporte, no en la
 * tarea. Se crea exactamente una ejecución con destinatario y entrega nativa
 * explícitos. El marker persistido evita repetirla en futuros despliegues.
 */
export async function ensureOwnerLeadsDeliveryRetry(): Promise<boolean> {
  const alreadyScheduled = await prisma.aiAgentRun.findFirst({
    where: {
      taskId: OWNER_LEADS_DELIVERY_TASK_ID,
      triggerContext: { contains: OWNER_LEADS_DELIVERY_MARKER }
    },
    select: { id: true }
  });
  if (alreadyScheduled) return false;

  const sourceRun = await prisma.aiAgentRun.findFirst({
    where: { taskId: OWNER_LEADS_DELIVERY_TASK_ID },
    orderBy: { createdAt: "desc" },
    select: { workspaceId: true, requesterId: true }
  });
  if (!sourceRun) return false;

  const retry = await prisma.aiAgentRun.create({
    data: {
      workspaceId: sourceRun.workspaceId,
      taskId: OWNER_LEADS_DELIVERY_TASK_ID,
      requesterId: sourceRun.requesterId,
      trigger: "MANUAL",
      triggerContext: `${OWNER_LEADS_DELIVERY_MARKER}\nEJECUCIÓN DE RECUPERACIÓN CON RANGO FIJO. Ignora por completo cualquier rango de fechas anterior que aparezca en la descripción, comentarios, adjuntos o ejecuciones previas de esta tarea. El único rango autorizado para esta ejecución es desde 2026-08-31 hasta 2026-09-04, ambos días incluidos. Descarga los leads de las campañas de M&M Travel de Colombia (120210470402160107), Perú (120210470385990107) y Ecuador (120213755763030107) usando exactamente since=2026-08-31 y until=2026-09-04. Genera un Excel consolidado nuevo cuyo nombre incluya 31ago-04sep-2026, adjúntalo a la tarea y envía el ARCHIVO NATIVO por WhatsApp al teléfono personal autorizado +34680167881 usando list_task_files y draft_whatsapp_file. No reutilices ni envíes archivos de agosto con otros rangos. No te limites a redactar un mensaje ni a dejar un enlace: confirma el envío solo si la herramienta devuelve ejecución correcta. Si una herramienta falla, explica el error real en la tarea.`
    }
  });
  processRunInBackground(retry.id);
  return true;
}
