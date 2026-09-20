export const COMMERCIAL_PROJECT = "AITOR (COMERCIAL)";
export const COMMERCIAL_COLUMN = "LEADS GMB";
export const COMMERCIAL_PHONE = "+34 623 91 95 32";

type ProjectColumn = { id?: unknown; label?: unknown };
const COMMERCIAL_INBOX_COLUMNS = new Set([
  COMMERCIAL_COLUMN,
  "NUEVOS CLIENTES",
  "NUEVOS CLIENTES 2022"
]);

function normalizeLabel(value: unknown): string {
  return String(value ?? "").trim().toLocaleUpperCase("es-ES");
}

export function isCommercialProjectName(value: unknown): boolean {
  return normalizeLabel(value) === COMMERCIAL_PROJECT;
}

export function isCommercialLeadColumn(value: unknown): boolean {
  return COMMERCIAL_INBOX_COLUMNS.has(normalizeLabel(value));
}

export function findCommercialColumnId(columns: unknown): string | null {
  if (!Array.isArray(columns)) return null;
  const projectColumns = columns as ProjectColumn[];
  const match =
    projectColumns.find((column) => normalizeLabel(column.label ?? column.id) === COMMERCIAL_COLUMN) ??
    projectColumns.find((column) => isCommercialLeadColumn(column.label ?? column.id));
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
  createdAt: Date | string;
}): string {
  const entryDate = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(lead.createdAt));
  return [
    "Lead enviado manualmente desde Generador de Leads IA.",
    "",
    `Fecha de entrada del lead: ${entryDate}`,
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
