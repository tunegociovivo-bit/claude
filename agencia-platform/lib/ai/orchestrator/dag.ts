/**
 * Descomposición en subtareas como DAG ACÍCLICO (Slice 2c) — puro.
 *
 * Invariantes: aciclicidad, límite de nodos y de profundidad, y —crítico— NINGUNA
 * subtarea puede ELEVAR permisos por encima de su padre (autonomía del hijo ≤ padre).
 */
import { AUTONOMY_ORDER, type AutonomyLevel } from "@/lib/ai/autonomy/policy";

export type SubtaskNode = {
  id: string;
  title: string;
  deps: string[]; // ids de nodos de los que depende
  /** Nivel de autonomía máximo solicitado por la subtarea (no puede superar al padre). */
  maxAutonomy?: AutonomyLevel;
};

export type DagLimits = { maxNodes: number; maxDepth: number };
export const DEFAULT_DAG_LIMITS: DagLimits = { maxNodes: 20, maxDepth: 5 };

export type DagValidation = { ok: true; order: string[]; depth: number } | { ok: false; error: string };

function levelIndex(l: AutonomyLevel | undefined, fallback: number): number {
  if (!l) return fallback;
  const i = (AUTONOMY_ORDER as readonly string[]).indexOf(l);
  return i < 0 ? fallback : i;
}

/**
 * Valida el DAG. Devuelve orden topológico + profundidad, o un error concreto.
 * `parentAutonomy` acota el techo de cada subtarea (no elevación de permisos).
 */
export function validateDag(nodes: SubtaskNode[], parentAutonomy: AutonomyLevel, limits: DagLimits = DEFAULT_DAG_LIMITS): DagValidation {
  if (nodes.length === 0) return { ok: false, error: "DAG vacío" };
  if (nodes.length > limits.maxNodes) return { ok: false, error: `Demasiadas subtareas (${nodes.length} > ${limits.maxNodes})` };

  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return { ok: false, error: "IDs de subtarea duplicados" };
  const parentIdx = levelIndex(parentAutonomy, 0);

  for (const n of nodes) {
    // No elevación de permisos: hijo ≤ padre.
    if (levelIndex(n.maxAutonomy, parentIdx) > parentIdx) {
      return { ok: false, error: `La subtarea "${n.id}" pide más autonomía (${n.maxAutonomy}) que el padre (${parentAutonomy})` };
    }
    for (const d of n.deps) {
      if (!ids.has(d)) return { ok: false, error: `Dependencia inexistente: ${d}` };
      if (d === n.id) return { ok: false, error: `Auto-dependencia: ${n.id}` };
    }
  }

  // Orden topológico (Kahn) → detecta ciclos.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg0(indeg, n.id);
    for (const d of n.deps) {
      adj.set(d, [...(adj.get(d) ?? []), n.id]);
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
    }
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nx of adj.get(id) ?? []) {
      indeg.set(nx, (indeg.get(nx) ?? 0) - 1);
      if ((indeg.get(nx) ?? 0) === 0) queue.push(nx);
    }
  }
  if (order.length !== nodes.length) return { ok: false, error: "El DAG tiene un ciclo" };

  const depth = longestPath(nodes);
  if (depth > limits.maxDepth) return { ok: false, error: `Profundidad ${depth} > ${limits.maxDepth}` };

  return { ok: true, order, depth };
}

function indeg0(m: Map<string, number>, id: string) {
  if (!m.has(id)) m.set(id, 0);
}

/** Profundidad = nodos en el camino más largo (1-indexed). */
function longestPath(nodes: SubtaskNode[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const dfs = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0; // ciclo ya reportado; corta
    seen.add(id);
    const n = byId.get(id)!;
    let best = 1;
    for (const d of n.deps) best = Math.max(best, 1 + dfs(d, seen));
    seen.delete(id);
    memo.set(id, best);
    return best;
  };
  let max = 0;
  for (const n of nodes) max = Math.max(max, dfs(n.id, new Set()));
  return max;
}
