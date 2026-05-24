/**
 * Procesador centralizado de AiAgentRun.
 *
 * Antes esta lógica vivía SOLO en /api/cron/ai-agent/process. Eso
 * exigía un cron externo (Railway / GitHub Actions) llamando al
 * endpoint cada 1-2 min. Si no se configura, los runs PENDING se
 * acumulan indefinidamente — el bug que el user reportó: "encargué
 * una tarea anoche y esta mañana sigue en pendiente".
 *
 * Ahora cualquier hook que cree un AiAgentRun puede llamar a
 * `void processRunInBackground(runId)` y el procesado arranca en el
 * mismo proceso Node, sin depender de crons externos. En Railway
 * (servidor persistente, no serverless) la promesa sobrevive a la
 * respuesta HTTP que la lanzó.
 *
 * El cron viejo sigue funcionando: drena los PENDING que se hayan
 * quedado huérfanos (proceso reiniciado a mitad, crash, etc.) usando
 * la misma `processOneRun`.
 */

import { prisma } from "@/lib/db/prisma";
import { executeAgentRun, loadAgentConfig } from "@/lib/ai/nv-ia/runner";
import { escalateRunToGitHub } from "@/lib/ai/nv-ia/escalate";

export type ProcessResult =
  | { skipped: true; runId: string }
  | { runId: string; status: string; steps?: number }
  | { runId: string; status: "FAILED"; error: string };

/**
 * Procesa UN AiAgentRun. Idempotente: si el run ya no está en PENDING
 * (otro proceso lo cogió), devuelve { skipped: true }.
 *
 * NO captura excepciones de fondo del runner — las traduce a
 * status=FAILED en BD y un retorno tipado. Llamadores que la usen
 * con `void` no necesitan try/catch.
 */
export async function processOneRun(runId: string): Promise<ProcessResult> {
  console.log(`[sonia] processOneRun start: ${runId}`);
  // Lock optimista: solo si sigue PENDING.
  const claimed = await prisma.aiAgentRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() }
  });
  if (claimed.count === 0) {
    console.log(`[sonia] processOneRun skipped (not PENDING anymore): ${runId}`);
    return { skipped: true, runId };
  }

  const run = await prisma.aiAgentRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.log(`[sonia] processOneRun skipped (run not found): ${runId}`);
    return { skipped: true, runId };
  }

  try {
    // Guard de presupuesto: si el cliente/workspace agotó su tope
    // mensual, paramos antes de gastar tokens.
    try {
      const { checkBudgetBeforeRun } = await import("@/lib/ai/nv-ia/budget");
      const budget = await checkBudgetBeforeRun({
        workspaceId: run.workspaceId,
        taskId: run.taskId
      });
      if (!budget.ok) {
        await prisma.aiAgentRun.update({
          where: { id: runId },
          data: {
            status: "REQUIRES_HUMAN",
            error: budget.reason,
            summary: `Bloqueado por presupuesto. Aumenta el tope en Workspace.settings.aiAgent.monthlyBudgetUsd ${budget.scope === "client" ? "o Client.settings.aiAgent.monthlyBudgetUsd" : ""} para reanudar.`,
            finishedAt: new Date()
          }
        });
        return { skipped: false, runId, status: "REQUIRES_HUMAN" } as any;
      }
      if (budget.level === "warning") {
        console.warn(`[sonia budget] ${budget.reason}`);
      }
    } catch (budgetErr: any) {
      console.warn(`[sonia budget] check fallo, sigo sin guard:`, budgetErr?.message);
    }

    // CORTACIRCUITOS POR TAREA: evita que una tarea que falla en bucle queme
    // dinero (cada run de una campaña Meta cuesta varios $). Si ya ha habido
    // >=5 runs de esta task en 24h y NINGUNO terminó con éxito, paramos y
    // pedimos intervención humana en vez de reintentar y seguir gastando.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Si el usuario ha INTERVENIDO (comentario humano) después de los fallos
      // —típicamente pegando un token nuevo o pidiendo reintentar— le damos una
      // ventana limpia: los runs anteriores a su intervención NO cuentan. Sin
      // esto, una tarea con N fallos quedaba pausada en bucle aunque el usuario
      // arreglara la causa raíz, porque cada relanzamiento volvía a ver los N
      // fallos viejos y se auto-pausaba sin intentarlo.
      const wsCb = await prisma.workspace.findUnique({
        where: { id: run.workspaceId },
        select: { settings: true }
      });
      const cbAiUserId = (wsCb?.settings as any)?.aiAgent?.userId;
      const lastHumanComment = await prisma.comment.findFirst({
        where: {
          workspaceId: run.workspaceId,
          targetType: "TASK",
          targetId: run.taskId,
          ...(cbAiUserId ? { authorId: { not: cbAiUserId } } : {})
        } as any,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      });
      const floor =
        lastHumanComment && lastHumanComment.createdAt > since ? lastHumanComment.createdAt : since;
      const recent = await prisma.aiAgentRun.findMany({
        where: { taskId: run.taskId, id: { not: runId }, createdAt: { gte: floor } } as any,
        select: { status: true }
      });
      const anySuccess = recent.some((r) => r.status === "SUCCEEDED");
      if (recent.length >= 5 && !anySuccess) {
        await prisma.aiAgentRun.update({
          where: { id: runId },
          data: {
            status: "REQUIRES_HUMAN",
            error: "circuit_breaker",
            summary: `Pausado por seguridad: ${recent.length} intentos en 24h sin completarse. Revisa la causa raíz (p.ej. credencial caducada o deploy pendiente) antes de reintentar — no sigo gastando.`,
            finishedAt: new Date()
          }
        });
        try {
          const ws3 = await prisma.workspace.findUnique({
            where: { id: run.workspaceId },
            select: { settings: true }
          });
          const aiUserId = (ws3?.settings as any)?.aiAgent?.userId;
          if (aiUserId) {
            await prisma.comment.create({
              data: {
                workspaceId: run.workspaceId,
                authorId: aiUserId,
                targetType: "TASK",
                targetId: run.taskId,
                body:
                  `🛑 **He pausado los reintentos de esta tarea.**\n\n` +
                  `Lleva ${recent.length} intentos en 24h sin completarse y cada intento cuesta dinero, así que paro para no quemar presupuesto en bucle. ` +
                  `Suele ser una causa raíz que se repite (credencial caducada, deploy pendiente, etc.). ` +
                  `Cuando esté resuelta, vuelve a lanzar la tarea manualmente y la retomo.`
              }
            });
          }
        } catch {
          /* comentario best-effort */
        }
        console.warn(`[sonia] circuit-breaker: task ${run.taskId} pausada tras ${recent.length} intentos sin éxito`);
        return { skipped: false, runId, status: "REQUIRES_HUMAN" } as any;
      }
    } catch (cbErr: any) {
      console.warn(`[sonia] circuit-breaker check fallo, sigo:`, cbErr?.message);
    }

    const config = await loadAgentConfig(run.workspaceId);

    // Multi-LLM routing opcional. Si Workspace.settings.aiAgent.modelRouting
    // está en "auto" o "cost_saver", aplicamos heurística al título +
    // descripción de la task y bajamos a Sonnet/Haiku cuando podemos —
    // ahorro 5-15× en tokens sin perder calidad en tareas simples.
    try {
      const ws = await prisma.workspace.findUnique({
        where: { id: run.workspaceId },
        select: { settings: true }
      });
      // Por defecto "auto": tareas simples → Sonnet/Haiku (barato), las
      // complejas (campañas, estrategia, copy) siguen en Opus. El admin
      // puede forzar "always_opus" o "cost_saver" en settings.aiAgent.modelRouting.
      const routing = ((ws?.settings as any)?.aiAgent?.modelRouting ?? "auto") as
        | "always_opus"
        | "auto"
        | "cost_saver";
      if (routing !== "always_opus") {
        const t = await prisma.task.findFirst({
          where: { id: run.taskId, workspaceId: run.workspaceId },
          select: { title: true, description: true }
        });
        if (t) {
          const { pickModelForTask } = await import("@/lib/ai/nv-ia/model-router");
          const picked = pickModelForTask({
            routing,
            title: t.title,
            description: t.description,
            fallback: (config.model as any) ?? "claude-opus-4-7"
          });
          if (picked.model !== config.model) {
            console.log(
              `[sonia] modelRouting=${routing} → ${picked.model} (${picked.reason})`
            );
            config.model = picked.model;
            // Persistimos el modelo elegido en el run para que se vea
            // en el dashboard y en el replay.
            await prisma.aiAgentRun.update({
              where: { id: runId },
              data: { model: picked.model }
            });
          }
        }
      }
    } catch (routerErr: any) {
      console.warn(`[sonia] modelRouting fallback (no aplicado):`, routerErr?.message);
    }

    console.log(`[sonia] executeAgentRun: task=${run.taskId} model=${config.model}`);
    const result = await executeAgentRun({
      workspaceId: run.workspaceId,
      taskId: run.taskId,
      config,
      runId: run.id,
      trigger: run.trigger,
      triggerContext: run.triggerContext
    });
    console.log(`[sonia] run ${runId} → ${result.status} (${result.stepsCount} steps)`);

    // AUTO-REQUEUE en saturación transitoria de Anthropic.
    // Si el run falló por 529/503/overloaded y NO hemos llegado al cap
    // de reintentos (10), no marcamos FAILED — re-PENDING para que el
    // cron lo recoja en su próxima pasada (1-2 min). El user no tiene
    // que hacer nada: Sonia espera a que Anthropic respire sola.
    // El contador se trackea en el log (pasos type=transient_requeue).
    const MAX_TRANSIENT_REQUEUES = 10;
    const transientRequeues = Array.isArray(result.log)
      ? result.log.filter((s: any) => s?.type === "transient_requeue").length
      : 0;
    const isTransientOverload =
      result.status === "FAILED" &&
      classifyError(result.error ?? "") === "transient";

    if (isTransientOverload && transientRequeues < MAX_TRANSIENT_REQUEUES) {
      const newLog = [
        ...(result.log as any[]),
        {
          type: "transient_requeue",
          ts: new Date().toISOString(),
          message: `Anthropic saturado (intento ${transientRequeues + 1}/${MAX_TRANSIENT_REQUEUES}) — re-encolando para reintento automático vía cron.`,
          error: (result.error ?? "").slice(0, 200)
        }
      ];
      await prisma.aiAgentRun.update({
        where: { id: runId },
        data: {
          status: "PENDING" as any,
          // Reseteamos lastIterationAt para que el watchdog no lo declare zombie
          lastIterationAt: new Date(),
          log: newLog as any,
          stepsCount: result.stepsCount,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens
        }
      });
      console.log(
        `[sonia] run ${runId} → transient overload, re-queued (${transientRequeues + 1}/${MAX_TRANSIENT_REQUEUES})`
      );
      // Comentario amable SOLO en el primer requeue, para que el user
      // sepa que no le hemos abandonado. Siguientes requeues son silenciosos.
      if (transientRequeues === 0) {
        try {
          const ws = await prisma.workspace.findUnique({
            where: { id: run.workspaceId },
            select: { settings: true }
          }).catch(() => null);
          const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
          if (aiUserId) {
            await prisma.comment.create({
              data: {
                workspaceId: run.workspaceId,
                authorId: aiUserId,
                targetType: "TASK",
                targetId: run.taskId,
                body:
                  "⏳ Anthropic está saturada justo ahora. Re-encolo automáticamente la task y la retomo en cuanto su infra respire (cron cada 1-2 min, hasta 10 reintentos). No tienes que hacer nada — te aviso cuando termine."
              }
            });
          }
        } catch {}
      }
      return { runId, status: "PENDING" as any, steps: result.stepsCount };
    }

    await prisma.aiAgentRun.update({
      where: { id: runId },
      data: {
        status: result.status as any,
        summary: result.summary,
        error: result.error,
        log: result.log as any,
        stepsCount: result.stepsCount,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        finishedAt: new Date()
      }
    });

    // PUSH DE APROBACIÓN: si el run dejó acciones PENDIENTES (borradores de
    // llamada/email/WhatsApp…), avisa por notificación push a los admins para
    // que puedan aprobar aunque NO estén dentro de la app en ese momento.
    try {
      const pend = await prisma.aiDraft.findMany({
        where: { workspaceId: run.workspaceId, aiAgentRunId: runId, status: "PENDING" },
        select: { title: true },
        orderBy: { createdAt: "asc" }
      });
      if (pend.length > 0) {
        const resumen = pend
          .slice(0, 3)
          .map((d) => (d.title.includes(":") ? d.title.split(":")[0] : d.title).trim())
          .join(" · ");
        const admins = await prisma.membership.findMany({
          where: { workspaceId: run.workspaceId, role: "ADMIN" },
          select: { userId: true }
        });
        const { sendPushToUser } = await import("@/lib/push/web-push");
        const title = pend.length === 1 ? "Sonia necesita tu OK" : `Sonia: ${pend.length} acciones esperan tu OK`;
        const link = `/tareas?task=${run.taskId}`;
        await Promise.all(
          admins.map((a) =>
            sendPushToUser(a.userId, { title, body: resumen.slice(0, 160), link, tag: `approve-${runId}` }).catch(() => {})
          )
        );
      }
    } catch (e: any) {
      console.warn("[sonia] push de aprobación falló:", e?.message ?? e);
    }

    // MEMORIA EPISÓDICA: graba este run como episodio buscable
    // semánticamente desde futuros runs. Falla silencioso si OpenAI
    // no está configurada — la app sigue funcionando sin recall.
    try {
      const { recordEpisode } = await import("@/lib/ai/nv-ia/episodes");
      const task = await prisma.task.findUnique({
        where: { id: run.taskId },
        select: { title: true, client: { select: { name: true } } }
      });
      if (task) {
        await recordEpisode({
          workspaceId: run.workspaceId,
          runId,
          taskTitle: task.title,
          status: result.status,
          summary: result.summary,
          error: result.error,
          clientName: task.client?.name
        });
      }
    } catch (e: any) {
      console.warn(`[sonia] recordEpisode skip: ${e?.message ?? e}`);
    }

    if (run.requesterId) {
      const link = `/tareas?task=${run.taskId}`;
      const body =
        result.status === "SUCCEEDED"
          ? `✅ Sonia terminó: ${result.summary?.slice(0, 140) ?? ""}`
          : result.status === "REQUIRES_HUMAN"
          ? `⚠️ Sonia necesita tu ayuda con una tarea — revisa los comentarios.`
          : `❌ Sonia falló al procesar una tarea: ${result.error?.slice(0, 140) ?? "error desconocido"}`;
      await prisma.notification
        .create({
          data: {
            userId: run.requesterId,
            type: "ai_agent_run",
            body,
            link
          }
        })
        .catch(() => {});
    }

    // AUTO-PROMOCIÓN FAILED → REQUIRES_HUMAN para errores técnicos.
    //
    // Filosofía: Sonia NUNCA debería declararse FAILED sin antes
    // pedirme ayuda a mí (Claude Code). Si el error es técnico (bug
    // del runner, error 4xx/5xx de Anthropic, payload mal formado,
    // tool sin implementar...), no es problema del user — es
    // problema MIO que debo arreglar.
    //
    // Promovemos a REQUIRES_HUMAN + comentario "estoy investigando"
    // para que la UI muestre azul "Claude trabajando" en vez de
    // rojo "Sonia falló". Cuando Claude termine el fix, el endpoint
    // ai-reprocess re-dispara la task automáticamente.
    //
    // Si en cambio el error es de credenciales / config del workspace
    // (token caducado, permiso denegado, integración no configurada),
    // mantenemos FAILED — Claude no puede arreglar eso, el user sí.
    let finalStatus = result.status;
    const errorClass = classifyError(result.error ?? "");
    // Transient (529/503/etc): NO escalamos a Claude. La task queda
    // FAILED y el user puede reintentar manualmente con "Pedir a Sonia"
    // dentro de unos minutos cuando Anthropic respire. Antes
    // escalábamos cualquier "technical" → bucle de issues vacíos en
    // GitHub por cada saturación de Anthropic.
    if (result.status === "FAILED" && errorClass === "technical") {
      finalStatus = "REQUIRES_HUMAN" as any;
      const explainer =
        `❓ Me he topado con un problema técnico y he abierto un issue en GitHub con el contexto entero para que Claude Code lo arregle.\n\n` +
        `**Error:** ${(result.error ?? "(sin detalle)").slice(0, 400)}\n\n` +
        `**Qué hago yo ahora:** nada — la tarea queda parada. Claude Code revisa el issue cuando alguien con acceso al repo le da paso. Cuando el fix esté desplegado, **vuelve a pulsar "Pedir a Sonia"** en esta tarea para relanzarla con el código nuevo. Antes decía "re-procesa automáticamente" pero no es cierto y solo generaba confusión.\n\n` +
        `Si llevas un rato esperando y la situación es bloqueante, pega el texto del error en un mensaje a David y él decide.`;
      try {
        await prisma.aiAgentRun.update({
          where: { id: runId },
          data: { status: finalStatus as any }
        });
        // Comentario informativo firmado por Sonia.
        const ws = await prisma.workspace.findUnique({
          where: { id: run.workspaceId },
          select: { settings: true }
        }).catch(() => null);
        const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
        if (aiUserId) {
          await prisma.comment.create({
            data: {
              workspaceId: run.workspaceId,
              authorId: aiUserId,
              targetType: "TASK",
              targetId: run.taskId,
              body: explainer
            }
          }).catch(() => {});
        }
      } catch (e) {
        console.warn("[sonia] promote FAILED→REQUIRES_HUMAN:", (e as Error).message);
      }
    }

    // AUTO-ESCALACIÓN a Claude Code via GitHub Issue.
    // SOLO para errores técnicos (bugs reales del runner/tools). Los
    // transient (Anthropic 529/503 etc.) NO escalan — solo deja
    // FAILED y comentario explicativo al user. Los credential
    // tampoco — los arregla el user, no Claude.
    if (
      (finalStatus === "FAILED" || finalStatus === "REQUIRES_HUMAN") &&
      errorClass === "technical"
    ) {
      // PRIMERO intentamos auto-fix via agente Claude programático.
      // Si las env GITHUB_SELF_HEAL_* están seteadas, lanzamos la
      // función que lee el código del repo, propone un patch, abre PR
      // y opcionalmente la mergea automáticamente. Sin intervención
      // humana de ningún tipo.
      // Si self-heal no está configurado o falla, caemos al modo
      // anterior (issue manual en GitHub con @claude mention).
      // Self-heal activo si el workspace tiene PAT cifrado en BD
      // (/admin/sonia-self-heal) o si están las env vars de respaldo.
      let hasSelfHeal = false;
      try {
        const { isSelfHealConfigured } = await import("@/lib/github/repo");
        hasSelfHeal = await isSelfHealConfigured(run.workspaceId);
      } catch {}
      if (hasSelfHeal) {
        void (async () => {
          try {
            const { attemptSelfHeal } = await import("@/lib/ai/self-heal/agent");
            const log = Array.isArray(run.log) ? (run.log as any[]) : [];
            const logTail = log
              .slice(-12)
              .map((s: any) => {
                if (s.type === "tool_use")
                  return `→ tool: ${s.tool}(${JSON.stringify(s.input).slice(0, 200)})`;
                if (s.type === "tool_result")
                  return `  result: ${JSON.stringify(s.output).slice(0, 200)}`;
                if (s.type === "text") return `Sonia: ${String(s.text).slice(0, 300)}`;
                if (s.type === "error") return `ERROR: ${s.message}`;
                return `${s.type}`;
              })
              .join("\n");
            const t = await prisma.task.findUnique({
              where: { id: run.taskId },
              select: { title: true, description: true }
            });
            const r = await attemptSelfHeal({
              workspaceId: run.workspaceId,
              runId,
              taskId: run.taskId,
              errorMsg: result.error ?? "(sin detalle)",
              taskTitle: t?.title ?? "",
              taskDescription: t?.description,
              runLogTail: logTail
            });
            if (r.ok) {
              console.log(
                `[self-heal] OK runId=${runId} PR=${r.prUrl} merged=${r.merged} files=${r.filesChanged?.join(",")}`
              );
            } else {
              console.warn(`[self-heal] sin patch runId=${runId}: ${r.error}`);
            }
            // Comentario en la task explicando qué hizo el agente
            const ws = await prisma.workspace.findUnique({
              where: { id: run.workspaceId },
              select: { settings: true }
            });
            const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
            if (aiUserId) {
              let body: string;
              if (r.ok && r.merged) {
                body =
                  `🤖 **Auto-fix aplicado y mergeado a la branch principal.**\n\n` +
                  `PR: ${r.prUrl}\n` +
                  `Archivos cambiados: ${(r.filesChanged ?? []).map((f) => `\`${f}\``).join(", ")}\n\n` +
                  `Cuando Railway termine de deployar (~3-5 min), la tarea se relanzará automáticamente.`;
              } else if (r.ok && !r.merged) {
                body =
                  `🤖 **Auto-fix propuesto, PR abierta (sin auto-merge).**\n\n` +
                  `PR: ${r.prUrl}\n` +
                  `El agente consideró el cambio no trivial y dejó la PR para revisión.\n` +
                  `Tras mergear manual, vuelve a pulsar "Pedir a Sonia".`;
              } else {
                body =
                  `🤖 **Auto-fix intentado pero sin éxito.**\n\n` +
                  `Motivo: ${r.error ?? "(sin detalle)"}\n\n` +
                  (r.agentReasoning
                    ? `**Diagnóstico:**\n>${r.agentReasoning.slice(0, 1200).replace(/\n/g, "\n>")}\n\n`
                    : "") +
                  `Voy a crear el issue de respaldo en GitHub por si quieres mirarlo.`;
              }
              await prisma.comment.create({
                data: {
                  workspaceId: run.workspaceId,
                  authorId: aiUserId,
                  targetType: "TASK",
                  targetId: run.taskId,
                  body
                }
              });
            }
            // Si el self-heal mergea: programa watchdog post-deploy
            // + relanzamiento de la task. El watchdog verifica que el
            // deploy nuevo está vivo y, si peta, hace REVERT del merge
            // para no dejar el sistema roto.
            if (r.ok && r.merged) {
              setTimeout(
                () => {
                  void (async () => {
                    try {
                      // 1. Healthcheck post-deploy TOLERANTE. Durante
                      // incidentes/lentitud de Railway el deploy tarda mucho;
                      // un único check a los 5 min daba falsos "deploy peta".
                      // Sondeamos /api/v1/health cada 45s hasta ~20 min y solo
                      // declaramos fallo si NUNCA respondió 200.
                      const baseUrl =
                        process.env.NEXTAUTH_URL ?? "https://hub.negociovivo.app";
                      let healthOk = false;
                      const deadline = Date.now() + 20 * 60_000;
                      while (Date.now() < deadline) {
                        try {
                          const hr = await fetch(`${baseUrl}/api/v1/health`, {
                            signal: AbortSignal.timeout(10_000)
                          });
                          if (hr.ok) {
                            healthOk = true;
                            break;
                          }
                        } catch (e: any) {
                          // sigue reintentando — puede ser deploy en curso
                        }
                        await new Promise((res) => setTimeout(res, 45_000));
                      }

                      if (!healthOk) {
                        // No respondió en 20 min. Casi siempre es lentitud o
                        // incidente de Railway, NO el fix. Avisamos SUAVE (sin
                        // exigir revert inmediato) y no relanzamos aún.
                        console.warn(`[self-heal watchdog] health sin 200 tras 20min — aviso suave, PR ${r.prUrl}`);
                        try {
                          const ws2 = await prisma.workspace.findUnique({
                            where: { id: run.workspaceId },
                            select: { settings: true }
                          });
                          const aiUserId = (ws2?.settings as any)?.aiAgent?.userId;
                          if (aiUserId) {
                            await prisma.comment.create({
                              data: {
                                workspaceId: run.workspaceId,
                                authorId: aiUserId,
                                targetType: "TASK",
                                targetId: run.taskId,
                                body:
                                  `⏳ **El auto-fix se mergeó pero el deploy aún no responde** (PR ${r.prUrl}).\n\n` +
                                  `He sondeado /api/v1/health durante 20 min sin un 200. Lo más probable es lentitud o un incidente de Railway con la cola de builds, NO que el fix esté mal. ` +
                                  `Comprueba el estado del deploy en Railway antes de revertir nada. Cuando el deploy entre, vuelve a lanzar la tarea.\n\n` +
                                  `_No relanzo automáticamente hasta que el healthcheck pase._`
                              }
                            });
                          }
                        } catch (notifyErr: any) {
                          console.warn(`[self-heal watchdog] aviso crash:`, notifyErr?.message);
                        }
                        return; // no relanzamos hasta que esté sano
                      }

                      // 2. Healthy → relanzamos la task
                      const fresh = await prisma.aiAgentRun.create({
                        data: {
                          workspaceId: run.workspaceId,
                          taskId: run.taskId,
                          status: "PENDING",
                          trigger: "SCHEDULED" as any,
                          triggerContext: `Relanzamiento post auto-fix (PR ${r.prUrl}). Deploy verificado healthy.`
                        }
                      });
                      const { processRunInBackground } = await import("./process-run");
                      processRunInBackground(fresh.id);
                    } catch (e: any) {
                      console.warn(`[self-heal] relanzamiento fallo:`, e?.message);
                    }
                  })();
                },
                90_000
              ).unref?.();
            }
          } catch (e: any) {
            console.warn(`[self-heal] crash runId=${runId}:`, e?.message);
          }
          // Tras self-heal (haya OK o no), seguimos con el escalate a
          // GitHub issue COMO RESPALDO — así queda registro humano
          // independientemente del éxito automático.
          void escalateRunToGitHub(runId).catch(() => {});
        })();
      } else {
        // Self-heal no configurado → solo escalate manual a GitHub.
        void escalateRunToGitHub(runId)
          .then((esc) => {
            if (esc.ok) {
              console.log(`[sonia] escalado run ${runId} → ${esc.issueUrl}`);
            } else if (esc.skipped) {
              console.log(`[sonia] escalación skip: ${esc.reason}`);
            } else {
              console.warn(`[sonia] escalación fallida: ${esc.error}`);
            }
          })
          .catch((e) => console.warn("[sonia] escalateRunToGitHub crash:", e?.message ?? e));
      }
    }

    // Comentario explicativo si es transient AGOTADO (>10 requeues).
    // En el flujo normal el re-queue es automático y silencioso — este
    // bloque solo se ejecuta cuando llevamos 10 reintentos sin éxito,
    // lo que significa que Anthropic lleva >20 min saturado. Ahí sí
    // pedimos al user que reintente manualmente más tarde.
    if (finalStatus === "FAILED" && errorClass === "transient") {
      try {
        const ws = await prisma.workspace.findUnique({
          where: { id: run.workspaceId },
          select: { settings: true }
        }).catch(() => null);
        const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
        if (aiUserId) {
          await prisma.comment.create({
            data: {
              workspaceId: run.workspaceId,
              authorId: aiUserId,
              targetType: "TASK",
              targetId: run.taskId,
              body:
                "⛔ He reintentado 10 veces automáticamente pero Anthropic sigue saturada — lleva más de 20 min sin respirar. " +
                "Vuelve a pulsar **Pedir a Sonia** dentro de un rato (cuando veas que otros runs vuelven a funcionar).\n\n" +
                "Detalle técnico: " +
                (result.error ?? "").slice(0, 200)
            }
          });
        }
      } catch {}
    }

    // MULTI-CANAL: empuja la notif fuera del Hub (WhatsApp/Telegram)
    // según preferencias del requester. La función `notifyHumanOutsideHub`
    // ya filtra por minLevel + horario laboral + canales configurados;
    // si el user no tiene config, hace skip silencioso.
    if (run.requesterId) {
      try {
        const { notifyHumanOutsideHub } = await import(
          "@/lib/notifications/multi-channel"
        );
        const task = await prisma.task.findUnique({
          where: { id: run.taskId },
          select: { title: true }
        });
        const taskTitle = task?.title?.slice(0, 80) ?? "tarea";
        let level: "info" | "warning" | "critical" = "info";
        let title = "Sonia";
        let body = "";
        if (finalStatus === "SUCCEEDED") {
          level = "info";
          title = `Sonia terminó: ${taskTitle}`;
          body = result.summary?.slice(0, 400) ?? "Tarea completada.";
        } else if (finalStatus === "REQUIRES_HUMAN") {
          level = "critical";
          title = `Sonia te necesita: ${taskTitle}`;
          body =
            "Tu intervención es necesaria. Revisa los comentarios de la task en el Hub.";
        } else if (finalStatus === "FAILED") {
          level = "critical";
          title = `Sonia falló: ${taskTitle}`;
          body = (result.error ?? "Error desconocido").slice(0, 400);
        }
        if (body) {
          notifyHumanOutsideHub({
            workspaceId: run.workspaceId,
            userId: run.requesterId,
            level,
            title,
            body,
            linkPath: `/tareas?task=${run.taskId}`
          }).catch((e) =>
            console.warn(`[sonia] notify multi-channel: ${e?.message ?? e}`)
          );
        }
      } catch (e: any) {
        console.warn(`[sonia] notify multi-channel skip: ${e?.message ?? e}`);
      }
    }

    return { runId, status: finalStatus, steps: result.stepsCount };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await prisma.aiAgentRun
      .update({
        where: { id: runId },
        data: { status: "FAILED", error: msg, finishedAt: new Date() }
      })
      .catch(() => {});
    // Igual escalamos cuando el runner explotó por completo (excepción
    // no capturada). Esto suele ser bug del runner, no de la task.
    void escalateRunToGitHub(runId).catch(() => {});
    return { runId, status: "FAILED", error: msg };
  }
}

/**
 * Dispara processOneRun "fire-and-forget". Llamar como `void` desde
 * cualquier handler — el proceso Node sigue corriendo después de
 * devolver la respuesta HTTP (Railway no es serverless).
 *
 * Loguea pero NUNCA tira. Si falla, el cron-watchdog detectará el
 * run quedado en RUNNING/PENDING y lo recogerá.
 */
export function processRunInBackground(runId: string): void {
  void processOneRun(runId).catch(async (e) => {
    // CRÍTICO: si processOneRun lanza una excepción que escapa de
    // su propio try/catch interno (poco frecuente pero pasa: error
    // de import del runner, error al cargar config, etc.), antes
    // solo se logueaba. El run quedaba PENDING para siempre.
    //
    // Ahora marcamos el run como FAILED aquí mismo con el mensaje
    // de error visible. El user verá "Sonia falló" en lugar de
    // "Sonia bloqueada" — diagnosticable.
    const msg = String(e?.message ?? e);
    console.error("[sonia] background processRun fail:", runId, msg);
    try {
      await prisma.aiAgentRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          error: `processRunInBackground crash: ${msg}`,
          finishedAt: new Date()
        }
      });
    } catch (e2) {
      console.error("[sonia] no se pudo marcar FAILED:", e2);
    }
  });
}

/**
 * Clasifica el error de un run para decidir si:
 *   - "credential": el error es de credencial/permiso/config del
 *     workspace. Claude NO puede arreglarlo con código — solo el
 *     user puede dar un token nuevo, configurar la integración,
 *     etc. Mantenemos FAILED para que se vea claro al user.
 *   - "technical": bug del runner, error de API ajena (Anthropic
 *     4xx/5xx, Meta 500), tool sin implementar, payload mal
 *     formado, timeout interno, etc. Lo arreglo yo (Claude) con
 *     código. Promovemos a REQUIRES_HUMAN y escalamos.
 */
function classifyError(errorMsg: string): "credential" | "transient" | "technical" {
  const m = errorMsg.toLowerCase();
  // Errores TRANSIENTES de infra de Anthropic / red. No son bugs nuestros
  // ni del workspace — son momentáneos. Si llegan aquí significa que el
  // retry interno ya falló N veces; el run queda FAILED pero NO escalamos
  // a Claude Code (no hay nada que arreglar). El user puede reintentar
  // manualmente en unos minutos.
  const transientPatterns = [
    "overloaded",
    "529",
    "502",
    "503",
    "504",
    "gateway timeout",
    "service unavailable",
    "etimedout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "fetch failed",
    "network error",
    "anthropic api timeout"
  ];
  for (const p of transientPatterns) {
    if (m.includes(p)) return "transient";
  }
  const credentialPatterns = [
    "session has expired",
    "session is invalid",
    "user logged out",
    "access token",
    "invalid token",
    "token caducado",
    "token inválido",
    "no api key",
    "api key inválida",
    "api key no configurada",
    "permission",
    "permiso",
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "no autorizado",
    "metaconnection caducada",
    "metaconnection no configurada",
    "ai key falta",
    "no hay api key",
    "rate limit",
    "quota exceeded",
    "cuota agotada"
  ];
  for (const p of credentialPatterns) {
    if (m.includes(p)) return "credential";
  }
  return "technical";
}
