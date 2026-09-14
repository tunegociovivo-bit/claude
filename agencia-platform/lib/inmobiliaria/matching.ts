import type {
  BusinessPremisesSearch,
  EvidenceField,
  FitCriterion,
  Opportunity,
  OpportunitySource,
  RequiredSpace
} from "@/lib/inmobiliaria/contracts";
import { REQUIRED_SPACE_LABELS } from "@/lib/inmobiliaria/contracts";

function norm(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function isConfirmed(o: Opportunity, field: EvidenceField): boolean {
  const statuses = o.evidence?.filter((item) => item.field === field).map((item) => item.status) ?? [];
  return !statuses.includes("conflicting") && statuses.includes("confirmed");
}

function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    });
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function advertisedPrice(o: Opportunity): number | null {
  if (o.operation === "rent") return o.monthly_rent;
  if (o.operation === "sale") return o.sale_price;
  return o.monthly_rent ?? o.sale_price ?? (o.price > 0 ? o.price : null);
}

function sourceFor(o: Opportunity): OpportunitySource {
  return {
    portal: o.portal,
    label: o.portal_label,
    url: o.url,
    reference: o.id || null
  };
}

function stableId(o: Opportunity): string {
  const canonical = canonicalUrl(o.url);
  if (canonical) return canonical;
  return norm([o.portal, o.location, String(o.surface ?? ""), o.operation, String(advertisedPrice(o) ?? "")].join("|"));
}

type CostModality = "rent" | "sale";

function offeredModalities(o: Opportunity): CostModality[] {
  if (o.operation === "both") return ["rent", "sale"];
  if (o.operation === "rent" || o.operation === "transfer") return ["rent"];
  if (o.operation === "sale") return ["sale"];
  return [];
}

function modalityOverBudget(
  o: Opportunity,
  modality: CostModality,
  search: BusinessPremisesSearch
): boolean | null {
  if (modality === "rent") {
    if (search.maxMonthlyRent === undefined || o.monthly_rent === null || !isConfirmed(o, "monthly_rent")) return null;
    return o.monthly_rent > search.maxMonthlyRent;
  }
  if (search.maxPurchasePrice === undefined || o.sale_price === null || !isConfirmed(o, "sale_price")) return null;
  return o.sale_price > search.maxPurchasePrice;
}

function confirmedEntryCost(o: Opportunity, modality: CostModality): number | null {
  const transfer = isConfirmed(o, "transfer_price") && o.transfer_price !== null ? o.transfer_price : 0;
  if (modality === "rent") {
    if (o.monthly_rent !== null && isConfirmed(o, "monthly_rent")) return transfer + o.monthly_rent;
    return transfer > 0 ? transfer : null;
  }
  return o.sale_price !== null && isConfirmed(o, "sale_price") ? o.sale_price : null;
}

function hardFilterReason(o: Opportunity, search: BusinessPremisesSearch): string | null {
  const modalities = offeredModalities(o);
  if (search.operation !== "both" && modalities.length > 0 && !modalities.includes(search.operation) && isConfirmed(o, "operation")) {
    return "operación incompatible";
  }
  if (o.surface !== null && isConfirmed(o, "surface")) {
    if (search.minSurface !== undefined && o.surface < search.minSurface) return "superficie inferior";
    if (search.maxSurface !== undefined && o.surface > search.maxSurface) return "superficie superior";
  }
  const relevantModalities = modalities.filter((modality) => search.operation === "both" || modality === search.operation);
  const budgetOutcomes = relevantModalities.map((modality) => modalityOverBudget(o, modality, search));
  if (budgetOutcomes.length > 0 && budgetOutcomes.every((outcome) => outcome === true)) {
    return relevantModalities.length === 1 && relevantModalities[0] === "rent" ? "renta superior" :
      relevantModalities.length === 1 ? "precio de compra superior" : "coste superior en ambas modalidades";
  }
  if (search.maxInitialInvestment !== undefined && relevantModalities.length > 0) {
    const entryCosts = relevantModalities.map((modality) => confirmedEntryCost(o, modality));
    if (entryCosts.every((cost) => cost !== null && cost > search.maxInitialInvestment!)) {
      return "inversión inicial superior";
    }
  }
  if (search.basementPolicy === "exclude" && o.floor === "basement" && isConfirmed(o, "floor")) {
    return "solo sótano";
  }
  return null;
}

function criterion(
  key: string,
  label: string,
  maxPoints: number,
  status: FitCriterion["status"],
  ratio: number,
  reason: string
): FitCriterion {
  return { key, label, status, points: Math.round(maxPoints * ratio), maxPoints, reason };
}

function scoreOpportunity(o: Opportunity, search: BusinessPremisesSearch): Opportunity {
  const breakdown: FitCriterion[] = [];
  if (o.surface === null || (search.minSurface === undefined && search.maxSurface === undefined)) {
    breakdown.push(criterion("surface", "Superficie", 20, "unknown", 0.5, "Superficie sin confirmar"));
  } else {
    const fits = (search.minSurface === undefined || o.surface >= search.minSurface) &&
      (search.maxSurface === undefined || o.surface <= search.maxSurface);
    breakdown.push(criterion("surface", "Superficie", 20, fits ? "match" : "mismatch", fits ? 1 : 0, fits ? "Dentro del rango" : "Fuera del rango"));
  }

  if (!search.minCabins) {
    breakdown.push(criterion("cabins", "Capacidad de cabinas", 20, "not_applicable", 1, "Sin mínimo indicado"));
  } else if ((o.cabin_capacity ?? o.existing_cabins ?? -1) >= search.minCabins) {
    breakdown.push(criterion("cabins", "Capacidad de cabinas", 20, "match", 1, `Admite al menos ${search.minCabins} cabinas`));
  } else if (search.allowOpenPlan && o.layout === "open_plan") {
    breakdown.push(criterion("cabins", "Capacidad de cabinas", 20, "partial", 0.8, "Diáfano: permite proyectar la distribución"));
  } else if (o.cabin_capacity === null && o.existing_cabins === null) {
    breakdown.push(criterion("cabins", "Capacidad de cabinas", 20, "unknown", 0.5, "Capacidad por verificar"));
  } else {
    breakdown.push(criterion("cabins", "Capacidad de cabinas", 20, "mismatch", 0, "No acredita la capacidad necesaria"));
  }

  const requestedSpaces = search.requiredSpaces;
  if (requestedSpaces.length === 0) {
    breakdown.push(criterion("spaces", "Espacios necesarios", 15, "not_applicable", 1, "Sin espacios indicados"));
  } else {
    const values = requestedSpaces.map((key) => o.spaces?.[key]);
    const confirmed = values.filter((value) => value === true).length;
    const failed = values.filter((value) => value === false).length;
    const unknown = values.length - confirmed - failed;
    const ratio = (confirmed + unknown * 0.5) / values.length;
    const status = failed ? (confirmed ? "partial" : "mismatch") : unknown ? "partial" : "match";
    const missing = requestedSpaces.filter((key) => o.spaces?.[key] !== true).map((key) => REQUIRED_SPACE_LABELS[key]);
    breakdown.push(criterion("spaces", "Espacios necesarios", 15, status, ratio, missing.length ? `Por confirmar: ${missing.join(", ")}` : "Incluye los espacios pedidos"));
  }

  const budgetChecks = [
    ...(search.operation !== "sale" && search.maxMonthlyRent !== undefined && o.monthly_rent !== null
      ? [o.monthly_rent <= search.maxMonthlyRent]
      : []),
    ...(search.operation !== "rent" && search.maxPurchasePrice !== undefined && o.sale_price !== null
      ? [o.sale_price <= search.maxPurchasePrice]
      : [])
  ];
  const hasBudgetLimit =
    (search.operation !== "sale" && search.maxMonthlyRent !== undefined) ||
    (search.operation !== "rent" && search.maxPurchasePrice !== undefined);
  if (!hasBudgetLimit) {
    breakdown.push(criterion("price", "Coste del inmueble", 15, "not_applicable", 1, "Sin límite económico"));
  } else if (budgetChecks.length === 0) {
    breakdown.push(criterion("price", "Coste del inmueble", 15, "unknown", 0.5, "Precio por confirmar"));
  } else {
    const fits = budgetChecks.some(Boolean);
    breakdown.push(criterion("price", "Coste del inmueble", 15, fits ? "match" : "mismatch", fits ? 1 : 0, fits ? "Dentro del presupuesto" : "Supera el presupuesto"));
  }

  if (!o.fit_out_estimate) {
    breakdown.push(criterion("fitout", "Adecuación e inversión", 10, "unknown", 0.5, "Obra por estimar"));
  } else {
    const limit = search.maxFitOutBudget ?? search.maxInitialInvestment;
    const comparison = search.maxFitOutBudget !== undefined ? o.fit_out_estimate.max : o.initial_investment.estimatedMax;
    const fits = limit === undefined || comparison === null || comparison <= limit;
    breakdown.push(criterion("fitout", "Adecuación e inversión", 10, comparison === null ? "unknown" : fits ? "match" : "mismatch", comparison === null ? 0.5 : fits ? 1 : 0, fits ? "Inversión compatible" : "La estimación supera el límite"));
  }

  breakdown.push(criterion("street", "Planta calle", 8, o.floor === "unknown" ? "unknown" : o.floor === "street" || o.floor === "mixed" ? "match" : "partial", !search.preferStreetLevel ? 1 : o.floor === "street" ? 1 : o.floor === "mixed" ? 0.7 : o.floor === "unknown" ? 0.5 : 0.2, search.preferStreetLevel ? (o.floor === "street" ? "Acceso a pie de calle" : "Preferencia por planta calle") : "Sin preferencia"));
  breakdown.push(criterion("single_floor", "Una sola planta", 5, o.single_floor === null ? "unknown" : o.single_floor ? "match" : "partial", !search.preferSingleFloor ? 1 : o.single_floor === null ? 0.5 : o.single_floor ? 1 : 0.3, search.preferSingleFloor ? (o.single_floor ? "Todo en una planta" : "Distribución por confirmar o en varios niveles") : "Sin preferencia"));
  breakdown.push(criterion("basement", "Sótano", 2, o.has_basement === null ? "unknown" : o.has_basement ? "partial" : "match", o.has_basement === null ? 0.5 : o.has_basement ? 0.3 : 1, o.has_basement ? "Puede aumentar obra y riesgo de licencia" : "Sin sótano confirmado"));
  breakdown.push(criterion("ready", "Listo para entrar", 5, o.condition === "unknown" ? "unknown" : o.condition === "ready" ? "match" : "partial", !search.preferReadyToEnter ? 1 : o.condition === "ready" ? 1 : o.condition === "minor_works" ? 0.6 : o.condition === "unknown" ? 0.5 : 0.1, o.condition === "ready" ? "Preparado o con obra mínima" : "Necesita adecuación o verificación"));

  const score = breakdown.reduce((sum, item) => sum + item.points, 0);
  const knownWeight = breakdown.filter((item) => !["unknown", "not_applicable"].includes(item.status)).reduce((sum, item) => sum + item.maxPoints, 0);
  const confidence = Math.round((knownWeight / 100) * 100);
  return {
    ...o,
    id: o.id || stableId(o),
    score,
    fit_confidence: confidence,
    fit_breakdown: breakdown,
    verdict: score >= 75 ? "OPORTUNIDAD" : score >= 50 ? "INTERESANTE" : "DESCARTAR",
    initial_investment: o.initial_investment ?? {
      confirmedLowerBound: o.transfer_price ?? o.sale_price ?? 0,
      estimatedMin: o.fit_out_estimate?.min ?? null,
      estimatedMax: o.fit_out_estimate?.max ?? null,
      complete: false
    }
  };
}

function sameListing(a: Opportunity, b: Opportunity): boolean {
  const aUrl = canonicalUrl(a.url);
  const bUrl = canonicalUrl(b.url);
  if (aUrl && bUrl && aUrl === bUrl) return true;
  if (a.portal === b.portal && a.id && b.id && a.id === b.id) return true;
  if (a.portal === b.portal) return false;
  if (!isPreciseLocation(a.location) || !isPreciseLocation(b.location)) return false;
  if (!a.location || !b.location || norm(a.location) !== norm(b.location)) return false;
  if (a.surface === null || b.surface === null || Math.abs(a.surface - b.surface) > 2) return false;
  if (a.operation !== b.operation && a.operation !== "unknown" && b.operation !== "unknown") return false;
  const ap = advertisedPrice(a);
  const bp = advertisedPrice(b);
  return ap !== null && bp !== null && Math.abs(ap - bp) / Math.max(ap, bp) <= 0.03;
}

function isPreciseLocation(value: string): boolean {
  const normalized = norm(value);
  return normalized.length >= 10 && /\d/.test(normalized);
}

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
}

function valuesConflict(field: EvidenceField, a: Opportunity, b: Opportunity): boolean {
  if (!isConfirmed(a, field) || !isConfirmed(b, field)) return false;
  switch (field) {
    case "surface":
      return a.surface !== null && b.surface !== null && Math.abs(a.surface - b.surface) > 2;
    case "monthly_rent":
      return a.monthly_rent !== null && b.monthly_rent !== null && relativeDifference(a.monthly_rent, b.monthly_rent) > 0.03;
    case "sale_price":
      return a.sale_price !== null && b.sale_price !== null && relativeDifference(a.sale_price, b.sale_price) > 0.03;
    case "transfer_price":
      return a.transfer_price !== null && b.transfer_price !== null && relativeDifference(a.transfer_price, b.transfer_price) > 0.03;
    case "operation":
      return a.operation !== b.operation && a.operation !== "both" && b.operation !== "both";
    case "floor":
      return a.floor !== "unknown" && b.floor !== "unknown" && a.floor !== b.floor;
    case "single_floor":
      return a.single_floor !== null && b.single_floor !== null && a.single_floor !== b.single_floor;
    case "has_basement":
      return a.has_basement !== null && b.has_basement !== null && a.has_basement !== b.has_basement;
    case "existing_cabins":
      return a.existing_cabins !== null && b.existing_cabins !== null && a.existing_cabins !== b.existing_cabins;
    case "cabin_capacity":
      return a.cabin_capacity !== null && b.cabin_capacity !== null && a.cabin_capacity !== b.cabin_capacity;
    case "layout":
      return a.layout !== "unknown" && b.layout !== "unknown" && a.layout !== b.layout;
    case "condition":
      return a.condition !== "unknown" && b.condition !== "unknown" && a.condition !== b.condition;
    case "spaces":
      return Object.keys(a.spaces).some((key) => {
        const space = key as RequiredSpace;
        return a.spaces[space] !== null && b.spaces[space] !== null && a.spaces[space] !== b.spaces[space];
      });
    case "fit_out_estimate":
      return a.fit_out_estimate !== null && b.fit_out_estimate !== null &&
        (a.fit_out_estimate.max < b.fit_out_estimate.min || b.fit_out_estimate.max < a.fit_out_estimate.min);
    case "property_type":
      return norm(a.property_type) !== norm(b.property_type);
    case "location":
      return norm(a.location) !== norm(b.location);
    default:
      return false;
  }
}

function mergeSources(a: Opportunity, b: Opportunity): Opportunity {
  const sources = [...(a.sources ?? []), sourceFor(a), ...(b.sources ?? []), sourceFor(b)];
  const unique = new Map(sources.map((source) => [`${source.portal}|${canonicalUrl(source.url) || source.reference || source.label}`, source]));
  const aEvidence = a.evidence?.filter((item) => item.status === "confirmed").length ?? 0;
  const bEvidence = b.evidence?.filter((item) => item.status === "confirmed").length ?? 0;
  const aQuality = (a.url_verified ? 100 : 0) + aEvidence;
  const bQuality = (b.url_verified ? 100 : 0) + bEvidence;
  const primary = bQuality > aQuality ? b : a;
  const conflictCandidates: EvidenceField[] = [
    "operation", "property_type", "location", "surface", "monthly_rent", "sale_price", "transfer_price",
    "floor", "single_floor", "has_basement", "existing_cabins", "cabin_capacity", "layout", "spaces",
    "condition", "fit_out_estimate"
  ];
  const conflictingFields = conflictCandidates.filter((field) => valuesConflict(field, a, b));
  const combinedEvidence = [...a.evidence, ...b.evidence];
  for (const field of conflictingFields) {
    combinedEvidence.push({ field, status: "conflicting", text: "Las fuentes publican valores distintos" });
  }
  const evidence = [...new Map(combinedEvidence.map((item) => [`${item.field}|${item.status}|${item.text}`, item])).values()];
  return {
    ...primary,
    evidence,
    unknown_fields: [...new Set([
      ...a.unknown_fields,
      ...b.unknown_fields,
      ...conflictingFields.map((field) => `conflicto entre fuentes: ${field}`)
    ])],
    sources: [...unique.values()]
  };
}

export function matchAndRankOpportunities(
  input: Opportunity[],
  search: BusinessPremisesSearch
): { opportunities: Opportunity[]; duplicatesMerged: number; hardFiltered: number } {
  const normalizedInput = input.map((item) => {
    const confirmedCosts = offeredModalities(item)
      .map((modality) => confirmedEntryCost(item, modality))
      .filter((value): value is number => value !== null);
    const confirmedLowerBound = confirmedCosts.length > 0 ? Math.min(...confirmedCosts) : 0;
    return {
      ...item,
      initial_investment: {
        confirmedLowerBound,
        estimatedMin: item.fit_out_estimate ? confirmedLowerBound + item.fit_out_estimate.min : null,
        estimatedMax: item.fit_out_estimate ? confirmedLowerBound + item.fit_out_estimate.max : null,
        complete: false
      }
    };
  });
  const merged: Opportunity[] = [];
  for (const raw of normalizedInput) {
    const index = merged.findIndex((candidate) => sameListing(candidate, raw));
    if (index === -1) merged.push({ ...raw, sources: raw.sources?.length ? raw.sources : [sourceFor(raw)] });
    else merged[index] = mergeSources(merged[index], raw);
  }
  const eligible = merged.filter((item) => !hardFilterReason(item, search));
  const scored = eligible.map((item) => scoreOpportunity(item, search));
  const visible = search.onlyMatches ? scored.filter((item) => item.verdict !== "DESCARTAR") : scored;
  visible.sort((a, b) => b.score - a.score || b.fit_confidence - a.fit_confidence || a.id.localeCompare(b.id));
  return {
    opportunities: visible.slice(0, search.maxResults),
    duplicatesMerged: normalizedInput.length - merged.length,
    hardFiltered: merged.length - eligible.length
  };
}
