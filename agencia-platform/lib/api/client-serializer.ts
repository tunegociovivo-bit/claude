/**
 * Serializador de respuesta de Client con ALLOWLIST por rol (parche de seguridad).
 *
 * PROBLEMA: GET /api/v1/clients/[id] devolvía la fila COMPLETA (solo con mrr
 * redactado) → exponía `accesos` (credenciales en texto plano), `sepa*`,
 * `stripeCustomerId`, `meta*` y datos fiscales a CUALQUIER `clients:read`,
 * incluidos MIEMBROS no-admin.
 *
 * DISEÑO (allowlist por construcción — un campo nuevo del modelo NO se expone
 * salvo que se añada explícitamente aquí):
 *   - PUBLIC_FIELDS  → todos los roles (operativos + marca/editorial). Los
 *     consumidores del endpoint (modal de edición no-sensible, EditorialClient,
 *     lista) solo usan estos + los de admin.
 *   - ADMIN_FIELDS   → solo admin. Incluye fiscal, económico (mrr) y los que el
 *     modal de edición del ADMIN round-trippea (accesos, sepa*). Se GATEAN por
 *     rol, no se rompe la edición del admin.
 *   - NUNCA (ni admin): lo que no está en ninguna lista. En particular
 *     `stripeCustomerId` y `meta*` (ningún consumidor los lee del GET) quedan
 *     fuera para todos.
 *
 * Ver PATCH: sigue aceptando esos campos por `clients:write` (no cambia la
 * escritura); esto solo endurece la LECTURA.
 */

// Campos NO sensibles: visibles para cualquier clients:read.
export const CLIENT_PUBLIC_FIELDS = [
  "id",
  "workspaceId",
  "name",
  "industry",
  "status",
  "contactName",
  "email",
  "phone",
  "since",
  "notes",
  "infoGeneral",
  "servicios",
  "kitDigital",
  "prioridad",
  "asanaId",
  // Marca / editorial (operativos, no sensibles)
  "brandBrief",
  "website",
  "brandColorPrimary",
  "brandColorAccent",
  "brandColorText",
  "logoUrl",
  "logoPosition",
  "visualPattern",
  "refsFidelity",
  "competitors",
  "dimensionsByFormat",
  "referenceImages",
  "patternTemplates",
  "fonts",
  "styleGuideCached",
  "styleGuideHash",
  "driveMode",
  "driveRootId",
  "driveSubfolders",
  "imageModel",
  "editorialDefaults",
  "imageGlobalAvoid",
  "createdAt",
  "updatedAt"
] as const;

// Campos sensibles que SÍ ve el admin (fiscal + económico + los que su modal
// de edición round-trippea). NUNCA para no-admin.
export const CLIENT_ADMIN_FIELDS = [
  "mrr",
  "accesos",
  "legalName",
  "taxId",
  "fiscalAddress",
  "postalCode",
  "city",
  "province",
  "countryCode",
  "sepaEnabled",
  "sepaMandateRef",
  "sepaMandateActive",
  "sepaSantanderTemplate",
  "sepaIbanMasked"
] as const;

// Explícito (documentación viva): campos que NUNCA se devuelven por esta ruta,
// ni al admin, porque ningún consumidor los lee del GET.
export const CLIENT_NEVER_FIELDS = [
  "stripeCustomerId",
  "metaAdAccountId",
  "metaPageId",
  "metaInstagramId",
  "metaLeadEmails",
  "deletedById"
] as const;

export type SerializedClient = Record<string, unknown>;

/**
 * Devuelve un objeto con SOLO los campos permitidos para el rol. `projects` (si
 * viene incluido) se pasa tal cual (datos de proyecto no sensibles).
 */
export function serializeClient(client: Record<string, any>, isAdmin: boolean): SerializedClient {
  const out: SerializedClient = {};
  for (const k of CLIENT_PUBLIC_FIELDS) if (k in client) out[k] = client[k];
  if (isAdmin) for (const k of CLIENT_ADMIN_FIELDS) if (k in client) out[k] = client[k];
  if (Array.isArray((client as any).projects)) out.projects = (client as any).projects;
  return out;
}
