export type OwnerSource = { url: string; title: string };
export type FranchiseOwnerResearch = {
  classification: "franchise" | "corporate" | "unconfirmed";
  operatorName: string | null; taxId: string | null; ownerName: string | null; ownerRole: string | null;
  operatorWebsite: string | null; emails: string[]; phones: string[]; sources: OwnerSource[];
  confidence: "high" | "medium" | "low"; explanation: string; researchedAt: string;
};
const host = (value?: string | null) => { if (!value) return ""; try { return new URL(/^https?:/i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const clean = (value: unknown, max = 240) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export function normalizeOwnerResearch(raw: any, brand: string, centralDomain?: string | null): FranchiseOwnerResearch {
  const sources = (Array.isArray(raw?.sources) ? raw.sources : []).map((s: any) => ({ url: clean(s?.url, 500), title: clean(s?.title, 160) })).filter((s: any) => s.url && /^https?:\/\//i.test(s.url)).filter((s: any, i: number, all: any[]) => all.findIndex((x) => x.url === s.url) === i).slice(0, 8) as OwnerSource[];
  const central = host(centralDomain), operatorWebsite = clean(raw?.operatorWebsite, 500), operatorName = clean(raw?.operatorName, 180);
  const brandKey = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const isCentral = (!!central && host(operatorWebsite) === central) || (!!operatorName && operatorName.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(brandKey));
  const independentSources = new Set(sources.map((s) => host(s.url)).filter(Boolean)).size;
  const classification = isCentral ? "unconfirmed" : (["franchise", "corporate", "unconfirmed"].includes(raw?.classification) ? raw.classification : "unconfirmed");
  const emails = (Array.isArray(raw?.emails) ? raw.emails : []).map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).filter((e: string, i: number, all: string[]) => all.indexOf(e) === i).filter((e: string) => !central || !e.endsWith(`@${central}`)).slice(0, 10);
  const hasLegalEntity = !!operatorName && !isCentral;
  const confidence = hasLegalEntity && independentSources >= 2 ? "high" : hasLegalEntity && independentSources >= 1 ? "medium" : "low";
  return { classification, operatorName: isCentral ? null : operatorName, taxId: isCentral ? null : clean(raw?.taxId, 20), ownerName: !isCentral && independentSources >= 2 ? clean(raw?.ownerName, 160) : null, ownerRole: !isCentral && independentSources >= 2 ? clean(raw?.ownerRole, 120) : null, operatorWebsite: isCentral ? null : operatorWebsite, emails: isCentral ? [] : emails, phones: isCentral ? [] : (Array.isArray(raw?.phones) ? raw.phones.map((p: any) => String(p).trim()).filter(Boolean).slice(0, 8) : []), sources, confidence, explanation: clean(raw?.explanation, 500) ?? (isCentral ? "Solo se encontraron datos de la central; no se atribuye un propietario local." : "No hay evidencia suficiente para confirmar el titular local."), researchedAt: new Date().toISOString() };
}
