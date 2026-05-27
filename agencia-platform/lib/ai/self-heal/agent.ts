/**
 * Agente de auto-fix de Sonia.
 *
 * Cuando Sonia se topa con un error técnico, este módulo spawna un
 * Claude programático (Opus 4.7) con tools de acceso al repo GitHub:
 *
 *   - read_file(path): lee archivo del repo en default branch
 *   - list_dir(path): lista contenidos de carpeta
 *   - search_code(query): grep code search
 *   - propose_patch(files[]): aplica patch creando branch + commits +
 *     abriendo PR (auto-mergea si el agente marca safe=true)
 *
 * El agente:
 *   1. Lee el error + contexto (run.log, task description, comentarios)
 *   2. Localiza los archivos sospechosos (search_code + read_file)
 *   3. Razona qué cambiar
 *   4. Llama propose_patch con los archivos modificados
 *   5. La función devuelve URL del PR para que Sonia lo deje en el
 *      comentario al user — total transparencia
 *
 * Coste: ~$0.5-$2 por fix (10-20 turns de Opus con file reads). Solo
 * se dispara para errores "technical" reales — no transients ni
 * credenciales.
 *
 * Bandera env GITHUB_SELF_HEAL_TOKEN + GITHUB_SELF_HEAL_REPO requeridas.
 * Sin ellas, attemptSelfHeal lanza error y el flow cae al modo
 * "abrir issue manual" de siempre.
 */

import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import {
  readRepoFile,
  listRepoDir,
  searchRepoCode,
  createBranch,
  writeRepoFile,
  openPullRequest,
  mergePullRequest,
  loadRepoConfigForWorkspace,
  getPullRequestChecks
} from "@/lib/github/repo";

/**
 * Espera a que los check runs de la PR terminen y validen verde.
 * Si pasan: mergea. Si fallan: throw (caller deja PR abierta).
 *
 * Estrategia: poll cada 15s hasta 4min total. Si no hay checks en
 * absoluto (repo sin CI configurado), mergea tras 30s de cortesía.
 */
async function waitForChecksAndMerge(
  prNumber: number,
  commitMessage?: string
): Promise<void> {
  const startedAt = Date.now();
  const maxWaitMs = 4 * 60_000;
  const pollIntervalMs = 15_000;
  let firstCheck: Awaited<ReturnType<typeof getPullRequestChecks>> | null = null;

  // Cortesía de 20s para que los webhooks de GH disparen los workflows
  await new Promise((res) => setTimeout(res, 20_000));

  while (Date.now() - startedAt < maxWaitMs) {
    const status = await getPullRequestChecks(prNumber);
    if (!firstCheck) firstCheck = status;

    if (status.failed > 0) {
      throw new Error(
        `CI rojo: ${status.failed}/${status.total} checks fallaron (${status.checks
          .filter((c) => c.conclusion && c.conclusion !== "success")
          .map((c) => `${c.name}=${c.conclusion}`)
          .join(", ")}). PR queda abierta para revisión.`
      );
    }
    if (status.allOk) {
      // Verde — mergeamos
      await mergePullRequest({
        number: prNumber,
        mergeMethod: "squash",
        commitMessage
      });
      return;
    }
    if (status.noChecks && Date.now() - startedAt > 30_000) {
      // No hay CI configurado y han pasado 30s — mergeamos directo
      await mergePullRequest({
        number: prNumber,
        mergeMethod: "squash",
        commitMessage
      });
      return;
    }
    await new Promise((res) => setTimeout(res, pollIntervalMs));
  }
  // Timeout: no se completaron los checks en 4min
  throw new Error(
    `Timeout esperando CI checks (${firstCheck?.pending ?? "?"} pendientes tras 4min). PR queda abierta.`
  );
}

/**
 * Hash corto y estable del mensaje de error — normalizamos IDs,
 * tokens y números para que dos errores "del mismo bug" colisionen
 * aunque varíen request_id o números concretos.
 */
function hashError(msg: string): string {
  const normalized = msg
    .toLowerCase()
    .replace(/req_[a-z0-9]+/g, "req_X")
    .replace(/\b[a-f0-9]{20,}\b/g, "<id>")
    .replace(/\d{4,}/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 12);
}

type SelfHealAttempt = {
  taskId: string;
  errorHash: string;
  prUrl?: string;
  success: boolean;
  ts: number;
};

/**
 * Lee historial de attempts del workspace. Capeado a últimas 200
 * entradas (LRU al escribir).
 */
async function readAttempts(workspaceId: string): Promise<SelfHealAttempt[]> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const arr = (ws?.settings as any)?.aiAgent?.selfHealHistory;
  return Array.isArray(arr) ? (arr as SelfHealAttempt[]) : [];
}

async function appendAttempt(
  workspaceId: string,
  attempt: SelfHealAttempt
): Promise<void> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (!settings.aiAgent) settings.aiAgent = {};
  const arr: SelfHealAttempt[] = Array.isArray(settings.aiAgent.selfHealHistory)
    ? settings.aiAgent.selfHealHistory
    : [];
  arr.push(attempt);
  // Mantener solo los últimos 200 — el JSON de settings no debe crecer
  // sin tope o explota Postgres a la larga.
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  settings.aiAgent.selfHealHistory = arr;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
}

/**
 * Anti-loop: si el mismo (taskId, errorHash) ha tenido >= 3 attempts
 * en últimas 24h, paramos. Sino el bug seguiría agotando presupuesto.
 */
async function isInAntiLoop(
  workspaceId: string,
  taskId: string,
  errorHash: string
): Promise<{ blocked: boolean; recentCount: number }> {
  const history = await readAttempts(workspaceId);
  const dayAgo = Date.now() - 24 * 3600_000;
  const recent = history.filter(
    (a) => a.taskId === taskId && a.errorHash === errorHash && a.ts > dayAgo
  );
  return { blocked: recent.length >= 3, recentCount: recent.length };
}

export type SelfHealResult = {
  ok: boolean;
  prUrl?: string;
  prNumber?: number;
  merged?: boolean;
  branchName?: string;
  filesChanged?: string[];
  agentReasoning?: string;
  error?: string;
};

// Tamaño máximo del content de un read_file que metemos al contexto
// del modelo. Si el archivo es mayor, devolvemos hint para usar
// propose_string_replace (no propose_patch full-file).
const READ_FILE_CAP_BYTES = 80_000;
// Archivos por encima de este número de líneas DEBEN ser editados via
// propose_string_replace (búsqueda + reemplazo de bloque) para evitar
// truncamiento al regenerar el archivo entero. El SYSTEM_PROMPT instruye
// al agente y execTool valida — si intenta propose_patch sobre uno
// grande, lo rechazamos.
const LARGE_FILE_LINES_THRESHOLD = 800;
// En propose_patch full-file, si el contenido propuesto tiene MENOS
// del N% de líneas del original, rechazamos — síntoma típico de
// truncamiento del modelo.
const MIN_LINES_RATIO = 0.7;
// Marcadores tóxicos que delatan un patch truncado o mal generado.
// Si el modelo intentó "reproducir" el contenido y dejó algún
// placeholder o "... (rest of the file)" lo cazamos antes de mergear.
const TOXIC_PATCH_MARKERS = [
  "__placeholder__",
  "PLACEHOLDER_",
  "/* ... rest of",
  "// ... existing",
  "// ... rest of",
  "// TODO: copy the rest",
  "(rest unchanged)",
  "(omitted for brevity)",
  "(truncated)",
  "<UNCHANGED>"
];

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Lee un archivo del repo en su contenido actual (default branch). Devuelve { exists, content, size, sha, totalLines, contentLines, truncated }. truncated=true significa que el archivo es mayor que el cap y ves solo el inicio — para esos archivos NO uses propose_patch (full-file), usa propose_string_replace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relativo desde la raíz del repo, ej. 'agencia-platform/lib/integrations/meta-ads.ts'" }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "list_dir",
    description:
      "Lista contenidos de un directorio del repo. Útil para descubrir estructura. Devuelve array de { path, type, size }.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path del directorio. '' = raíz. Ej. 'agencia-platform/lib/integrations'" }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "search_code",
    description:
      "Búsqueda full-text en el código del repo. Devuelve hasta 30 archivos con matches. Útil para localizar el archivo a partir de un nombre de función, mensaje de error, regex específico, etc. SOLO acepta keywords simples, no regex.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Palabra o frase a buscar en el código." }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "propose_patch",
    description:
      "Aplica el patch FULL-FILE: crea branch nueva, commitea los archivos COMPLETOS, abre PR, auto-mergea si safe=true. Para CADA archivo debes pasar su contenido ENTERO post-fix.\n\n" +
      "⚠️ NO LO USES para archivos grandes (>800 líneas). El modelo PUEDE truncar inadvertidamente. Si read_file devuelve truncated=true o totalLines>800, USA propose_string_replace en su lugar. El sistema rechazará automáticamente patches full-file de archivos grandes si los detecta — perderás el turno.",
    input_schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string", description: "Contenido COMPLETO del archivo después del fix." }
            },
            required: ["path", "content"],
            additionalProperties: false
          }
        },
        commitMessage: { type: "string", description: "Mensaje commit en imperativo, formato 'fix(area): descripcion'." },
        prTitle: { type: "string" },
        prBody: { type: "string", description: "Markdown con: contexto del bug, root cause, qué arregla el patch, cómo verificar." },
        safe: { type: "boolean", description: "Si true, auto-mergea sin esperar checks. Marca false para cambios arriesgados que necesiten revisión humana." }
      },
      required: ["files", "commitMessage", "prTitle", "prBody", "safe"],
      additionalProperties: false
    }
  },
  {
    name: "propose_string_replace",
    description:
      "Aplica el patch en MODO DIFF preciso: en cada archivo busca exactamente `findText` y lo reemplaza por `replaceText`. SEGURO para archivos grandes — no toca el resto del archivo. Es el método PREFERIDO siempre que sepas qué bloque cambiar.\n\n" +
      "Reglas duras:\n" +
      "- `findText` DEBE aparecer EXACTAMENTE UNA VEZ en el archivo. Si aparece 0 o >1 veces, el sistema rechaza el patch. Si dudas, incluye más contexto alrededor.\n" +
      "- `findText` y `replaceText` se comparan/insertan byte-a-byte, incluyendo espacios y saltos de línea. Respeta indentación.\n" +
      "- Puedes encadenar varios replaces sobre el mismo archivo metiendo varios entries con el mismo `path`. Se aplican en orden.\n\n" +
      "Tras aplicar todos los replaces, abre PR y auto-mergea igual que propose_patch si safe=true.",
    input_schema: {
      type: "object",
      properties: {
        replaces: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              findText: {
                type: "string",
                description: "Texto exacto a buscar. Debe ser único en el archivo (incluye varias líneas de contexto si la frase corta aparece más de una vez)."
              },
              replaceText: { type: "string", description: "Texto que sustituye a findText. Puede estar vacío para borrar." }
            },
            required: ["path", "findText", "replaceText"],
            additionalProperties: false
          }
        },
        commitMessage: { type: "string" },
        prTitle: { type: "string" },
        prBody: { type: "string" },
        safe: { type: "boolean" }
      },
      required: ["replaces", "commitMessage", "prTitle", "prBody", "safe"],
      additionalProperties: false
    }
  }
];

const SYSTEM_PROMPT = `Eres un agente de auto-fix para una plataforma SaaS multi-tenant en TypeScript (Next.js 14 + Prisma + Postgres en Railway). Hay un agente "Sonia" que procesa tareas con Anthropic API y se ha topado con un bug REAL del código que la bloquea.

TU MISIÓN: leer el error + contexto, investigar el código del repo (tools read_file/list_dir/search_code), y proponer un patch CONCRETO.

REGLAS:

1. Lee primero. NUNCA propongas un patch sin haber leído al menos el archivo donde está el bug y el código que lo invoca. Usa search_code para localizar.

2. Cambios mínimos. Toca SOLO lo necesario para arreglar el bug. No refactorices, no añadas features, no "limpies".

3. Mantén comportamiento. Si el bug está en una función con N argumentos, no cambies su firma a menos que sea esencial. Otros llamadores podrían romperse.

4. **ELECCIÓN DE TOOL DE PATCH — CRÍTICO**:

   - Para archivos PEQUEÑOS (≤800 líneas, read_file devolvió truncated=false):
     puedes usar propose_patch (full-file) o propose_string_replace.
     propose_string_replace es PREFERIBLE — más seguro.

   - Para archivos GRANDES (>800 líneas o read_file truncated=true):
     OBLIGATORIO usar propose_string_replace. El sistema RECHAZA
     propose_patch sobre archivos grandes — desperdiciarías el turno.

   Esta regla existe porque un agente anterior destruyó el SYSTEM_PROMPT
   de Sonia al intentar regenerar un archivo de 1300 líneas vía
   propose_patch — el modelo solo vio el inicio y dejó placeholders
   en el resto. propose_string_replace es inmune: cambia exactamente
   el bloque que indicas, sin tocar nada más.

5. NUNCA pongas en el contenido marcadores tipo:
   - "__PLACEHOLDER__", "PLACEHOLDER_*"
   - "// ... rest of the file", "// ... existing code"
   - "(rest unchanged)", "(omitted for brevity)", "(truncated)"
   El sistema rechazará el patch automáticamente.

6. propose_string_replace: cada findText DEBE aparecer EXACTAMENTE
   UNA VEZ en el archivo. Si dudas, incluye 2-3 líneas de contexto
   alrededor del cambio para que sea único.

7. Commit message: 'fix(area): descripcion breve'. Cuerpo del PR:
   contexto del bug, root cause, qué arregla, cómo verificar.

8. safe=true SOLO si el fix es trivial y aislado (cambio de 1-3 líneas
   con propose_string_replace bien acotado). Cambios mayores → safe=false
   (humano revisa).

9. Si tras investigar no ves cómo arreglarlo, NO propongas patch —
   termina explicando qué te falta saber.

10. Si el error es de configuración del workspace (token faltante,
    integración no setup) — NO es bug de código. NO patches.

PRESUPUESTO: máximo 14 tool calls. Si llegas a 12 sin patch, prioriza
proponer con tu mejor entendimiento.

El repo tiene este layout:
- agencia-platform/app/api/v1/...     ← endpoints Next.js
- agencia-platform/lib/ai/nv-ia/...   ← runner y tools de Sonia
- agencia-platform/lib/integrations/  ← clientes API externos (meta-ads, google-ads, etc)
- agencia-platform/prisma/schema.prisma
- agencia-platform/components/        ← React

Empieza listando o buscando hasta entender DÓNDE está el bug. Sé conciso.`;

export async function attemptSelfHeal(opts: {
  workspaceId: string;
  runId: string;
  taskId?: string;
  errorMsg: string;
  taskTitle: string;
  taskDescription?: string | null;
  runLogTail?: string;
}): Promise<SelfHealResult> {
  // Pre-flight: verifica config (DB workspace primero, env fallback).
  // Cachea la config para que las llamadas a readRepoFile/etc dentro
  // del agente usen la misma sin re-resolver.
  try {
    await loadRepoConfigForWorkspace(opts.workspaceId);
  } catch (e: any) {
    return { ok: false, error: `Self-heal no configurado: ${e?.message}` };
  }

  // Anti-loop: si el mismo error en la misma task ya tuvo 3+ attempts
  // en las últimas 24h, paramos. Evita drenar presupuesto en un bug
  // que el agente claramente no está resolviendo.
  const errorHash = hashError(opts.errorMsg);
  const taskId = opts.taskId ?? "";
  if (taskId) {
    const loop = await isInAntiLoop(opts.workspaceId, taskId, errorHash);
    if (loop.blocked) {
      return {
        ok: false,
        error: `Anti-loop activado: ya ha habido ${loop.recentCount} intentos de self-heal en 24h con este mismo error en esta task. Necesita revisión humana — el agente no consigue arreglarlo solo.`
      };
    }
  }

  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `Sonia se ha topado con este error y no puede continuar:\n\n` +
            `**Task:** ${opts.taskTitle}\n` +
            (opts.taskDescription ? `**Descripción:** ${opts.taskDescription.slice(0, 600)}\n\n` : "\n") +
            `**Error:**\n\`\`\`\n${opts.errorMsg.slice(0, 2000)}\n\`\`\`\n\n` +
            (opts.runLogTail
              ? `**Últimos pasos del run:**\n\`\`\`\n${opts.runLogTail.slice(0, 2000)}\n\`\`\`\n\n`
              : "") +
            `Investiga el código, encuentra el bug, y propone el patch. Si no puedes localizar el bug, di qué te falta saber.`
        }
      ]
    }
  ];

  const reasoning: string[] = [];
  let result: SelfHealResult | null = null;
  const maxTurns = 14;

  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages
    });

    // Guarda texto del agente para devolverlo como audit log
    for (const block of resp.content) {
      if (block.type === "text") {
        reasoning.push(block.text);
      }
    }

    if (resp.stop_reason === "end_turn" && !resp.content.some((b) => b.type === "tool_use")) {
      // Agente acabó sin proponer patch
      return {
        ok: false,
        error: "El agente no propuso patch tras investigar.",
        agentReasoning: reasoning.join("\n\n")
      };
    }

    // Push assistant response
    messages.push({ role: "assistant", content: resp.content as any });

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const out = await execTool(tu.name, tu.input as any, opts);
        if (out.terminal) {
          result = out.result!;
          // Inyectamos el tool_result para cerrar la conversación.
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({ ok: true, prUrl: result.prUrl, merged: result.merged })
          });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(out.data).slice(0, 100_000)
          });
        }
      } catch (e: any) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error: e?.message ?? String(e) }),
          is_error: true
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
    if (result) break;
  }

  // Registrar el attempt (haya tenido patch o no) para el anti-loop.
  // Lo hacemos antes del return para que counts y caps queden consistentes.
  if (taskId) {
    try {
      await appendAttempt(opts.workspaceId, {
        taskId,
        errorHash,
        prUrl: result?.prUrl,
        success: !!result?.ok,
        ts: Date.now()
      });
    } catch (e: any) {
      console.warn("[self-heal] no se pudo registrar attempt:", e?.message);
    }
  }

  if (result) {
    result.agentReasoning = reasoning.join("\n\n").slice(0, 4000);
    return result;
  }
  return {
    ok: false,
    error: "Se alcanzó el límite de turnos sin parche.",
    agentReasoning: reasoning.join("\n\n").slice(0, 4000)
  };
}

/** True si el contenido huele a patch truncado (tiene marcadores tóxicos). */
function detectsToxicMarkers(content: string): string | null {
  const lower = content.toLowerCase();
  for (const m of TOXIC_PATCH_MARKERS) {
    if (lower.includes(m.toLowerCase())) return m;
  }
  return null;
}

function countLines(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

async function execTool(
  name: string,
  input: any,
  opts: { runId: string; errorMsg: string }
): Promise<{ terminal: boolean; data?: any; result?: SelfHealResult }> {
  if (name === "read_file") {
    const f = await readRepoFile(String(input.path));
    if (!f) return { terminal: false, data: { exists: false } };
    const totalLines = countLines(f.content);
    const truncated = f.content.length > READ_FILE_CAP_BYTES;
    const cappedContent = truncated
      ? f.content.slice(0, READ_FILE_CAP_BYTES)
      : f.content;
    const contentLines = countLines(cappedContent);
    return {
      terminal: false,
      data: {
        exists: true,
        content: cappedContent,
        size: f.size,
        sha: f.sha,
        totalLines,
        contentLines,
        truncated,
        // Hint explícito al modelo si el archivo es grande
        warning:
          totalLines > LARGE_FILE_LINES_THRESHOLD
            ? `Archivo grande (${totalLines} líneas). NO uses propose_patch — usa propose_string_replace para evitar truncamiento.`
            : truncated
              ? `Contenido truncado a ${READ_FILE_CAP_BYTES} bytes — usa propose_string_replace con el bloque exacto a cambiar.`
              : undefined
      }
    };
  }
  if (name === "list_dir") {
    const items = await listRepoDir(String(input.path));
    return { terminal: false, data: { items: items.slice(0, 100) } };
  }
  if (name === "search_code") {
    const hits = await searchRepoCode(String(input.query));
    return { terminal: false, data: { hits: hits.slice(0, 30) } };
  }

  if (name === "propose_patch") {
    const files = input.files as Array<{ path: string; content: string }>;
    if (!Array.isArray(files) || files.length === 0) {
      return { terminal: false, data: { error: "files vacío" } };
    }

    // VALIDACIONES PREVIAS — si alguna falla, rechazamos sin tocar el repo.
    for (const f of files) {
      // 1. Detectar marcadores tóxicos en el contenido propuesto
      const toxic = detectsToxicMarkers(f.content);
      if (toxic) {
        return {
          terminal: false,
          data: {
            error: `Patch rechazado: contiene marcador tóxico "${toxic}" en ${f.path}. Esto delata un patch truncado/incompleto. Usa propose_string_replace para cambios precisos sin regenerar el archivo entero.`
          }
        };
      }
      // 2. Comparar tamaño contra el archivo original
      const existing = await readRepoFile(f.path);
      if (existing) {
        const origLines = countLines(existing.content);
        const newLines = countLines(f.content);
        // Para archivos grandes, propose_patch directamente está prohibido
        if (origLines > LARGE_FILE_LINES_THRESHOLD) {
          return {
            terminal: false,
            data: {
              error: `Patch rechazado: ${f.path} tiene ${origLines} líneas (>${LARGE_FILE_LINES_THRESHOLD}). El sistema NO permite propose_patch full-file en archivos grandes — alto riesgo de truncamiento. Usa propose_string_replace con el bloque exacto a cambiar.`
            }
          };
        }
        // Para archivos normales, validar ratio de líneas
        if (newLines < origLines * MIN_LINES_RATIO) {
          const pct = Math.round((newLines / origLines) * 100);
          return {
            terminal: false,
            data: {
              error: `Patch rechazado: ${f.path} pasaría de ${origLines} → ${newLines} líneas (${pct}%, mínimo ${Math.round(MIN_LINES_RATIO * 100)}%). Esto delata truncamiento. Si el cambio realmente borra mucho código, justifícalo en propose_patch.prBody y usa propose_string_replace para verificarlo paso a paso.`
            }
          };
        }
      }
    }

    // OK — proceder con el patch
    const branchName = `claude/self-heal-${opts.runId}-${Date.now().toString(36)}`;
    await createBranch(branchName);
    const filesChanged: string[] = [];
    for (const f of files) {
      const existing = await readRepoFile(f.path);
      await writeRepoFile({
        path: f.path,
        content: f.content,
        message: input.commitMessage || `fix: self-heal ${opts.runId}`,
        branch: branchName,
        sha: existing?.sha
      });
      filesChanged.push(f.path);
    }
    return finalizePatchPR({
      runId: opts.runId,
      branchName,
      filesChanged,
      input,
      errorMsg: opts.errorMsg
    });
  }

  if (name === "propose_string_replace") {
    const replaces = input.replaces as Array<{
      path: string;
      findText: string;
      replaceText: string;
    }>;
    if (!Array.isArray(replaces) || replaces.length === 0) {
      return { terminal: false, data: { error: "replaces vacío" } };
    }

    // Validar marcadores tóxicos en los replaceText
    for (const r of replaces) {
      const toxic = detectsToxicMarkers(r.replaceText);
      if (toxic) {
        return {
          terminal: false,
          data: {
            error: `Patch rechazado: replaceText para ${r.path} contiene marcador tóxico "${toxic}". Escribe el código real, no placeholders.`
          }
        };
      }
    }

    // Agrupar por path y aplicar replaces en memoria. Validar
    // unicidad de findText antes de tocar el repo.
    const byPath = new Map<string, { sha: string; content: string }>();
    for (const r of replaces) {
      const existing =
        byPath.get(r.path) ??
        (await (async () => {
          const f = await readRepoFile(r.path);
          if (!f) {
            return null;
          }
          return { sha: f.sha, content: f.content };
        })());
      if (!existing) {
        return {
          terminal: false,
          data: { error: `Archivo no existe: ${r.path}` }
        };
      }
      const occurrences = existing.content.split(r.findText).length - 1;
      if (occurrences === 0) {
        return {
          terminal: false,
          data: {
            error: `findText NO encontrado en ${r.path}. Verifica que el texto coincide byte a byte (espacios, saltos de línea, indentación) con el archivo actual.`
          }
        };
      }
      if (occurrences > 1) {
        return {
          terminal: false,
          data: {
            error: `findText aparece ${occurrences} veces en ${r.path} — debe ser único. Añade más contexto al findText (2-3 líneas alrededor) para que solo matchee tu bloque.`
          }
        };
      }
      existing.content = existing.content.replace(r.findText, r.replaceText);
      byPath.set(r.path, existing);
    }

    // Aplicar
    const branchName = `claude/self-heal-${opts.runId}-${Date.now().toString(36)}`;
    await createBranch(branchName);
    const filesChanged: string[] = [];
    for (const [path, { sha, content }] of byPath) {
      await writeRepoFile({
        path,
        content,
        message: input.commitMessage || `fix: self-heal ${opts.runId}`,
        branch: branchName,
        sha
      });
      filesChanged.push(path);
    }
    return finalizePatchPR({
      runId: opts.runId,
      branchName,
      filesChanged,
      input,
      errorMsg: opts.errorMsg
    });
  }

  throw new Error(`Tool desconocida: ${name}`);
}

/** Cierra el flow: abre PR + intenta auto-merge si safe=true. */
async function finalizePatchPR(opts: {
  runId: string;
  branchName: string;
  filesChanged: string[];
  input: any;
  errorMsg: string;
}): Promise<{ terminal: true; result: SelfHealResult }> {
  const pr = await openPullRequest({
    branch: opts.branchName,
    title: opts.input.prTitle || `Self-heal Sonia run ${opts.runId}`,
    body:
      (opts.input.prBody || "Auto-fix por Claude") +
      `\n\n---\n_Generado automáticamente por el agente self-heal para el run ${opts.runId}._\n\n**Error original:**\n\`\`\`\n${opts.errorMsg.slice(0, 1500)}\n\`\`\``
  });

  let merged = false;
  if (opts.input.safe === true && opts.filesChanged.length <= 5) {
    try {
      await waitForChecksAndMerge(pr.number, opts.input.commitMessage);
      merged = true;
    } catch (e: any) {
      console.warn(`[self-heal] auto-merge falló, PR queda abierta: ${e?.message}`);
    }
  }

  return {
    terminal: true,
    result: {
      ok: true,
      prUrl: pr.url,
      prNumber: pr.number,
      merged,
      branchName: opts.branchName,
      filesChanged: opts.filesChanged
    }
  };
}
