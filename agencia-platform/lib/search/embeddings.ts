/**
 * Generación y comparación de embeddings para búsqueda semántica.
 *
 * Usamos OpenAI `text-embedding-3-small` (1536 dimensiones):
 *  - 0.02$ por 1M tokens, suficientemente barato para indexar todo
 *    el workspace y re-indexar cada vez que algo cambie.
 *  - Calidad clara superior a TF-IDF / BM25 en preguntas tipo
 *    "¿qué decidimos sobre X la semana pasada?".
 *
 * Almacenamiento: SearchEmbedding (Json). Comparación: cosine
 * similarity en memoria al buscar. Como pre-normalizamos los
 * vectores al generarlos, la similitud es simplemente el dot
 * product — más rápido que la cosine genérica.
 */

import { prisma } from "@/lib/db/prisma";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

export type EntityType = "TASK" | "CLIENT" | "PROJECT" | "DOCUMENT" | "COMMENT" | "SONIA_KNOWLEDGE";

const MAX_INPUT_CHARS = 8000;

/**
 * Llama a OpenAI y devuelve un vector NORMALIZADO (||v|| = 1) para
 * que el dot product == cosine similarity.
 */
export async function generateEmbedding(opts: {
  workspaceId: string;
  text: string;
}): Promise<{ vector: number[]; tokens: number; text: string }> {
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  const text = truncate(opts.text, MAX_INPUT_CHARS);
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL
    })
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI embeddings ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const raw = data?.data?.[0]?.embedding as number[];
  if (!Array.isArray(raw) || raw.length !== EMBEDDING_DIMS) {
    throw new Error(`Embedding inesperado: dims=${raw?.length}`);
  }
  return {
    vector: normalize(raw),
    tokens: data?.usage?.total_tokens ?? 0,
    text
  };
}

/**
 * Indexa (o re-indexa) una entidad. Si el texto NO ha cambiado desde
 * el último embedding, se evita la llamada y se devuelve el cached.
 * Es seguro llamarlo en cada PATCH — los noop no consumen tokens.
 */
export async function indexEntity(opts: {
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  text: string;
}): Promise<{ updated: boolean; skipped?: boolean }> {
  const text = (opts.text ?? "").trim();
  if (!text) {
    // Si la entidad queda sin texto significativo, borramos el
    // embedding para que no contamine resultados (un cliente recién
    // creado sin notas tendría texto vacío).
    await prisma.searchEmbedding
      .delete({
        where: { entityType_entityId: { entityType: opts.entityType, entityId: opts.entityId } }
      })
      .catch(() => {});
    return { updated: false, skipped: true };
  }

  const existing = await prisma.searchEmbedding.findUnique({
    where: { entityType_entityId: { entityType: opts.entityType, entityId: opts.entityId } }
  });
  if (existing && existing.text === text && existing.model === EMBEDDING_MODEL) {
    return { updated: false, skipped: true };
  }

  let result: Awaited<ReturnType<typeof generateEmbedding>>;
  try {
    result = await generateEmbedding({ workspaceId: opts.workspaceId, text });
  } catch (e) {
    // Si OpenAI no está configurada o el workspace no tiene API key,
    // no rompemos la operación principal; simplemente no indexamos.
    console.warn("[embeddings] skip:", (e as any)?.message ?? e);
    return { updated: false, skipped: true };
  }

  await prisma.searchEmbedding.upsert({
    where: { entityType_entityId: { entityType: opts.entityType, entityId: opts.entityId } },
    create: {
      workspaceId: opts.workspaceId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      text: result.text,
      embedding: result.vector as any,
      model: EMBEDDING_MODEL,
      tokens: result.tokens
    },
    update: {
      text: result.text,
      embedding: result.vector as any,
      model: EMBEDDING_MODEL,
      tokens: result.tokens
    }
  });
  return { updated: true };
}

export async function deleteEntityIndex(entityType: EntityType, entityId: string): Promise<void> {
  await prisma.searchEmbedding
    .delete({ where: { entityType_entityId: { entityType, entityId } } })
    .catch(() => {});
}

/**
 * Busca top-K entidades del workspace por similitud semántica.
 * Devuelve también el score (0-1) para que la UI pueda filtrar por
 * un umbral mínimo si quiere.
 */
export async function semanticSearch(opts: {
  workspaceId: string;
  query: string;
  topK?: number;
  minScore?: number;
  entityTypes?: EntityType[];
}): Promise<
  Array<{ entityType: EntityType; entityId: string; text: string; score: number }>
> {
  const topK = opts.topK ?? 20;
  const minScore = opts.minScore ?? 0.25;

  // 1) Embedding de la query (no se guarda — efímero).
  const q = await generateEmbedding({ workspaceId: opts.workspaceId, text: opts.query });

  // 2) Lee TODOS los vectores del workspace en el mismo modelo. Para
  // <50k filas esto cabe en memoria sin problema (50k * 1536 * 4B ≈
  // 300 MB en peor caso; pero almacenamos como Json => ~12k chars
  // por fila, 600 MB de string... ojo). Si crece, migrar a pgvector.
  const rows = await prisma.searchEmbedding.findMany({
    where: {
      workspaceId: opts.workspaceId,
      model: EMBEDDING_MODEL,
      ...(opts.entityTypes ? { entityType: { in: opts.entityTypes } } : {})
    },
    select: { entityType: true, entityId: true, text: true, embedding: true }
  });

  // 3) Cosine = dot product (vectores ya normalizados).
  const scored = rows.map((r) => {
    const v = r.embedding as unknown as number[];
    let dot = 0;
    for (let i = 0; i < EMBEDDING_DIMS && i < v.length; i++) dot += q.vector[i] * v[i];
    return { entityType: r.entityType as EntityType, entityId: r.entityId, text: r.text, score: dot };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score >= minScore).slice(0, topK);
}

// ---------- helpers ----------

function normalize(v: number[]): number[] {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/**
 * Convierte un body TipTap (Json o string serializado) a texto plano
 * para alimentar el embedder. Lo extraemos aquí para reusar tanto en
 * documentos como en descripciones de tarea como en comentarios.
 */
export function tipTapToText(body: any): string {
  if (!body) return "";
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.startsWith("{")) {
      try {
        return tipTapToText(JSON.parse(trimmed));
      } catch {
        return body;
      }
    }
    return body;
  }
  if (typeof body !== "object") return String(body);
  const out: string[] = [];
  function visit(node: any) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.type === "text" && typeof node.text === "string") {
      out.push(node.text);
      return;
    }
    if (node.type === "mention" && node.attrs?.label) {
      out.push(`@${node.attrs.label}`);
    }
    if (Array.isArray(node.content)) visit(node.content);
  }
  visit(body);
  return out.join(" ");
}
