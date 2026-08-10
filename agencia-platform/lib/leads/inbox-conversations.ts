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
};

export type BlockedFilter = "all" | "blocked" | "unblocked";

export type BuildOpts = {
  optoutPhones: Set<string>;
  optoutLeadIds: Set<string>;
  blocked?: BlockedFilter;
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
