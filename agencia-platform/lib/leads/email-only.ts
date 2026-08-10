/**
 * Orígenes de leads que se contactan por EMAIL y NUNCA por WhatsApp.
 *
 * Hoy: Franquicias (centrales). El acuerdo comercial es contactar a la central
 * por email (cola de revisión de exec-outreach), no meter su móvil en la cola
 * de WhatsApp. La detección usa las tres señales redundantes que escriben
 * importFranchiseDirectory/analyzeFranchises, por si alguna falta en leads
 * antiguos: placeId "franchise:*", rawData.source y search.source.
 */

export const EMAIL_ONLY_REASON =
  "Origen Franquicias: se contacta por email (Empleos → cola de revisión), no por WhatsApp";

export function isEmailOnlyLead(lead: {
  placeId?: string | null;
  rawData?: unknown;
  search?: { source?: string | null } | null;
}): boolean {
  const rawSource = (lead.rawData as any)?.source ?? null;
  return Boolean(
    (typeof lead.placeId === "string" && lead.placeId.startsWith("franchise:")) ||
      rawSource === "franchises" ||
      lead.search?.source === "franchises"
  );
}
