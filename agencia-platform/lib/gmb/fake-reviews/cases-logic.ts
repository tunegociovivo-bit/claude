/**
 * Centro de retiradas — lógica pura: estados, opción de denuncia en Google, textos de denuncia,
 * apelación y vía legal, lotes de apelación, verificación y aprendizaje (tasa de éxito real).
 *
 * Google no ofrece API para denunciar reseñas: la denuncia y la apelación se envían desde la
 * Herramienta de gestión de reseñas (o desde Maps para fichas ajenas). El sistema lo deja todo
 * preparado, verifica solo si la reseña sigue publicada y aprende qué motivos funcionan.
 */
import { norm, similarity } from "./analyzer";
import { POLICY_CATEGORIES, type PolicyCategory } from "./policy";

export type CaseStatus = "preparada" | "denunciada" | "rechazada" | "apelada" | "rechazada_final" | "legal" | "retirada" | "descartada";
export type CaseAction = "report" | "reject" | "appeal" | "appeal_rejected" | "legal" | "removed" | "dismiss" | "reopen";

export const STATUS_LABEL: Record<CaseStatus, string> = {
  preparada: "Preparada",
  denunciada: "Denunciada",
  rechazada: "Rechazada · apelar",
  apelada: "Apelada",
  rechazada_final: "Rechazada tras apelar",
  legal: "Vía legal",
  retirada: "Retirada",
  descartada: "Descartada"
};

/** Estados en los que la reseña se vigila para saber si Google la retira. */
export const OPEN_STATUSES: CaseStatus[] = ["denunciada", "rechazada", "apelada", "rechazada_final", "legal"];

const TRANSITIONS: Record<CaseAction, { from: CaseStatus[] | "*"; to: CaseStatus }> = {
  report: { from: ["preparada", "descartada"], to: "denunciada" },
  reject: { from: ["denunciada"], to: "rechazada" },
  appeal: { from: ["rechazada", "denunciada"], to: "apelada" },
  appeal_rejected: { from: ["apelada"], to: "rechazada_final" },
  legal: { from: ["rechazada", "apelada", "rechazada_final", "denunciada", "preparada"], to: "legal" },
  removed: { from: "*", to: "retirada" },
  dismiss: { from: "*", to: "descartada" },
  reopen: { from: ["descartada", "retirada", "rechazada_final"], to: "preparada" }
};

export function nextStatus(status: CaseStatus, action: CaseAction): { ok: true; to: CaseStatus } | { ok: false; error: string } {
  const t = TRANSITIONS[action];
  if (!t) return { ok: false, error: "Acción no válida" };
  if (t.from !== "*" && !t.from.includes(status)) return { ok: false, error: `No se puede «${action}» una reseña en estado ${STATUS_LABEL[status] ?? status}` };
  if (t.to === status) return { ok: false, error: "Ya está en ese estado" };
  return { ok: true, to: t.to };
}

/* ───────────────────────── Motivos y opción de Google ───────────────────────── */

export type CaseReason = {
  kind: "policy" | "fake" | "network" | "known" | "competitor";
  category?: PolicyCategory | "fake";
  label: string;
  policy: string;
  detail: string;
};

/** Opciones del formulario «Denunciar reseña» de Google (Herramienta de gestión de reseñas / Maps). */
export const GOOGLE_OPTIONS = {
  conflicto: "Conflicto de intereses",
  spam: "Spam",
  soez: "Lenguaje soez",
  acoso: "Acoso o intimidación",
  odio: "Discriminación o incitación al odio",
  personal: "Información personal",
  tema: "No es relevante (fuera de tema)"
} as const;
export type GoogleOption = keyof typeof GOOGLE_OPTIONS;

const CAT_OPTION: Record<PolicyCategory | "fake", GoogleOption> = {
  acoso_insultos: "acoso",
  lenguaje_obsceno: "soez",
  odio_discriminacion: "odio",
  informacion_personal: "personal",
  conflicto_interes: "conflicto",
  fuera_de_tema: "tema",
  contenido_falso: "spam",
  sexual: "soez",
  peligroso_ilegal: "acoso",
  suplantacion: "spam",
  spam_enlaces: "spam",
  fake: "conflicto"
};

/** Orden por defecto (lo más evidente para un revisor de Google primero). */
const DEFAULT_PRIORITY: GoogleOption[] = ["personal", "odio", "acoso", "soez", "conflicto", "spam", "tema"];

export function optionsFor(reasons: CaseReason[]): GoogleOption[] {
  const set = new Set<GoogleOption>();
  for (const r of reasons) {
    if (r.kind === "network" || r.kind === "known") set.add("spam");
    else if (r.kind === "competitor") set.add("spam");
    else if (r.category) set.add(CAT_OPTION[r.category]);
  }
  return [...set];
}

/** Elige la opción a marcar: la de mayor tasa real de retirada (≥5 casos), si no, la más evidente. */
export function pickOption(reasons: CaseReason[], stats?: LearningStats | null): GoogleOption {
  const opts = optionsFor(reasons);
  if (!opts.length) return "spam";
  const rate = (o: GoogleOption) => {
    const s = stats?.byOption[o];
    return s && s.decided >= 5 ? s.rate : -1;
  };
  return [...opts].sort((a, b) => rate(b) - rate(a) || DEFAULT_PRIORITY.indexOf(a) - DEFAULT_PRIORITY.indexOf(b))[0];
}

export function reasonsFromPolicy(violations: { category: PolicyCategory; evidence: string; explanation: string }[]): CaseReason[] {
  return violations.map((v) => ({
    kind: "policy",
    category: v.category,
    label: POLICY_CATEGORIES[v.category]?.label ?? v.category,
    policy: POLICY_CATEGORIES[v.category]?.google ?? "",
    detail: `«${v.evidence}» — ${v.explanation}`
  }));
}

export const FAKE_POLICY = "Contenido falso / interacción falsa (Fake engagement) y conflicto de intereses";

/* ───────────────────────── Textos ───────────────────────── */

export type CaseLike = {
  target: string;
  placeTitle: string;
  placeUrl?: string;
  author: string;
  authorLink?: string;
  rating: number;
  reviewDate: string;
  text?: string | null;
  reviewLink?: string;
  reasons: CaseReason[];
  googleOption?: string;
  score?: number;
};

const fdate = (d: string) => (d ? d.split("-").reverse().join("/") : "fecha desconocida");

function reasonLines(c: CaseLike): string[] {
  return c.reasons.map((r) => `- ${r.label}${r.policy ? ` [${r.policy}]` : ""}: ${r.detail}`);
}

/** Texto breve para el campo de detalles de la denuncia (máx. ~1.000 caracteres). */
export function reportText(c: CaseLike): string {
  const opt = GOOGLE_OPTIONS[(c.googleOption as GoogleOption) || "spam"] ?? c.googleOption;
  const head =
    c.target === "competidor"
      ? `Reseña de ${c.rating} estrellas publicada por «${c.author}» el ${fdate(c.reviewDate)} en la ficha de ${c.placeTitle}. Presenta indicios de interacción falsa (reseña no auténtica para inflar la valoración).`
      : `Reseña de ${c.rating} estrella(s) publicada por «${c.author}» el ${fdate(c.reviewDate)} en la ficha de ${c.placeTitle}. Solicitamos su revisión por incumplir la política de contenido de Google Maps (${opt}).`;
  const body = c.reasons.slice(0, 4).map((r) => `${r.label}: ${r.detail}`).join(" ");
  return `${head} ${body}`.replace(/\s+/g, " ").slice(0, 1000);
}

/** Apelación (plantilla de respaldo cuando la IA no está disponible). */
export function appealTemplate(cases: CaseLike[], business: { name: string; url?: string }, signer: string): string {
  const lines: string[] = [];
  lines.push(`Asunto: Apelación — revisión de ${cases.length} reseña(s) de «${business.name}» que incumplen la política de contenido de Google Maps`);
  lines.push("");
  lines.push("Hola, equipo de asistencia del Perfil de Empresa de Google:");
  lines.push("");
  lines.push(
    `En nombre del titular de «${business.name}»${business.url ? ` (${business.url})` : ""}, apelamos la decisión sobre las reseñas indicadas a continuación. Aportamos información adicional que no era visible en la denuncia inicial y que demuestra que no reflejan una experiencia real con el negocio o que incumplen de forma explícita la política de contenido prohibido y restringido.`
  );
  cases.forEach((c, i) => {
    lines.push("");
    lines.push(`${i + 1}. «${c.author}» · ${c.rating}/5 · ${fdate(c.reviewDate)}${c.reviewLink ? ` · ${c.reviewLink}` : ""}`);
    if (c.text) lines.push(`   Texto: «${c.text.slice(0, 300)}${c.text.length > 300 ? "…" : ""}»`);
    for (const l of reasonLines(c)) lines.push(`   ${l}`);
  });
  lines.push("");
  lines.push(
    "Las evidencias proceden de datos públicos de Google Maps y se conservan con fecha y huella SHA-256. Quedamos a disposición del equipo de revisión para aportar cualquier información adicional."
  );
  lines.push("");
  lines.push("Atentamente,");
  lines.push(signer);
  return lines.join("\n");
}

/** Texto para el formulario legal de Google (contenido ilícito / difamación, DSA). */
export function legalTemplate(c: CaseLike, business: { name: string }, signer: string): string {
  return [
    `Solicitud de retirada de contenido presuntamente ilícito en Google Maps — ficha «${business.name}».`,
    "",
    `URL de la reseña: ${c.reviewLink || "(ver enlace en la ficha)"}`,
    `Autor: ${c.author}${c.authorLink ? ` (${c.authorLink})` : ""} · ${c.rating}/5 · ${fdate(c.reviewDate)}`,
    c.text ? `Contenido: «${c.text.slice(0, 600)}»` : "",
    "",
    "Motivos:",
    ...reasonLines(c),
    "",
    "El contenido contiene afirmaciones de hecho falsas o datos personales de terceros que dañan la reputación del negocio y de su personal, y existen indicios de que no procede de un cliente real. Solicitamos su retirada conforme a la legislación aplicable (difamación / protección de datos) y al procedimiento de notificación del Reglamento de Servicios Digitales (UE) 2022/2065.",
    "",
    signer
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

/* ───────────────────────── Lotes de apelación ───────────────────────── */

/** Google permite apelar hasta 10 reseñas a la vez y una sola vez por reseña. */
export function appealBatches<T extends { placeKey: string; status: string }>(cases: T[], size = 10): T[][] {
  const by = new Map<string, T[]>();
  for (const c of cases) if (c.status === "rechazada") by.set(c.placeKey, [...(by.get(c.placeKey) ?? []), c]);
  const out: T[][] = [];
  by.forEach((list) => {
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  });
  return out;
}

/* ───────────────────────── Verificación ───────────────────────── */

export type SeenReview = { reviewId?: string; author: string; rating: number; date?: string; ts?: number; text?: string };

/** ¿La reseña del caso sigue en la lista? Por id, o por autor + estrellas + fecha (±3 días) / texto. */
export function findReview(c: { reviewId: string; author: string; rating: number; reviewDate: string; text?: string | null }, list: SeenReview[]): boolean {
  const a = norm(c.author);
  const t0 = c.reviewDate ? Date.parse(c.reviewDate) / 1000 : 0;
  return list.some((r) => {
    if (c.reviewId && r.reviewId && r.reviewId === c.reviewId) return true;
    if (!a || norm(r.author) !== a || r.rating !== c.rating) return false;
    const t = r.ts || (r.date ? Date.parse(r.date) / 1000 : 0);
    if (t0 && t && Math.abs(t - t0) <= 3 * 86_400) return true;
    if (c.text && r.text && similarity(c.text, r.text) >= 0.8) return true;
    return !t0 && !t;
  });
}

/* ───────────────────────── Aprendizaje ───────────────────────── */

export type Bucket = { total: number; decided: number; removed: number; rate: number; avgDays: number | null };
export type LearningStats = {
  total: number;
  removed: number;
  pending: number;
  byOption: Partial<Record<GoogleOption, Bucket>>;
  byReason: Record<string, Bucket>;
  byTarget: Record<string, Bucket>;
  byChannel: Record<string, Bucket>;
  appealRate: Bucket;
};

type StatCase = {
  status: string;
  googleOption: string;
  target: string;
  channel: string;
  reasons: CaseReason[] | null;
  reportedAt: Date | string | null;
  appealedAt: Date | string | null;
  removedAt: Date | string | null;
};

const DECIDED = new Set(["retirada", "rechazada", "rechazada_final", "legal"]);

function bucket(list: StatCase[]): Bucket {
  const decided = list.filter((c) => DECIDED.has(c.status));
  const removed = decided.filter((c) => c.status === "retirada");
  const days = removed
    .map((c) => (c.reportedAt && c.removedAt ? (new Date(c.removedAt).getTime() - new Date(c.reportedAt).getTime()) / 86_400_000 : null))
    .filter((d): d is number => d != null && d >= 0);
  return {
    total: list.length,
    decided: decided.length,
    removed: removed.length,
    rate: decided.length ? Math.round((removed.length / decided.length) * 100) / 100 : 0,
    avgDays: days.length ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : null
  };
}

function groupBy(list: StatCase[], key: (c: StatCase) => string[]): Record<string, Bucket> {
  const m = new Map<string, StatCase[]>();
  for (const c of list) for (const k of key(c)) if (k) m.set(k, [...(m.get(k) ?? []), c]);
  return Object.fromEntries([...m.entries()].map(([k, v]) => [k, bucket(v)]));
}

export function learningStats(cases: StatCase[]): LearningStats {
  // Sólo cuenta lo que se ha enviado a Google (las preparadas/descartadas no dicen nada del resultado).
  const sent = cases.filter((c) => c.reportedAt || DECIDED.has(c.status) || c.status === "apelada" || c.status === "denunciada");
  return {
    total: cases.length,
    removed: cases.filter((c) => c.status === "retirada").length,
    pending: cases.filter((c) => c.status === "denunciada" || c.status === "apelada").length,
    byOption: groupBy(sent, (c) => [c.googleOption]) as LearningStats["byOption"],
    byReason: groupBy(sent, (c) => [...new Set((c.reasons ?? []).map((r) => r.category || r.kind))]),
    byTarget: groupBy(sent, (c) => [c.target]),
    byChannel: groupBy(sent, (c) => [c.channel || "tool"]),
    appealRate: bucket(sent.filter((c) => c.appealedAt))
  };
}

/** Probabilidad calibrada con los resultados reales (si hay ≥ 5 casos decididos con esa opción). */
export function calibratedLikelihood(base: "alta" | "media" | "baja", option: string, stats?: LearningStats | null): "alta" | "media" | "baja" {
  const b = stats?.byOption[option as GoogleOption];
  if (!b || b.decided < 5) return base;
  return b.rate >= 0.6 ? "alta" : b.rate >= 0.3 ? "media" : "baja";
}
