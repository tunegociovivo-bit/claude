/**
 * Escalación automática de Sonia a Claude Code (este chat).
 *
 * Cuando un AiAgentRun termina en FAILED o REQUIRES_HUMAN,
 * abrimos un issue de GitHub con TODO el contexto (task, error,
 * últimos pasos del log, tools usadas, sugerencias de qué mejorar).
 *
 * En la siguiente sesión de Claude Code el user puede decir
 * "mira la última escalación de Sonia" y Claude leerá el issue,
 * investigará, propondrá una mejora y commiteará el fix. Así
 * Sonia aprende con cada bloqueo sin tener que abrir tickets
 * manualmente.
 *
 * Config (env vars):
 *   - SONIA_ESCALATION_REPO  → "owner/repo" (ej "tunegociovivo-bit/claude")
 *   - SONIA_ESCALATION_LABEL → label a añadir (default "sonia-escalation")
 *   - GITHUB_TOKEN           → PAT con scope `repo` (o `public_repo`)
 *
 * Si falta cualquiera, la escalación se omite silenciosamente y
 * solo logueamos a consola. NO bloquea el flujo del run.
 */

import { prisma } from "@/lib/db/prisma";
import type { AgentLogStep } from "./types";

const GITHUB_API = "https://api.github.com";

export type EscalationResult = {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  error?: string;
  skipped?: boolean;
  reason?: string;
};

/**
 * Construye el cuerpo del issue (Markdown) a partir de un run.
 * Aislado del fetch para que sea testeable y reusable (ej para
 * mostrar en UI sin abrir el issue).
 */
export function buildEscalationBody(opts: {
  runId: string;
  status: string;
  taskId: string;
  taskTitle: string;
  taskUrl: string;
  adminRunUrl: string;
  error: string | null;
  summary: string | null;
  stepsCount: number;
  inputTokens: number;
  outputTokens: number;
  log: AgentLogStep[];
  taskDescription?: string | null;
  comments?: Array<{ author: string; body: string; createdAt: string }>;
}): string {
  // Filtramos el log a los pasos relevantes para diagnóstico.
  // - Las últimas N=10 entradas
  // - Los tool_use con su input (sin tokens si los hay)
  // - Los tool_result con isError=true (interesantes para debug)
  const recent = opts.log.slice(-10);
  const toolsUsed = Array.from(
    new Set(
      opts.log
        .filter((s) => s.type === "tool_use")
        .map((s) => (s as any).tool as string)
    )
  );
  const errorResults = opts.log.filter(
    (s) => s.type === "tool_result" && (s as any).isError
  );

  const logSection = recent
    .map((step) => {
      const ts = step.ts.split("T")[1]?.slice(0, 8) ?? "";
      if (step.type === "tool_use") {
        const t = step as any;
        const input = redact(JSON.stringify(t.input ?? {}).slice(0, 300));
        return `- \`${ts}\` **tool_use** \`${t.tool}\` → \`${input}\``;
      }
      if (step.type === "tool_result") {
        const r = step as any;
        const out = redact(
          typeof r.output === "string"
            ? r.output.slice(0, 300)
            : JSON.stringify(r.output ?? {}).slice(0, 300)
        );
        const flag = r.isError ? "❌ ERROR" : "✓";
        return `- \`${ts}\` **tool_result** ${flag} → \`${out}\``;
      }
      if (step.type === "text") {
        return `- \`${ts}\` **text** → ${redact((step as any).text).slice(0, 400)}`;
      }
      if (step.type === "error") {
        return `- \`${ts}\` **error** → ${redact((step as any).message).slice(0, 400)}`;
      }
      if (step.type === "stop") {
        const s = step as any;
        return `- \`${ts}\` **stop** (${s.reason}) ${s.summary ? "→ " + redact(s.summary).slice(0, 400) : ""}`;
      }
      return `- \`${ts}\` ${step.type}`;
    })
    .join("\n");

  const errorSection = errorResults.length
    ? errorResults
        .slice(-5)
        .map((r) => {
          const out =
            typeof (r as any).output === "string"
              ? (r as any).output
              : JSON.stringify((r as any).output ?? {});
          return `- \`${(r as any).toolUseId}\`: ${redact(out).slice(0, 300)}`;
        })
        .join("\n")
    : "_(ninguno — el fallo fue alto-nivel, no de una tool concreta)_";

  const commentsSection = opts.comments?.length
    ? opts.comments
        .slice(-5)
        .map(
          (c) =>
            `- **${c.author}** _(${c.createdAt.slice(0, 16).replace("T", " ")})_: ${redact(c.body).slice(0, 200)}`
        )
        .join("\n")
    : "_(sin comentarios)_";

  return `@claude **Sonia se ha bloqueado y necesita que mejores su código para que no le vuelva a pasar.**

## Tu tarea (autónoma, sin esperar al user)

1. **Lee** esta escalación entera. Tienes todo el contexto abajo.
2. **Investiga** la raíz del bloqueo en el código (\`lib/ai/nv-ia/\`, \`lib/integrations/\`, el SYSTEM_PROMPT del runner, las tools afectadas).
3. **Implementa** la mejora (más aliases, mejor mensaje de error, instrucción nueva en el prompt, tool nueva, fuzzy matching, etc.).
4. **Commit + push** en la branch del proyecto. Mensaje convencional explicando qué aprendiste y qué arreglaste.
5. **Re-dispara la task** ejecutando (esperando ~60s tras el push para que Railway despliegue):
   \`\`\`bash
   sleep 90 && curl -sX POST -H "Authorization: Bearer $SONIA_REPROCESS_TOKEN" \\
     https://hub.negociovivo.app/api/v1/tasks/${opts.taskId}/ai-process?inline=0
   \`\`\`
6. **Cierra este issue** con un comentario resumiendo el fix.

Si tras tu fix Sonia vuelve a escalar la misma task, **NO bucles** — comenta aquí qué intentaste y por qué crees que requiere intervención humana real, y deja el issue abierto.

---

## Contexto del fallo

**Run ID**: \`${opts.runId}\`
**Estado**: ${opts.status === "FAILED" ? "❌ FAILED" : "⚠️ REQUIRES_HUMAN"}
**Tarea**: ${opts.taskTitle} ([abrir en Hub](${opts.taskUrl}))
**Run admin**: ${opts.adminRunUrl}
**Pasos ejecutados**: ${opts.stepsCount} / max
**Tokens**: ${opts.inputTokens} in / ${opts.outputTokens} out

### Resumen / error
${opts.error ? "**Error**: " + redact(opts.error) : ""}
${opts.summary ? "\n**Summary**: " + redact(opts.summary) : ""}

### Descripción de la tarea (donde el user explica lo que quiere)
\`\`\`
${redact(opts.taskDescription || "(vacía)").slice(0, 1500)}
\`\`\`

### Últimos comentarios
${commentsSection}

### Tools usadas en el run
${toolsUsed.length ? toolsUsed.map((t) => `- \`${t}\``).join("\n") : "_(ninguna — Sonia ni siquiera intentó usar tools — probablemente fallo del SYSTEM_PROMPT o de la primera lectura de contexto)_"}

### Errores devueltos por las tools
${errorSection}

### Últimos 10 pasos del log
${logSection || "_(log vacío — Sonia no llegó a ejecutar pasos)_"}

---

## Pistas habituales para diagnosticar

- **"el token está caducado, hay que reconectar"** → casi siempre es porque el extractor de credenciales (\`lib/ai/nv-ia/adhoc-credentials.ts\`) no detectó el token pegado en la task. Mira si el user escribió una variante de label que no estaba en \`KEY_ALIASES\`, o si el token está en una URL / formato suelto y hace falta una regla más en \`detectByValue\`.
- **Sonia no llamó ninguna tool** → el SYSTEM_PROMPT (en \`lib/ai/nv-ia/runner.ts\`) puede estar diciéndole "rinde fácil" en vez de "intenta primero". Refuerza con instrucción específica.
- **Sonia rebotó sin entender la tarea** → revisa \`buildInitialMessage()\` para el trigger que disparó este run.
- **Una tool devolvió error críptico** → el mensaje de error de la integración (\`lib/integrations/*.ts\`) puede ser opaco; mejóralo para que el siguiente run sepa qué hacer.

<sub>Issue creado automáticamente por el sistema de escalación de Sonia.</sub>
`;
}

/** Redacta tokens largos en logs/issue para no filtrarlos en GitHub. */
function redact(text: string): string {
  if (!text) return text;
  // Tokens Meta
  let out = text.replace(/EAA[A-Za-z0-9_-]{30,}/g, "EAA***REDACTED***");
  // Stripe
  out = out.replace(/sk_(live|test)_[A-Za-z0-9]{20,}/g, "sk_$1_***REDACTED***");
  // Resend
  out = out.replace(/re_[A-Za-z0-9_-]{20,}/g, "re_***REDACTED***");
  // Bearer headers
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, "Bearer ***REDACTED***");
  return out;
}

/**
 * Abre un issue en GitHub con la escalación. Idempotente por runId:
 * busca primero si ya existe un issue para ese run, y devuelve la
 * URL existente en vez de duplicar.
 */
export async function escalateRunToGitHub(runId: string): Promise<EscalationResult> {
  const repo = process.env.SONIA_ESCALATION_REPO;
  const token = process.env.GITHUB_TOKEN;
  const label = process.env.SONIA_ESCALATION_LABEL || "sonia-escalation";

  if (!repo) return { ok: false, skipped: true, reason: "SONIA_ESCALATION_REPO no configurado" };
  if (!token) return { ok: false, skipped: true, reason: "GITHUB_TOKEN no configurado" };

  const run = await prisma.aiAgentRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, error: "run no encontrado" };

  // Anti-loop: si esta task ya falló >=3 veces en la última hora,
  // NO escalamos otra vez — probablemente no es un bug del código
  // de Sonia sino un problema real (credencial inválida, API caída,
  // tarea ambigua) que necesita humano. Evita que Claude entre en
  // bucle de "arreglar → re-disparar → vuelve a fallar → arreglar".
  const recentFails = await prisma.aiAgentRun.count({
    where: {
      taskId: run.taskId,
      status: { in: ["FAILED", "REQUIRES_HUMAN"] },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
    }
  });
  if (recentFails >= 3) {
    return {
      ok: false,
      skipped: true,
      reason: `anti-loop: ${recentFails} fallos de esta task en la última hora`
    };
  }

  const task = await prisma.task.findUnique({
    where: { id: run.taskId },
    select: { title: true, description: true }
  });
  const comments = await prisma.comment.findMany({
    where: {
      workspaceId: run.workspaceId,
      targetType: "TASK",
      targetId: run.taskId
    },
    include: { author: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" }
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hub.negociovivo.app";
  const body = buildEscalationBody({
    runId: run.id,
    status: run.status,
    taskId: run.taskId,
    taskTitle: task?.title || "(sin título)",
    taskUrl: `${baseUrl}/tareas?task=${run.taskId}`,
    adminRunUrl: `${baseUrl}/admin/nv-ia#run-${run.id}`,
    error: run.error,
    summary: run.summary,
    stepsCount: run.stepsCount,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    log: (run.log as any) ?? [],
    taskDescription: task?.description,
    comments: comments.map((c) => ({
      author: c.author?.name || c.author?.email || "(anónimo)",
      body: c.body,
      createdAt: c.createdAt.toISOString()
    }))
  });

  const title = `[sonia-escalation] ${task?.title?.slice(0, 100) ?? "task"} (run ${run.id.slice(0, 8)})`;

  // Idempotencia: busca issues existentes con el runId en el título o body.
  // Es barato (un solo search) y evita duplicados si el cron-watchdog
  // re-marca el mismo run.
  try {
    const searchUrl = `${GITHUB_API}/search/issues?q=${encodeURIComponent(`repo:${repo} ${run.id} in:title,body type:issue`)}`;
    const sr = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (sr.ok) {
      const sdata = await sr.json();
      const existing = (sdata.items ?? []).find((i: any) =>
        (i.title || "").includes(run.id.slice(0, 8))
      );
      if (existing) {
        return { ok: true, issueUrl: existing.html_url, issueNumber: existing.number };
      }
    }
  } catch {
    // Si falla la búsqueda, seguimos con el create — peor caso duplicado.
  }

  const r = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title,
      body,
      labels: [label, run.status === "FAILED" ? "bug" : "needs-human"]
    })
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `GitHub ${r.status}: ${t.slice(0, 300)}` };
  }
  const issue = await r.json();
  return { ok: true, issueUrl: issue.html_url, issueNumber: issue.number };
}
