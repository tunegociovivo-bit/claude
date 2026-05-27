/**
 * Memoria episódica vectorizada para Sonia.
 *
 * Después de cada run finalizado guardamos un "episodio": qué task era,
 * qué pasó (éxito/fallo), un resumen ejecutivo, y un embedding del texto
 * para recuperación por similitud.
 *
 * Al arrancar un nuevo run, buscamos episodios pasados similares y los
 * inyectamos al system prompt. Sirve para:
 *  - No repetir errores ya cometidos (ej: 2446433 en Lead Ads creative)
 *  - Aprender patrones de éxito (ej: "para RS Advocats Despidos usé esta segmentación")
 *  - Mantener consistencia entre runs del mismo cliente
 *
 * Storage: reutilizamos `SearchEmbedding` con `entityType = "AI_RUN"`.
 * Sin nueva migración Prisma — la columna es String y nada nos obliga
 * a respetar el set TASK|CLIENT|...
 *
 * Embedding: OpenAI text-embedding-3-small (mismo que SearchEmbedding).
 * Si el workspace no tiene OpenAI configurado, se omite silenciosamente.
 *
 * Persistencia del "qué pasó": el embedding va en SearchEmbedding,
 * los datos legibles van en SearchEmbedding.text como JSON serializado
 * para no añadir tabla. Formato:
 *   text = JSON.stringify({ taskTitle, status, summary, clientName? })
 */

import { prisma } from "@/lib/db/prisma";
import { generateEmbedding, EMBEDDING_MODEL, EMBEDDING_DIMS } from "@/lib/search/embeddings";

const EPISODE_ENTITY = "AI_RUN";

type EpisodePayload = {
  taskTitle: string;
  status: string;
  summary: string;
  clientName?: string;
};

export async function recordEpisode(opts: {
  workspaceId: string;
  runId: string;
  taskTitle: string;
  status: string;
  summary: string | null;
  error: string | null;
  clientName?: string;
}): Promise<{ recorded: boolean }> {
  const payload: EpisodePayload = {
    taskTitle: opts.taskTitle,
    status: opts.status,
    summary: (opts.summary ?? opts.error ?? "(sin resumen)").slice(0, 4000),
    clientName: opts.clientName
  };
  // Texto que se vectoriza — concentrado para que cosine capture lo importante
  const semanticText = [
    `Tarea: ${opts.taskTitle}`,
    opts.clientName ? `Cliente: ${opts.clientName}` : null,
    `Resultado: ${opts.status}`,
    `Resumen: ${payload.summary}`
  ]
    .filter(Boolean)
    .join("\n");

  let vec: number[];
  let tokens = 0;
  try {
    const r = await generateEmbedding({ workspaceId: opts.workspaceId, text: semanticText });
    vec = r.vector;
    tokens = r.tokens;
  } catch (e) {
    console.warn("[episodes] embedding skip:", (e as any)?.message ?? e);
    return { recorded: false };
  }

  await prisma.searchEmbedding.upsert({
    where: {
      entityType_entityId: { entityType: EPISODE_ENTITY, entityId: opts.runId }
    },
    create: {
      workspaceId: opts.workspaceId,
      entityType: EPISODE_ENTITY,
      entityId: opts.runId,
      text: JSON.stringify(payload),
      embedding: vec as any,
      model: EMBEDDING_MODEL,
      tokens
    },
    update: {
      text: JSON.stringify(payload),
      embedding: vec as any,
      model: EMBEDDING_MODEL,
      tokens
    }
  });
  return { recorded: true };
}

export type SimilarEpisode = {
  runId: string;
  taskTitle: string;
  status: string;
  summary: string;
  clientName?: string;
  similarity: number;
};

export async function findSimilarEpisodes(opts: {
  workspaceId: string;
  queryText: string;
  topK?: number;
  minScore?: number;
}): Promise<SimilarEpisode[]> {
  const topK = opts.topK ?? 5;
  const minScore = opts.minScore ?? 0.4;

  let q: { vector: number[] };
  try {
    q = await generateEmbedding({
      workspaceId: opts.workspaceId,
      text: opts.queryText
    });
  } catch {
    return [];
  }

  const rows = await prisma.searchEmbedding.findMany({
    where: {
      workspaceId: opts.workspaceId,
      entityType: EPISODE_ENTITY,
      model: EMBEDDING_MODEL
    },
    select: { entityId: true, text: true, embedding: true }
  });

  const scored: SimilarEpisode[] = [];
  for (const r of rows) {
    const v = r.embedding as unknown as number[];
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMS) continue;
    let dot = 0;
    for (let i = 0; i < EMBEDDING_DIMS; i++) dot += q.vector[i] * v[i];
    if (dot < minScore) continue;
    let payload: EpisodePayload;
    try {
      payload = JSON.parse(r.text);
    } catch {
      continue;
    }
    scored.push({
      runId: r.entityId,
      taskTitle: payload.taskTitle,
      status: payload.status,
      summary: payload.summary,
      clientName: payload.clientName,
      similarity: dot
    });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

export function formatEpisodesForPrompt(episodes: SimilarEpisode[]): string {
  if (episodes.length === 0) return "";
  const lines = episodes.map((e, i) => {
    const tag =
      e.status === "SUCCEEDED"
        ? "✅"
        : e.status === "FAILED"
          ? "❌"
          : e.status === "REQUIRES_HUMAN"
            ? "⚠️"
            : "·";
    const client = e.clientName ? ` · ${e.clientName}` : "";
    return `${i + 1}. ${tag} **${e.taskTitle}**${client} (sim ${(e.similarity * 100).toFixed(0)}%)\n   ${e.summary.slice(0, 280)}`;
  });
  return [
    "",
    "## Episodios pasados similares (memoria episódica)",
    "Estos son runs anteriores con tareas parecidas. Aprende de lo que funcionó y NO repitas los errores.",
    "",
    lines.join("\n\n"),
    ""
  ].join("\n");
}
