/**
 * Memoria de estrategias DURABLE y reutilizable (aprendizaje). Aprende SOLO de
 * resultados VERIFICADOS: qué estrategia (kind/proveedor/modelo) resolvió una tarea con
 * cierta firma ante cierta causa raíz, y cuál falló. En ejecuciones futuras similares,
 * recupera y PRIORIZA lo que ya funcionó (y evita lo que no).
 *
 * GARANTÍAS:
 *  - Tenant-scoped SIEMPRE (workspaceId en toda consulta). Nunca mezcla tenants.
 *  - `taskSignature` es un HASH de texto normalizado + redactado (sin PII/secretos ni
 *    texto crudo del objetivo → inmune a inyección de prompt: no se almacena ni se
 *    reutiliza como instrucción, solo como clave).
 *  - `rootCause` normaliza el error (ids/números borrados).
 *  - Solo se ESCRIBE con `verified === true` → los fallos no verificados y la inyección
 *    no contaminan la memoria. La evidencia se REDACTA antes de guardar.
 *  - Registro idempotente por `attemptToken`; update guardado por versión (optimista).
 */
import { stableHash, normalizeError } from "./fingerprint";
import { redactPii } from "./pii-redact";

type PrismaLike = any;

export type MemoryRow = {
  workspaceId: string;
  taskSignature: string;
  rootCause: string;
  strategyKind: string;
  provider: string;
  model: string;
  tool: string;
  successCount: number;
  failureCount: number;
  score: number;
  lastOutcome: string | null;
  lastEvidence: any;
  lastAttemptToken: string | null;
  version: number;
};

export type StrategyRecommendation = { strategyKind: string; provider: string; model: string; score: number; successCount: number; failureCount: number };

/** Firma de tarea: hash de (tipo + objetivo normalizado y REDACTADO). Sin texto crudo. */
export function taskSignature(taskType: string | null | undefined, objective: string | null | undefined): string {
  const t = (taskType ?? "task").trim().toLowerCase().slice(0, 60);
  // Redacta PII y normaliza (minúsculas, ids/números → placeholders) antes de hashear.
  const normObjective = normalizeError(redactPii(objective ?? "").text).slice(0, 200);
  return stableHash(`${t}|${normObjective}`);
}

/** Causa raíz normalizada: clase de diagnóstico + error normalizado (sin PII). */
export function rootCauseKey(diagnosisClass: string | null | undefined, error: string | null | undefined): string {
  const cls = (diagnosisClass ?? "unknown").trim().toLowerCase();
  const err = normalizeError(redactPii(error ?? "").text).slice(0, 120);
  return err ? `${cls}:${err}` : cls;
}

/** Evidencia REDACTADA (deep) para guardar sin PII/secretos. */
function redactEvidence(e: any): any {
  if (e == null) return null;
  if (typeof e === "string") return redactPii(e).text;
  if (Array.isArray(e)) return e.map(redactEvidence);
  if (typeof e === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) out[k] = redactEvidence(v);
    return out;
  }
  return e;
}

/** Tasa de éxito suavizada (Laplace) → orden de prioridad estable con pocos datos. */
function computeScore(successCount: number, failureCount: number): number {
  return Math.round(((successCount + 1) / (successCount + failureCount + 2)) * 1e4) / 1e4;
}

export interface LearningStore {
  /** Registra un resultado. NO-OP si `verified` es false (se aprende solo de verificados). */
  recordOutcome(args: {
    workspaceId: string;
    taskSignature: string;
    rootCause: string;
    strategyKind: string;
    provider?: string | null;
    model?: string | null;
    tool?: string | null;
    verified: boolean;
    ok: boolean;
    evidence?: any;
    attemptToken: string;
    now: Date;
  }): Promise<void>;
  /** Estrategias aprendidas para (firma, causa), ordenadas por score desc. Tenant-scoped. */
  recommend(workspaceId: string, taskSignature: string, rootCause: string, limit?: number): Promise<StrategyRecommendation[]>;
}

export function makeDbLearning(prisma: PrismaLike): LearningStore {
  async function recordOutcome(a: Parameters<LearningStore["recordOutcome"]>[0]): Promise<void> {
    if (!a.verified) return; // se aprende SOLO de resultados verificados
    const provider = a.provider ?? "";
    const model = a.model ?? "";
    const tool = a.tool ?? "";
    const where = { workspaceId: a.workspaceId, taskSignature: a.taskSignature, rootCause: a.rootCause, strategyKind: a.strategyKind, provider, model };
    const evidence = redactEvidence(a.evidence ?? null);
    const MAX_TRIES = 6;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      try {
        const row: MemoryRow | null = await prisma.aiStrategyMemory.findFirst({ where });
        if (row && row.lastAttemptToken === a.attemptToken) return; // idempotente
        const successCount = (row?.successCount ?? 0) + (a.ok ? 1 : 0);
        const failureCount = (row?.failureCount ?? 0) + (a.ok ? 0 : 1);
        const data = {
          successCount,
          failureCount,
          score: computeScore(successCount, failureCount),
          lastOutcome: a.ok ? "success" : "failure",
          lastEvidence: evidence,
          lastAttemptToken: a.attemptToken,
          lastUsedAt: a.now
        };
        if (!row) {
          try {
            await prisma.aiStrategyMemory.create({ data: { ...where, tool, version: 0, ...data } });
            return;
          } catch (e: any) {
            if (e?.code === "P2002") continue; // creada por otra instancia → reintenta como update
            throw e;
          }
        }
        const res = await prisma.aiStrategyMemory.updateMany({ where: { ...where, version: row.version }, data: { ...data, tool, version: row.version + 1 } });
        if (res.count === 1) return;
        // conflicto de versión → reintenta
      } catch {
        return; // best-effort: el aprendizaje no debe romper la ejecución
      }
    }
  }

  async function recommend(workspaceId: string, taskSignature: string, rootCause: string, limit = 5): Promise<StrategyRecommendation[]> {
    try {
      const rows: MemoryRow[] = await prisma.aiStrategyMemory.findMany({
        where: { workspaceId, taskSignature, rootCause }, // SIEMPRE tenant-scoped
        orderBy: { score: "desc" },
        take: limit
      });
      return rows.map((r) => ({ strategyKind: r.strategyKind, provider: r.provider, model: r.model, score: r.score, successCount: r.successCount, failureCount: r.failureCount }));
    } catch {
      return []; // si la BD falla, el motor sigue sin recomendaciones (degradación segura)
    }
  }

  return { recordOutcome, recommend };
}
