/**
 * Detección de redes de perfiles (lógica pura).
 *
 * Un perfil suelto con una negativa es un indicio débil; varios perfiles que reseñan LOS MISMOS
 * negocios en fechas próximas son el patrón típico de una granja de reseñas o de un grupo
 * coordinado. Se construye un grafo perfil↔perfil cuyas aristas son los negocios que ambos han
 * reseñado (fuera del cliente) en una ventana de días, y se agrupan con union-find.
 */
import { DAY, type Contributor, type Place } from "./core";
import { norm, samePlace } from "./analyzer";

/** Huella compacta del historial de un perfil: [clave de negocio, ts, estrellas, título]. */
export type Footprint = [string, number, number, string][];

export type Network = {
  id: string;
  members: string[];
  names: string[];
  shared: { key: string; title: string; members: number }[];
  pairs: number;
  strength: number; // 0-100
};

/** Clave estable de un negocio: data_id (0x…:0x…) en minúsculas, Place ID tal cual, o el nombre normalizado. */
export const placeKeyOf = (id: string, title: string) => (id ? (/^0x/i.test(id) ? id.toLowerCase() : id) : `t:${norm(title)}`);

export function buildFootprint(contrib: Contributor, client: Place, max = 250): Footprint {
  const out: Footprint = [];
  for (const r of contrib.reviews) {
    if (!r.dataId && !r.placeTitle) continue;
    if (samePlace(r, client)) continue;
    out.push([placeKeyOf(r.dataId, r.placeTitle), r.ts, r.rating, r.placeTitle.slice(0, 80)]);
    if (out.length >= max) break;
  }
  return out;
}

type Edge = { a: string; b: string; places: Set<string> };

/**
 * Agrupa perfiles que comparten negocios reseñados.
 * - Arista si comparten ≥ minShared negocios reseñados por ambos con ≤ windowDays de diferencia,
 *   o 1 negocio compartido con reseñas casi simultáneas (≤ 2 días) y misma dirección (ambas ≥4★ o ambas ≤2★).
 * - Se ignoran negocios muy populares (reseñados por > popularPct de los perfiles), que no dicen nada.
 */
export function detectNetworks(
  footprints: Record<string, Footprint>,
  names: Record<string, string>,
  opts: { minShared?: number; windowDays?: number; popularPct?: number; minMembers?: number } = {}
): Network[] {
  const minShared = opts.minShared ?? 2;
  const windowS = (opts.windowDays ?? 60) * DAY;
  const cids = Object.keys(footprints).filter((c) => footprints[c]?.length);
  if (cids.length < 2) return [];

  // Índice negocio → [(cid, ts, rating)]
  const byPlace = new Map<string, { cid: string; ts: number; rating: number; title: string }[]>();
  for (const cid of cids) {
    const seen = new Set<string>();
    for (const [k, ts, rating, title] of footprints[cid]) {
      if (seen.has(k)) continue;
      seen.add(k);
      const arr = byPlace.get(k) ?? [];
      arr.push({ cid, ts, rating, title });
      byPlace.set(k, arr);
    }
  }
  const popularLimit = Math.max(3, Math.ceil(cids.length * (opts.popularPct ?? 0.5)));
  const titles = new Map<string, string>();
  const edges = new Map<string, Edge>();
  const strong = new Set<string>();

  byPlace.forEach((list, k) => {
    if (list.length < 2 || list.length > popularLimit) return;
    titles.set(k, list[0].title);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i];
        const y = list[j];
        if (!x.ts || !y.ts) continue;
        const gap = Math.abs(x.ts - y.ts);
        if (gap > windowS) continue;
        const [a, b] = x.cid < y.cid ? [x.cid, y.cid] : [y.cid, x.cid];
        const ek = `${a}|${b}`;
        const e = edges.get(ek) ?? { a, b, places: new Set<string>() };
        e.places.add(k);
        edges.set(ek, e);
        const sameDir = (x.rating >= 4 && y.rating >= 4) || (x.rating <= 2 && y.rating <= 2);
        if (gap <= 2 * DAY && sameDir) strong.add(ek);
      }
    }
  });

  // Union-find sobre las aristas que cumplen el umbral.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const valid: Edge[] = [];
  edges.forEach((e, k) => {
    if (e.places.size >= minShared || strong.has(k)) {
      if (!parent.has(e.a)) parent.set(e.a, e.a);
      if (!parent.has(e.b)) parent.set(e.b, e.b);
      union(e.a, e.b);
      valid.push(e);
    }
  });

  const groups = new Map<string, string[]>();
  parent.forEach((_v, cid) => {
    const r = find(cid);
    groups.set(r, [...(groups.get(r) ?? []), cid]);
  });

  const nets: Network[] = [];
  groups.forEach((members) => {
    if (members.length < (opts.minMembers ?? 2)) return;
    const set = new Set(members);
    const placeMembers = new Map<string, Set<string>>();
    let pairs = 0;
    for (const e of valid) {
      if (!set.has(e.a) || !set.has(e.b)) continue;
      pairs++;
      e.places.forEach((p) => {
        const s = placeMembers.get(p) ?? new Set<string>();
        s.add(e.a);
        s.add(e.b);
        placeMembers.set(p, s);
      });
    }
    const shared = [...placeMembers.entries()]
      .map(([key, s]) => ({ key, title: titles.get(key) ?? "", members: s.size }))
      .sort((a, b) => b.members - a.members)
      .slice(0, 10);
    // Fuerza: tamaño del grupo, densidad de pares y negocios compartidos.
    const density = pairs / Math.max(1, (members.length * (members.length - 1)) / 2);
    const strength = Math.min(100, Math.round(members.length * 12 + density * 30 + shared.length * 6));
    nets.push({
      id: "",
      members: members.sort(),
      names: members.map((m) => names[m] ?? ""),
      shared,
      pairs,
      strength
    });
  });
  nets.sort((a, b) => b.strength - a.strength);
  nets.forEach((n, i) => (n.id = `R${i + 1}`));
  return nets;
}

/** cid → red a la que pertenece. */
export function networkIndex(nets: Network[]): Map<string, Network> {
  const m = new Map<string, Network>();
  for (const n of nets) for (const c of n.members) m.set(c, n);
  return m;
}
