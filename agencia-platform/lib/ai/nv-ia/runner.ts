/**
 * Runner del agente Sonia — Fase 1.
 *
 * Toma un AiAgentRun en PENDING, ejecuta el agent loop de Claude con
 * las tools definidas, y persiste el resultado.
 *
 * El loop es síncrono dentro de la request del cron — para Fase 1
 * basta. Si en Fase 2 queremos paralelizar runs largos, pasamos a un
 * job queue (BullMQ + Redis o Inngest).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";
import { logAiUsage } from "@/lib/ai/usage";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS, type ToolContext } from "./tools";
import { DEFAULT_AGENT_CONFIG, type AgentLogStep, type AgentRunResult, type AiAgentConfig } from "./types";
import {
  loadLessonsForRun,
  formatLessonsForPrompt,
  inferScopesForTask
} from "./lessons";
import {
  extractAdhocCredentials,
  loadStoredAdhocCredentials,
  persistAdhocCredentials
} from "./adhoc-credentials";

/**
 * Resuelve las credenciales ad-hoc disponibles para este run:
 *
 *   1. Escanea descripción + comentarios de la task → credenciales NUEVAS.
 *   2. Si encuentra alguna, las persiste cifradas en
 *      Workspace.settings.adhocCredentials — sobreescriben las
 *      almacenadas con el mismo KEY.
 *   3. Lee las almacenadas (que ya incluyen las nuevas).
 *   4. Devuelve el map plano KEY → valor que el ToolContext usará.
 *
 * Resultado: pegar un token en CUALQUIER task lo hace disponible
 * para TODOS los siguientes runs hasta que se sustituya por otro
 * con el mismo KEY.
 */
async function loadAdhocCredentialsForTask(
  taskId: string,
  workspaceId: string
): Promise<Record<string, string>> {
  // 1) Extraer de la task actual
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
    select: { description: true, title: true }
  });
  const comments = await prisma.comment.findMany({
    where: { workspaceId, targetType: "TASK", targetId: taskId },
    select: { body: true },
    orderBy: { createdAt: "asc" }
  });
  const blob = [
    task?.title ?? "",
    task?.description ?? "",
    ...comments.map((c) => c.body ?? "")
  ].join("\n\n");
  const fresh = extractAdhocCredentials(blob);

  // 2) Persistir las nuevas (sobreescribe KEYs colisionantes, deja
  //    intactas las demás).
  if (Object.keys(fresh).length > 0) {
    try {
      await persistAdhocCredentials(workspaceId, fresh, taskId);
    } catch (e) {
      console.warn(
        "[sonia] no se pudieron persistir adhoc credentials:",
        (e as Error).message
      );
    }
  }

  // 3) Leer las almacenadas (ya incluyen las recién persistidas).
  //    Las del task ganan por si la persistencia falló por algún motivo.
  const stored = await loadStoredAdhocCredentials(workspaceId);
  return { ...stored, ...fresh };
}

const SYSTEM_PROMPT = `__SONIA_SYSTEM_PROMPT_PLACEHOLDER__`;
