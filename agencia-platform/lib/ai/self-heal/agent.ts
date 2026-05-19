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
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import {
  readRepoFile,
  listRepoDir,
  searchRepoCode,
  createBranch,
  writeRepoFile,
  openPullRequest,
  mergePullRequest,
  loadRepoConfigForWorkspace
} from "@/lib/github/repo";

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

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Lee un archivo del repo en su contenido actual (default branch). Devuelve content + sha. Si el archivo no existe, devuelve null. Úsalo para investigar el código antes de proponer un patch.",
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
      "Aplica el patch propuesto: crea una branch nueva, commitea los archivos cambiados, abre PR, y auto-mergea si safe=true. ÚSALO COMO ÚLTIMO PASO, cuando ya hayas leído lo necesario y estés seguro del cambio. Asegúrate de que CADA archivo cambiado tiene su contenido COMPLETO post-fix (no diffs parciales). Si el cambio toca una sola línea, igual mandas el archivo entero con el cambio incorporado.",
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
  }
];

const SYSTEM_PROMPT = `Eres un agente de auto-fix para una plataforma SaaS multi-tenant en TypeScript (Next.js 14 + Prisma + Postgres en Railway). Hay un agente "Sonia" que procesa tareas con Anthropic API y se ha topado con un bug REAL del código que la bloquea.

TU MISIÓN: leer el error + contexto, investigar el código del repo (tools read_file/list_dir/search_code), y proponer un patch CONCRETO via propose_patch.

REGLAS:

1. Lee primero. NUNCA propongas un patch sin haber leído al menos el archivo donde está el bug y el código que lo invoca. Usa search_code para localizar.

2. Cambios mínimos. Toca SOLO lo necesario para arreglar el bug. No refactorices, no añadas features, no "limpies".

3. Mantén comportamiento. Si el bug está en una función con N argumentos, no cambies su firma a menos que sea esencial. Otros llamadores podrían romperse.

4. El contenido va COMPLETO. propose_patch.files[].content debe ser el archivo ENTERO post-fix, no un diff. Si dudas, lee el archivo, edita mentalmente, y manda la versión nueva entera.

5. Commit message: 'fix(area): descripcion breve'. Cuerpo del PR: contexto del bug, root cause, qué arregla, cómo verificar.

6. safe=true SOLO si el fix es trivial y aislado (cambio de 1-3 líneas, sin tocar lógica compleja). Cambios mayores → safe=false (humano revisa).

7. Si tras investigar no ves cómo arreglarlo, NO llames propose_patch — termina explicando qué te falta saber.

8. Si el error es de configuración del workspace (token faltante, integración no setup) — NO es bug de código. NO patches.

PRESUPUESTO: máximo 12 tool calls. Si llegas a 10 sin patch, prioriza ir a propose_patch con tu mejor entendimiento.

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

async function execTool(
  name: string,
  input: any,
  opts: { runId: string; errorMsg: string }
): Promise<{ terminal: boolean; data?: any; result?: SelfHealResult }> {
  if (name === "read_file") {
    const f = await readRepoFile(String(input.path));
    if (!f) return { terminal: false, data: { exists: false } };
    // Cap a 80KB de contenido para no inflar contexto
    return {
      terminal: false,
      data: { exists: true, content: f.content.slice(0, 80_000), size: f.size, sha: f.sha }
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

    const pr = await openPullRequest({
      branch: branchName,
      title: input.prTitle || `Self-heal Sonia run ${opts.runId}`,
      body:
        (input.prBody || "Auto-fix por Claude") +
        `\n\n---\n_Generado automáticamente por el agente self-heal para el run ${opts.runId}._\n\n**Error original:**\n\`\`\`\n${opts.errorMsg.slice(0, 1500)}\n\`\`\``
    });

    let merged = false;
    if (input.safe === true && filesChanged.length <= 5) {
      try {
        const m = await mergePullRequest({
          number: pr.number,
          mergeMethod: "squash",
          commitMessage: input.commitMessage
        });
        merged = m.merged;
      } catch (e: any) {
        // Si el auto-merge falla (checks rojo, conflicto, etc.) dejamos
        // la PR abierta para revisión humana — no es fatal.
        console.warn(`[self-heal] auto-merge fallo, PR queda abierta: ${e?.message}`);
      }
    }

    return {
      terminal: true,
      result: {
        ok: true,
        prUrl: pr.url,
        prNumber: pr.number,
        merged,
        branchName,
        filesChanged
      }
    };
  }
  throw new Error(`Tool desconocida: ${name}`);
}
