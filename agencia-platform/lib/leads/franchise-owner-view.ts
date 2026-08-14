/**
 * Modelo de PRESENTACIÓN del titular de franquicia (puro, sin dependencias pesadas).
 *
 * Fuente ÚNICA de verdad para:
 *   - clasificar el estado real de un `rawData.franchiseOwner` (none/queued/error/done_empty/done_data),
 *   - decidir si un "done" tiene EVIDENCIA ÚTIL (operador/CIF/contactos/responsable) — "con resultado"
 *     significa evidencia real, NO solo status==="done",
 *   - construir la vista compacta que la API de listado serializa y la tabla muestra.
 *
 * Lo usan a la vez: la cola (franchise-owner-queue), el endpoint de listado (/api/v1/leads) y la UI
 * (LeadsClient) para que el contador, el filtro y la insignia por fila signifiquen lo mismo.
 */

export type OwnerState = "none" | "queued" | "error" | "done_empty" | "done_data";

/** ¿Un resultado de titular tiene EVIDENCIA ÚTIL (operador/CIF/contactos/responsable)? Un
 *  "done" sin nada de esto es un resultado vacío (posiblemente del antiguo fallo silencioso). */
export function ownerHasEvidence(fo: any): boolean {
  if (!fo || typeof fo !== "object") return false;
  return !!(fo.operatorName || fo.taxId || (Array.isArray(fo.emails) && fo.emails.length > 0) || (Array.isArray(fo.phones) && fo.phones.length > 0) || fo.ownerName);
}

/** Clasifica el estado real de identificación de un lead, distinguiendo un "done" ÚTIL de un
 *  "done" VACÍO/obsoleto (stale-empty) — el que el botón antiguo daba por completado sin datos. */
export function classifyOwnerState(fo: any): OwnerState {
  const st = fo && typeof fo === "object" ? fo.status : null;
  if (st === "queued") return "queued";
  if (st === "error") return "error";
  if (st === "done") return ownerHasEvidence(fo) ? "done_data" : "done_empty";
  return "none";
}

export type OwnerStateMeta = { key: OwnerState; label: string; short: string; tone: "emerald" | "slate" | "rose" | "amber" | "none" };

/** Metadatos de presentación por estado (insignia por fila + leyenda). */
export function ownerStateMeta(state: OwnerState): OwnerStateMeta {
  switch (state) {
    case "done_data": return { key: state, label: "Titular con datos", short: "✓ con datos", tone: "emerald" };
    case "done_empty": return { key: state, label: "Investigado sin datos", short: "∅ sin datos", tone: "slate" };
    case "error": return { key: state, label: "Error al investigar", short: "⚠ error", tone: "rose" };
    case "queued": return { key: state, label: "En cola", short: "⏳ en cola", tone: "amber" };
    default: return { key: "none", label: "Sin investigar", short: "", tone: "none" };
  }
}

export type OwnerSourceView = { url: string; title: string };
export type OwnerView = {
  state: OwnerState;
  /** true SOLO si hay evidencia útil real (operador/CIF/contactos/responsable). */
  hasEvidence: boolean;
  status: string | null;
  classification: "franchise" | "corporate" | "unconfirmed" | null;
  confidence: "high" | "medium" | "low" | null;
  operatorName: string | null;
  taxId: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  operatorWebsite: string | null;
  emails: string[];
  phones: string[];
  sources: OwnerSourceView[];
  explanation: string | null;
  lastError: string | null;
  processedAt: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arrStr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []);

/**
 * Construye la vista COMPACTA de titular que la API serializa por fila. Devuelve `null` cuando el
 * lead nunca se investigó (`state==="none"`) para no inflar el payload de listado. Nunca incluye el
 * `rawData` completo — solo los campos que la tabla/el panel muestran.
 */
export function toOwnerView(fo: any): OwnerView | null {
  const state = classifyOwnerState(fo);
  if (state === "none") return null;
  return {
    state,
    hasEvidence: ownerHasEvidence(fo),
    status: str(fo?.status),
    classification: (["franchise", "corporate", "unconfirmed"].includes(fo?.classification) ? fo.classification : null),
    confidence: (["high", "medium", "low"].includes(fo?.confidence) ? fo.confidence : null),
    operatorName: str(fo?.operatorName),
    taxId: str(fo?.taxId),
    ownerName: str(fo?.ownerName),
    ownerRole: str(fo?.ownerRole),
    operatorWebsite: str(fo?.operatorWebsite),
    emails: arrStr(fo?.emails),
    phones: arrStr(fo?.phones),
    sources: (Array.isArray(fo?.sources) ? fo.sources : [])
      .map((s: any) => ({ url: str(s?.url), title: str(s?.title) ?? "" }))
      .filter((s: any) => s.url && /^https?:\/\//i.test(s.url))
      .slice(0, 8),
    explanation: str(fo?.explanation),
    lastError: str(fo?.lastError),
    processedAt: str(fo?.processedAt) ?? str(fo?.researchedAt)
  };
}

/** Predicado del filtro de la tabla: "con resultado" = evidencia útil; "sin resultado" = investigado
 *  sin evidencia (done_empty) o con error. `all` no filtra. `none` (sin investigar) queda fuera de
 *  ambos filtros salvo en `all`. */
export type OwnerResultFilter = "all" | "with" | "without";
export function matchesOwnerFilter(state: OwnerState, filter: OwnerResultFilter): boolean {
  if (filter === "all") return true;
  if (filter === "with") return state === "done_data";
  return state === "done_empty" || state === "error"; // "without"
}
