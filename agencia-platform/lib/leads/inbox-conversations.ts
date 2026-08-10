/**
 * Agrupado y filtrado de CONVERSACIONES del inbox de leads (una fila por
 * teléfono). Extraído de la ruta para poder testear la composición de filtros,
 * el estado "bloqueado para siempre" (opt-out) y el agregado por teléfono sin
 * tocar la base de datos.
 *
 * El filtro por CUENTA de WhatsApp (instanceName) y por FECHA se aplican en la
 * consulta (a nivel de mensajes) para no traer de más; aquí se resuelve el
 * agregado, el flag `optedOut` (estado persistido real que alimenta "🚫
 * Bloquear para siempre") y el filtro por bloqueado.
 */
import { realPhoneFromMeta, isLidFromMeta, looksLikePhone } from "./lid";

export type RawInboxMsg = {
  phoneNormalized: string | null;
  fromPhone: string;
  direction: string; // in | out
  body: string;
  meta: any;
  read: boolean;
  instanceName: string | null;
  classification: string | null;
  receivedAt: Date;
  lead: { id: string; name: string; phone: string | null } | null;
};

export type RawConvMeta = {
  phone: string;
  realPhone: string | null;
  displayName: string | null;
  note: string | null;
  priority: string;
  status: string;
  archived: boolean;
  followupAt: Date | null;
  aiScore: number | null;
  aiCallNow: boolean;
};

export type Conv = {
  phone: string;
  realPhone: string | null;
  isLid: boolean;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  displayName: string | null;
  note: string | null;
  priority: string;
  status: string;
  archived: boolean;
  followupAt: string | null;
  aiScore: number | null;
  aiCallNow: boolean;
  lastBody: string;
  lastAt: string;
  lastInboundAt: string | null;
  lastDirection: string;
  unread: number;
  instanceName: string | null;
  classification: string | null;
  /** Estado persistido real de "Bloquear para siempre" (opt-out del negocio). */
  optedOut: boolean;
  /** Fragmento de un mensaje que coincidió con la búsqueda (para explicar por
   *  qué aparece la conversación). null si no hubo búsqueda de texto o el match
   *  fue por nombre/teléfono. */
  matchSnippet?: string | null;
  /** Origen del match: "inbound" | "outbound" | null. */
  matchSource?: string | null;
};

export type BlockedFilter = "all" | "blocked" | "unblocked";

export type MatchInfo = { snippet: string; source: "inbound" | "outbound" };

export type BuildOpts = {
  optoutPhones: Set<string>;
  optoutLeadIds: Set<string>;
  blocked?: BlockedFilter;
  /** Fragmentos coincidentes por teléfono / por leadId (búsqueda por texto). */
  snippetByPhone?: Map<string, MatchInfo>;
  snippetByLeadId?: Map<string, MatchInfo>;
};

const RANK: Record<string, number> = { alta: 0, media: 1, baja: 2, none: 3 };

/**
 * Agrupa mensajes (que YA vienen ordenados desc por receivedAt) por teléfono,
 * marca `optedOut` con el estado real de opt-out y aplica el filtro por
 * bloqueado. Ordena por prioridad y actividad reciente.
 */
export function buildConversations(msgs: RawInboxMsg[], metas: RawConvMeta[], opts: BuildOpts): Conv[] {
  const metaByPhone = new Map(metas.map((m) => [m.phone, m]));
  const byPhone = new Map<string, Conv>();

  for (const m of msgs) {
    const phone = m.phoneNormalized ?? m.fromPhone;
    let c = byPhone.get(phone);
    if (!c) {
      const meta = metaByPhone.get(phone);
      const leadId = m.lead?.id ?? null;
      c = {
        phone,
        realPhone: meta?.realPhone ?? (looksLikePhone(phone) ? phone : null),
        isLid: false,
        leadId,
        leadName: m.lead?.name ?? null,
        leadPhone: m.lead?.phone ?? null,
        displayName: meta?.displayName ?? null,
        note: meta?.note ?? null,
        priority: meta?.priority ?? "none",
        status: meta?.status ?? "pending",
        archived: meta?.archived ?? false,
        followupAt: meta?.followupAt ? meta.followupAt.toISOString() : null,
        aiScore: meta?.aiScore ?? null,
        aiCallNow: meta?.aiCallNow ?? false,
        lastBody: m.body,
        lastAt: m.receivedAt.toISOString(),
        lastInboundAt: null,
        lastDirection: m.direction,
        unread: 0,
        instanceName: null,
        classification: null,
        optedOut: optedOutFor(phone, leadId, opts)
      };
      byPhone.set(phone, c);
    }
    if (m.direction === "in" && !c.realPhone) {
      const rp = realPhoneFromMeta(m.meta);
      if (rp) c.realPhone = rp;
      if (isLidFromMeta(m.meta)) c.isLid = true;
    }
    if (!c.leadId && m.lead) {
      c.leadId = m.lead.id;
      c.leadName = m.lead.name;
      c.leadPhone = m.lead.phone ?? null;
      // Recalcula opt-out ahora que conocemos el lead (puede estar bloqueado por leadId).
      if (!c.optedOut) c.optedOut = optedOutFor(c.phone, c.leadId, opts);
    }
    if (m.direction === "in") {
      if (!m.read) c.unread++;
      if (c.lastInboundAt === null) c.lastInboundAt = m.receivedAt.toISOString();
      if (c.instanceName === null && m.instanceName) c.instanceName = m.instanceName;
      if (c.classification === null && m.classification) c.classification = m.classification;
    }
  }

  let items = Array.from(byPhone.values());

  const blocked = opts.blocked ?? "all";
  if (blocked === "blocked") items = items.filter((c) => c.optedOut);
  else if (blocked === "unblocked") items = items.filter((c) => !c.optedOut);

  // Adjunta el fragmento coincidente (por teléfono, o por leadId si el match
  // vino de un mensaje de campaña vinculado por lead). Sirve para explicar en la
  // fila POR QUÉ apareció la conversación al buscar por texto.
  if (opts.snippetByPhone || opts.snippetByLeadId) {
    for (const c of items) {
      const hit = opts.snippetByPhone?.get(c.phone) ?? (c.leadId ? opts.snippetByLeadId?.get(c.leadId) : undefined);
      if (hit) {
        c.matchSnippet = hit.snippet;
        c.matchSource = hit.source;
      }
    }
  }

  items.sort((a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) || new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return items;
}

/** Un teléfono/lead está bloqueado si tiene opt-out por teléfono o por leadId. */
function optedOutFor(phone: string, leadId: string | null, opts: BuildOpts): boolean {
  if (opts.optoutPhones.has(phone)) return true;
  if (leadId && opts.optoutLeadIds.has(leadId)) return true;
  return false;
}

// La cuenta "default" (sesión principal) se guarda como instanceName=null en BD;
// la representamos con este centinela para poder ofrecerla y filtrarla.
export const DEFAULT_ACCOUNT = "__default__";

/** Cláusula `where` (a nivel de mensaje) para el filtro por cuenta de WhatsApp. */
export function resolveAccountWhere(account: string | null | undefined): Record<string, any> {
  const a = (account ?? "").trim();
  if (!a || a === "all") return {};
  if (a === DEFAULT_ACCOUNT) return { instanceName: null };
  return { instanceName: a };
}

/** Opciones reales de cuenta a partir de los grupos distinct de instanceName. */
export function accountOptionsFromGroups(groups: { instanceName: string | null }[]): string[] {
  const named = Array.from(
    new Set(groups.map((g) => g.instanceName).filter((n): n is string => !!n && n.trim().length > 0))
  ).sort((a, b) => a.localeCompare(b));
  const hasDefault = groups.some((g) => g.instanceName === null);
  return hasDefault ? [DEFAULT_ACCOUNT, ...named] : named;
}

// ─────────────────────────────────────────────────────────────────────────────
// BÚSQUEDA POR CONTENIDO DE MENSAJE (server-side, en LeadMessage + LeadInboxMessage)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mínimo de caracteres (tras normalizar) para lanzar la búsqueda por texto.
 * Motivo: un término de 1-2 caracteres casa con casi todo y obliga a escanear el
 * texto de todos los mensajes del workspace (LeadInboxMessage.body/renderedMessage
 * son @db.Text, sin índice de subcadena), lo que es caro. Con 3 el coste ya es
 * razonable para el volumen actual. El cliente muestra un aviso por debajo de él.
 */
export const MIN_SEARCH_CHARS = 3;

/** Normaliza el término: recorta, colapsa espacios internos y pasa a minúsculas. */
export function normalizeSearch(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** ¿El término tiene longitud suficiente para buscar? */
export function isSearchable(raw: string | null | undefined): boolean {
  return normalizeSearch(raw).length >= MIN_SEARCH_CHARS;
}

/**
 * Extrae un fragmento legible alrededor de la primera coincidencia (sin
 * distinguir mayúsculas). Devuelve null si el término no aparece.
 */
export function makeSnippet(text: string | null | undefined, term: string, radius = 40): string | null {
  if (!text) return null;
  const t = normalizeSearch(term);
  if (!t) return null;
  const hayNorm = text.replace(/\s+/g, " ");
  const idx = hayNorm.toLowerCase().indexOf(t);
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(hayNorm.length, idx + t.length + radius);
  const pre = start > 0 ? "…" : "";
  const post = end < hayNorm.length ? "…" : "";
  return `${pre}${hayNorm.slice(start, end).trim()}${post}`;
}

// Filas mínimas que las consultas de búsqueda devuelven (ya filtradas por la BD).
export type SearchInboxRow = { phoneNormalized: string | null; fromPhone: string; leadId: string | null; body: string };
export type SearchOutboundRow = { phoneNormalized: string | null; leadId: string | null; renderedMessage: string };

/**
 * Agrega las filas ya casadas por la BD en conjuntos de teléfonos/leadIds y un
 * fragmento representativo por conversación. La coincidencia se re-verifica aquí
 * (indexOf normalizado) para que sea determinista y testeable, y para respetar
 * la normalización de espacios del término.
 */
export function collectSearchMatches(
  rows: { inbox: SearchInboxRow[]; outbound: SearchOutboundRow[] },
  term: string
): { matchedPhones: Set<string>; matchedLeadIds: Set<string>; snippetByPhone: Map<string, MatchInfo>; snippetByLeadId: Map<string, MatchInfo> } {
  const matchedPhones = new Set<string>();
  const matchedLeadIds = new Set<string>();
  const snippetByPhone = new Map<string, MatchInfo>();
  const snippetByLeadId = new Map<string, MatchInfo>();

  for (const r of rows.inbox) {
    const snip = makeSnippet(r.body, term);
    if (!snip) continue;
    const phone = r.phoneNormalized ?? r.fromPhone;
    if (phone) {
      matchedPhones.add(phone);
      if (!snippetByPhone.has(phone)) snippetByPhone.set(phone, { snippet: snip, source: "inbound" });
    }
    if (r.leadId) {
      matchedLeadIds.add(r.leadId);
      if (!snippetByLeadId.has(r.leadId)) snippetByLeadId.set(r.leadId, { snippet: snip, source: "inbound" });
    }
  }
  for (const r of rows.outbound) {
    const snip = makeSnippet(r.renderedMessage, term);
    if (!snip) continue;
    if (r.phoneNormalized) {
      matchedPhones.add(r.phoneNormalized);
      if (!snippetByPhone.has(r.phoneNormalized)) snippetByPhone.set(r.phoneNormalized, { snippet: snip, source: "outbound" });
    }
    if (r.leadId) {
      matchedLeadIds.add(r.leadId);
      if (!snippetByLeadId.has(r.leadId)) snippetByLeadId.set(r.leadId, { snippet: snip, source: "outbound" });
    }
  }
  return { matchedPhones, matchedLeadIds, snippetByPhone, snippetByLeadId };
}

/** `where` (scoped por workspace) para buscar en LeadInboxMessage.body. */
export function searchWhereInbox(workspaceId: string, term: string): Record<string, any> {
  return { workspaceId, body: { contains: normalizeSearch(term), mode: "insensitive" } };
}
/** `where` (scoped por workspace) para buscar en LeadMessage.renderedMessage. */
export function searchWhereOutbound(workspaceId: string, term: string): Record<string, any> {
  return { workspaceId, renderedMessage: { contains: normalizeSearch(term), mode: "insensitive" } };
}
