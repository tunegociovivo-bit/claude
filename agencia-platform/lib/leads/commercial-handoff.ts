export const COMMERCIAL_PROJECT = "AITOR (COMERCIAL)";
export const COMMERCIAL_COLUMN = "LEADS GMB";
export const COMMERCIAL_PHONE = "+34 623 91 95 32";

type ProjectColumn = { id?: unknown; label?: unknown };

function normalizeLabel(value: unknown): string {
  return String(value ?? "").trim().toLocaleUpperCase("es-ES");
}

export function findCommercialColumnId(columns: unknown): string | null {
  if (!Array.isArray(columns)) return null;
  const match = (columns as ProjectColumn[]).find(
    (column) => normalizeLabel(column.label ?? column.id) === COMMERCIAL_COLUMN
  );
  return match?.id ? String(match.id) : null;
}

export function commercialLeadDescription(lead: {
  name: string;
  phone: string | null;
  website: string | null;
  province: string | null;
  rating: number | null;
  reviewsCount: number;
  score: number | null;
  urgency: string | null;
  gmbUrl: string | null;
  notes: string | null;
}): string {
  return [
    "Lead enviado manualmente desde Generador de Leads IA.",
    "",
    `Negocio: ${lead.name}`,
    `Teléfono: ${lead.phone ?? "—"}`,
    `Web: ${lead.website ?? "—"}`,
    `Provincia: ${lead.province ?? "—"}`,
    `Rating: ${lead.rating != null ? `${lead.rating} (${lead.reviewsCount} reseñas)` : "—"}`,
    `Score: ${lead.score ?? "—"}`,
    `Urgencia: ${lead.urgency ?? "—"}`,
    `Google: ${lead.gmbUrl ?? "—"}`,
    lead.notes ? `Notas: ${lead.notes}` : null
  ].filter(Boolean).join("\n");
}
