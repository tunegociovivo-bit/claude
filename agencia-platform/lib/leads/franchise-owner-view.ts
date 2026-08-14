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

// ─── FASE 2: enriquecimiento de CONTACTO profesional ────────────────────────────────────────────
// Identificar el titular no basta: un resultado solo es COMERCIALMENTE útil si aporta un canal
// accionable NUEVO (email profesional verificado o móvil profesional publicado del operador/
// administrador). El fijo que ya venía de Google Places NO cuenta como contacto nuevo.

export type ContactState =
  | "none" // fase de contacto aún no ejecutada
  | "queued" // en cola de contacto
  | "actionable_contact" // ≥1 canal accionable nuevo (email verificado o móvil publicado)
  | "identified_no_contact" // titular identificado pero sin canal accionable nuevo
  | "unconfirmed" // no se pudo confirmar contacto profesional
  | "provider_error"; // fallo de proveedor/integración (visible + reintentable)

/** Clasifica el estado de la FASE DE CONTACTO (fo.contact.status). "none" si no se ha ejecutado. */
export function classifyContactState(fo: any): ContactState {
  const c = fo && typeof fo === "object" ? fo.contact : null;
  const s = c && typeof c === "object" ? c.status : null;
  if (s === "queued") return "queued";
  if (s === "actionable_contact" || s === "identified_no_contact" || s === "unconfirmed" || s === "provider_error") return s;
  return "none";
}

/** ¿El lead es CONTACTABLE? = la fase de contacto encontró un canal accionable nuevo. */
export function isContactable(fo: any): boolean {
  return classifyContactState(fo) === "actionable_contact";
}

export function contactStateMeta(state: ContactState): OwnerStateMeta {
  switch (state) {
    case "actionable_contact": return { key: "done_data", label: "Contacto accionable", short: "📧 contactable", tone: "emerald" };
    case "identified_no_contact": return { key: "done_empty", label: "Sin contacto nuevo", short: "sin contacto", tone: "slate" };
    case "provider_error": return { key: "error", label: "Error de proveedor", short: "⚠ proveedor", tone: "rose" };
    case "unconfirmed": return { key: "done_empty", label: "Contacto no confirmado", short: "no confirmado", tone: "slate" };
    case "queued": return { key: "queued", label: "Buscando contacto", short: "⏳ buscando", tone: "amber" };
    default: return { key: "none", label: "Sin buscar contacto", short: "", tone: "none" };
  }
}

/** Un canal de contacto profesional publicado (email o móvil), con procedencia y confianza. */
export type ContactChannelView = {
  type: "email" | "mobile";
  value: string;
  person: string | null;
  role: string | null;
  source: string; // p.ej. "web_oficial", "hunter", "apollo", "hunter_finder"
  sourceUrl: string | null;
  foundAt: string | null;
  confidence: "high" | "medium" | "low";
  verified: { status: string; score: number | null } | null;
};

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
  // Fase 2 (contacto profesional): estado + canales accionables encontrados.
  contactState: ContactState;
  contactable: boolean;
  contactChannels: ContactChannelView[];
  contactExplanation: string | null;
  contactLastError: string | null;
  contactProcessedAt: string | null;
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
    processedAt: str(fo?.processedAt) ?? str(fo?.researchedAt),
    contactState: classifyContactState(fo),
    contactable: isContactable(fo),
    contactChannels: toContactChannels(fo?.contact?.channels),
    contactExplanation: str(fo?.contact?.explanation),
    contactLastError: str(fo?.contact?.lastError),
    contactProcessedAt: str(fo?.contact?.processedAt)
  };
}

/** Normaliza los canales de contacto guardados a la vista (solo campos mostrables). */
export function toContactChannels(raw: any): ContactChannelView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && (c.type === "email" || c.type === "mobile") && typeof c.value === "string" && c.value.trim())
    .map((c) => ({
      type: c.type as "email" | "mobile",
      value: String(c.value).trim(),
      person: str(c.person),
      role: str(c.role),
      source: str(c.source) ?? "desconocida",
      sourceUrl: str(c.sourceUrl),
      foundAt: str(c.foundAt),
      confidence: (["high", "medium", "low"].includes(c.confidence) ? c.confidence : "low") as "high" | "medium" | "low",
      verified: c.verified && typeof c.verified === "object" ? { status: String(c.verified.status ?? "unknown"), score: typeof c.verified.score === "number" ? c.verified.score : null } : null
    }))
    .slice(0, 12);
}

/** Predicado del filtro de la tabla. El filtro comercialmente útil es «Contactables» (canal
 *  accionable nuevo). "con resultado" = titular identificado con evidencia; "sin resultado" =
 *  investigado sin evidencia o con error. `all` no filtra; `none` queda fuera salvo en `all`. */
export type OwnerResultFilter = "all" | "with" | "without" | "contactable";
export function matchesOwnerFilter(state: OwnerState, filter: OwnerResultFilter): boolean {
  if (filter === "all") return true;
  if (filter === "with") return state === "done_data";
  if (filter === "without") return state === "done_empty" || state === "error";
  return false; // "contactable" se evalúa con matchesLeadFilter (necesita el estado de contacto)
}

/** Filtro por FILA combinando titular + contacto. `contactable` = fase de contacto accionable. */
export function matchesLeadFilter(view: { state: OwnerState; contactState: ContactState } | null | undefined, filter: OwnerResultFilter): boolean {
  if (filter === "all") return true;
  const state = view?.state ?? "none";
  if (filter === "contactable") return (view?.contactState ?? "none") === "actionable_contact";
  return matchesOwnerFilter(state, filter);
}
