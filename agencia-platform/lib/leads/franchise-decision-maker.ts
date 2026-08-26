export type DecisionMakerCandidate = {
  email: string;
  name?: string | null;
  role?: string | null;
  linkedin?: string | null;
  source?: string | null;
  providerConfidence?: number | null;
  evidenceUrl?: string | null;
};

export type RankedDecisionMaker = DecisionMakerCandidate & {
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  sendAllowed: boolean;
  copyAllowed: boolean;
};

const genericMailbox = /^(info|hola|contacto|contact|administracion|central|franquicias|expansion|marketing|comunicacion|ventas|hello|office|general|somos)@/i;
const targetMailbox = /^(franquicias|infofranquicias|franchise|expansion|exporestalia|marketing|comunicacion|brand|prensa|press|info|contacto|contact|hola|hello|central)@/i;
const wrongDepartment = /^(privacy|privacidad|legal|soporte|support|atencion[^@]*|clientes?|rrhh|empleo|jobs|facturacion|billing|compras|proveedores)@/i;
const targetRole = /(chief marketing officer|\bcmo\b|director(?:a)? de marketing|marketing director|head of marketing|responsable de marketing|marketing manager|brand manager|director(?:a)? de marca|comunicaci[oó]n|growth|expansi[oó]n|franchise development)/i;
const seniorRole = /(chief|director|head|responsable|manager|vp|vicepresident|gerente)/i;

function cleanDomain(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:]/)[0];
}

export function rankFranchiseDecisionMakers(candidates: DecisionMakerCandidate[], corporateDomain?: string | null): RankedDecisionMaker[] {
  const domain = cleanDomain(corporateDomain ?? "");
  const unique = new Map<string, DecisionMakerCandidate>();
  for (const candidate of candidates) {
    const email = candidate.email.trim().toLowerCase();
    if (email && !unique.has(email)) unique.set(email, { ...candidate, email });
  }
  return [...unique.values()].map((candidate) => {
    let score = 0;
    const reasons: string[] = [];
    const role = candidate.role?.trim() ?? "";
    const emailDomain = cleanDomain(candidate.email.split("@")[1] ?? "");
    if (candidate.name?.trim()) { score += 15; reasons.push("persona identificada"); }
    if (targetRole.test(role)) { score += 40; reasons.push("cargo de marketing/expansión"); }
    if (seniorRole.test(role)) { score += 10; reasons.push("responsabilidad directiva"); }
    if (candidate.linkedin) { score += 5; reasons.push("perfil profesional localizado"); }
    if (domain && emailDomain === domain) { score += 10; reasons.push("dominio corporativo coincidente"); }
    else if (domain && emailDomain !== domain) { score -= 20; reasons.push("dominio distinto al corporativo"); }
    const functionalMailbox = targetMailbox.test(candidate.email);
    if (functionalMailbox) { score += 65; reasons.push("buzón funcional corporativo"); }
    const literalCorporateMailbox = candidate.source === "corporate_website_literal" && (!domain || emailDomain === domain);
    if (literalCorporateMailbox) { score += 45; reasons.push("correo publicado literalmente por la empresa"); }
    if (typeof candidate.providerConfidence === "number") {
      const normalized = Math.max(0, Math.min(100, candidate.providerConfidence));
      score += Math.round(normalized * 0.2);
      if (normalized >= 80) reasons.push("email verificado por proveedor");
    }
    if (genericMailbox.test(candidate.email)) { score -= 30; reasons.push("buzón genérico"); }
    if (wrongDepartment.test(candidate.email)) { score -= 80; reasons.push("departamento incorrecto"); }
    score = Math.max(0, Math.min(100, score));
    const confidence: RankedDecisionMaker["confidence"] = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
    const namedDecisionMaker = confidence === "high" && !!candidate.name?.trim() && targetRole.test(role) && !genericMailbox.test(candidate.email) && !wrongDepartment.test(candidate.email);
    const trustedEvidenceSource = candidate.source === "aef_directory" || candidate.source === "corporate_website_literal";
    const evidencedFunctionalMailbox = functionalMailbox && trustedEvidenceSource && !!candidate.evidenceUrl && !wrongDepartment.test(candidate.email);
    const sendAllowed = namedDecisionMaker || evidencedFunctionalMailbox || (literalCorporateMailbox && !!candidate.evidenceUrl && !wrongDepartment.test(candidate.email));
    const copyAllowed = (score >= 45 && !!candidate.name?.trim() && targetRole.test(role) && (!domain || emailDomain === domain) && !genericMailbox.test(candidate.email) && !wrongDepartment.test(candidate.email)) || (literalCorporateMailbox && !!candidate.evidenceUrl && !wrongDepartment.test(candidate.email));
    return { ...candidate, score, confidence, reasons, sendAllowed, copyAllowed };
  }).sort((a, b) => b.score - a.score);
}
