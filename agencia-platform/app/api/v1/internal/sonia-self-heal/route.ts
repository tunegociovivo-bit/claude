/**
 * POST /api/v1/internal/sonia-self-heal
 *
 * Endpoint interno (bearer INTERNAL_CRON_TOKEN) que recibe un runId
 * y lanza al agente de self-heal para que parchee el bug y abra PR.
 *
 * Llamado fire-and-forget desde process-run.ts cuando un run termina
 * en FAILED con classifyError === "technical" y env GITHUB_SELF_HEAL_*
 * configuradas.
 *
 * Devuelve { ok, prUrl?, merged?, error? } y deja un comentario en la
 * task original (firmado como Sonia) explicando lo que ha pasado:
 *   - "Sonia y Claude han subido un patch — PR #XXX. Cuando deploye,
 *      vuelve a pulsar Pedir a Sonia."
 *   - "Sonia intentó auto-fix pero no encontró el bug — toca revisar
 *      manual."
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { attemptSelfHeal } from "@/lib/ai/self-heal/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5min — el agente puede tardar

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const runId = String(body?.runId ?? "");
  if (!runId) return NextResponse.json({ error: "runId requerido" }, { status: 400 });

  const run = await prisma.aiAgentRun.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "run no encontrado" }, { status: 404 });
  if (!run.error) return NextResponse.json({ ok: false, reason: "run sin error" });

  const task = await prisma.task.findUnique({
    where: { id: run.taskId },
    select: { title: true, description: true, workspaceId: true }
  });
  if (!task) return NextResponse.json({ error: "task no encontrada" }, { status: 404 });

  // Construir tail del log para dar contexto al agente
  let logTail = "";
  try {
    const log = Array.isArray(run.log) ? (run.log as any[]) : [];
    const lastSteps = log.slice(-12);
    logTail = lastSteps
      .map((s: any) => {
        if (s.type === "tool_use") return `→ tool: ${s.tool}(${JSON.stringify(s.input).slice(0, 200)})`;
        if (s.type === "tool_result") return `  result: ${JSON.stringify(s.output).slice(0, 200)}`;
        if (s.type === "text") return `Sonia: ${String(s.text).slice(0, 300)}`;
        if (s.type === "error") return `ERROR: ${s.message}`;
        return `${s.type}: ${JSON.stringify(s).slice(0, 200)}`;
      })
      .join("\n");
  } catch {}

  const result = await attemptSelfHeal({
    workspaceId: task.workspaceId,
    runId,
    errorMsg: run.error,
    taskTitle: task.title,
    taskDescription: task.description,
    runLogTail: logTail
  });

  // Comentario en la task explicando el resultado
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: task.workspaceId },
      select: { settings: true }
    });
    const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
    if (aiUserId) {
      let body = "";
      if (result.ok && result.merged) {
        body =
          `🤖 **Auto-fix aplicado y mergeado a main.**\n\n` +
          `PR: ${result.prUrl}\n` +
          `Archivos cambiados: ${(result.filesChanged ?? []).map((f) => `\`${f}\``).join(", ")}\n\n` +
          `Cuando Railway termine de deployar (~3-5 min), **vuelve a pulsar "Pedir a Sonia"** en esta tarea para relanzarla con el código nuevo.`;
      } else if (result.ok && !result.merged) {
        body =
          `🤖 **Auto-fix propuesto (PR abierta, NO mergeada).**\n\n` +
          `PR: ${result.prUrl}\n` +
          `El agente consideró que el cambio necesita revisión humana antes de mergear (cambio no trivial).\n\n` +
          `Revisa la PR; si se ve bien, mergea manual y luego pulsa "Pedir a Sonia".`;
      } else {
        body =
          `🤖 **Auto-fix intentado pero sin éxito.**\n\n` +
          `Motivo: ${result.error ?? "(sin detalle)"}\n\n` +
          (result.agentReasoning
            ? `**Diagnóstico del agente:**\n>${result.agentReasoning.slice(0, 1200).replace(/\n/g, "\n>")}\n\n`
            : "") +
          `Toca arreglar a mano.`;
      }
      await prisma.comment.create({
        data: {
          workspaceId: task.workspaceId,
          authorId: aiUserId,
          targetType: "TASK",
          targetId: run.taskId,
          body
        }
      });
    }
  } catch (e: any) {
    console.warn("[self-heal] comment fail:", e?.message);
  }

  return NextResponse.json(result);
}
