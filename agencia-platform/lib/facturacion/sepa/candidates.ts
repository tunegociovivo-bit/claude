/**
 * Reglas de candidatura de una factura para remesa SEPA.
 *
 * SOLO facturas de la empresa emisora "Negocio Vivo S.C.A.". Se excluyen
 * totalmente Pronsia, LemonRoi y Rixus.
 *
 * La función `evaluateCandidacy` es PURA (sin BD) para poder testearla.
 */

export const NEGOCIO_VIVO_ISSUER_NAME = "Negocio Vivo S.C.A.";
// Emisoras excluidas de forma explícita (defensa en profundidad; el filtro real
// es "solo Negocio Vivo", pero dejamos la lista para claridad y guardas extra).
export const EXCLUDED_ISSUER_NAMES = ["Pronsia S.L.", "LemonRoi L.L.C.", "Rixus Solutions L.L.C."];

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

export function isNegocioVivoIssuer(issuerName: string | null | undefined): boolean {
  return norm(issuerName) === norm(NEGOCIO_VIVO_ISSUER_NAME);
}

export type CandidacyInput = {
  issuerName: string | null | undefined;
  status: string | null | undefined; // Invoice.status
  type: string | null | undefined; // Invoice.type
  number: string | null | undefined;
  totalCents: number | null | undefined;
  paidCents: number | null | undefined;
  paidAt: Date | null | undefined;
  clientId: string | null | undefined;
  clientSepaEnabled: boolean | null | undefined;
  hasExistingRequest: boolean; // ya existe una remesa para esta factura
  manuallyExcluded?: boolean;
};

export type CandidacyResult = { eligible: boolean; reasons: string[] };

/**
 * Una factura es candidata SOLO si:
 *  - la emisora es Negocio Vivo S.C.A. (y no una excluida),
 *  - está emitida/aprobada (status ISSUED) y no es borrador ni anulada/pagada,
 *  - el importe es positivo,
 *  - el cliente está identificado,
 *  - el número NO empieza por "R-" (rectificativas/abonos),
 *  - no tiene remesa previa,
 *  - el cliente está EXPRESAMENTE habilitado para cobro SEPA (opt-in).
 */
export function evaluateCandidacy(input: CandidacyInput): CandidacyResult {
  const reasons: string[] = [];

  if (!isNegocioVivoIssuer(input.issuerName)) reasons.push("La emisora no es Negocio Vivo S.C.A.");
  if (EXCLUDED_ISSUER_NAMES.some((n) => norm(n) === norm(input.issuerName))) reasons.push("Emisora excluida");

  const status = norm(input.status);
  if (status === "draft") reasons.push("Es un borrador");
  if (status !== "issued") reasons.push("No está emitida/aprobada");
  if (status === "cancelled") reasons.push("Está anulada");
  if (status === "paid") reasons.push("Ya está pagada");

  const total = input.totalCents ?? 0;
  if (total <= 0) reasons.push("Importe no positivo");

  const paid = input.paidCents ?? 0;
  if (input.paidAt || paid >= total) reasons.push("Ya cobrada");

  if (!input.clientId) reasons.push("Cliente no identificado");

  const num = (input.number ?? "").trim();
  if (!num) reasons.push("Sin número de factura");
  if (/^r-/i.test(num)) reasons.push('El número empieza por "R-"');
  // Solo facturas fiscales NORMALES: nunca rectificativas, proformas ni presupuestos.
  if (norm(input.type) !== "normal") reasons.push("No es una factura normal (proforma/presupuesto/rectificativa)");

  if (input.hasExistingRequest) reasons.push("Ya tiene una remesa/solicitud");
  if (input.manuallyExcluded) reasons.push("Excluida manualmente de remesas automáticas");

  if (!input.clientSepaEnabled) reasons.push("El cliente no está habilitado para cobro SEPA");

  return { eligible: reasons.length === 0, reasons };
}
