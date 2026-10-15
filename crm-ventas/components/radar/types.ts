// Tipos compartidos de la pantalla del radar (coinciden con lo que devuelven
// las rutas /api/v1/radar/*).

export type Criteria = {
  makes: string[];
  models: string[];
  keywords: string[];
  excludeKeywords: string[];
  yearMin: number | null;
  yearMax: number | null;
  kmMin: number | null;
  kmMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
  powerMinCv: number | null;
  fuels: string[];
  gearboxes: string[];
  countries: string[];
  portals: string[];
  includeUnknown: boolean;
};

export type SearchView = {
  id: string;
  name: string;
  active: boolean;
  criteria: Criteria;
  summary: string;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
  matchCount: number;
  createdAt: string;
};

export type SourceView = {
  portal: string;
  name: string;
  loginHost: string;
  enabled: boolean;
  hasCredentials: boolean;
  username: string | null;
  status: string;
  statusDetail: string | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastCount: number | null;
  notes?: string;
};

export type ConfigView = {
  times: string[];
  days: number[];
  notifyPhones: string[];
  notifyEmails: string[];
};

export type Options = {
  fuels: Array<{ id: string; label: string }>;
  gearboxes: Array<{ id: string; label: string }>;
  countries: Array<{ id: string; label: string }>;
  days: Array<{ id: number; label: string }>;
};

export type Overview = {
  isAdmin: boolean;
  browserReady: boolean;
  sources: SourceView[];
  searches: SearchView[];
  config: ConfigView;
  counts: { new: number; total: number };
  options: Options;
};

export type MatchView = {
  matchId: string;
  status: string;
  searchId: string;
  searchName: string;
  notifiedAt: string | null;
  createdAt: string;
  listing: {
    id: string; portal: string; portalName: string; title: string; url: string | null;
    make: string | null; model: string | null; version: string | null; year: number | null;
    km: number | null; price: number | null; priceLabel: string | null; fuel: string | null;
    gearbox: string | null; powerCv: number | null; country: string | null; location: string | null;
    auctionEndsAt: string | null; imageUrl: string | null; active: boolean; firstSeenAt: string;
  };
};

export const SOURCE_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Sin probar", tone: "bg-slate-300 text-slate-700" },
  ok: { label: "Conectado", tone: "bg-emerald-100 text-emerald-700" },
  login_failed: { label: "Acceso incorrecto", tone: "bg-rose-100 text-rose-700" },
  attention: { label: "Necesita tu ayuda", tone: "bg-amber-100 text-amber-800" },
  blocked: { label: "Bloqueado", tone: "bg-rose-100 text-rose-700" },
  error: { label: "Con error", tone: "bg-rose-100 text-rose-700" },
};

export function fmtEuros(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value)} €`;
}

export function fmtKm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "— km";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value)} km`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} d`;
}
