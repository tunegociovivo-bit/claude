/**
 * Tests unitarios (ejecutables con tsx, sin framework) de la lógica crítica de
 * remesas SEPA:  candidatura, token de un solo uso, enmascarado de IBAN y provider.
 *
 *   npx tsx scripts/test-sepa-remittance.ts
 *
 * Sale con código != 0 si algún assert falla.
 */
import { evaluateCandidacy, isNegocioVivoIssuer, NEGOCIO_VIVO_ISSUER_NAME } from "../lib/facturacion/sepa/candidates";
import { generateApprovalToken, hashToken, safeEqualHex } from "../lib/facturacion/sepa/token";
import { maskIban } from "../lib/facturacion/sepa/iban";
import { getSantanderProviderStatus, prepareRemittance, ProviderNotConfiguredError } from "../lib/facturacion/sepa/santander-provider";

let failed = 0;
function ok(cond: boolean, msg: string) {
  console.log((cond ? "✅" : "❌") + " " + msg);
  if (!cond) failed++;
}

// ---- Candidatura ----
const base = {
  issuerName: NEGOCIO_VIVO_ISSUER_NAME,
  status: "ISSUED",
  type: "NORMAL",
  number: "FAC-2026-0001",
  totalCents: 12100,
  paidCents: 0,
  paidAt: null,
  clientId: "c1",
  clientSepaEnabled: true,
  hasExistingRequest: false
};
ok(evaluateCandidacy(base).eligible, "Candidata válida (Negocio Vivo, emitida, con cliente SEPA)");
ok(!evaluateCandidacy({ ...base, issuerName: "Pronsia S.L." }).eligible, "Excluye Pronsia");
ok(!evaluateCandidacy({ ...base, issuerName: "LemonRoi L.L.C." }).eligible, "Excluye LemonRoi");
ok(!evaluateCandidacy({ ...base, issuerName: "Rixus Solutions L.L.C." }).eligible, "Excluye Rixus");
ok(!evaluateCandidacy({ ...base, status: "DRAFT" }).eligible, "Excluye borrador");
ok(!evaluateCandidacy({ ...base, status: "PAID", paidAt: new Date() }).eligible, "Excluye pagada");
ok(!evaluateCandidacy({ ...base, status: "CANCELLED" }).eligible, "Excluye anulada");
ok(!evaluateCandidacy({ ...base, totalCents: 0 }).eligible, "Excluye importe no positivo");
ok(!evaluateCandidacy({ ...base, clientId: null }).eligible, "Excluye sin cliente");
ok(!evaluateCandidacy({ ...base, number: "R-2026-0007" }).eligible, 'Excluye número que empieza por "R-"');
ok(!evaluateCandidacy({ ...base, type: "RECTIFICATIVA" }).eligible, "Excluye rectificativa");
ok(!evaluateCandidacy({ ...base, type: "PROFORMA" }).eligible, "Excluye proforma");
ok(!evaluateCandidacy({ ...base, type: "PRESUPUESTO" }).eligible, "Excluye presupuesto");
ok(!evaluateCandidacy({ ...base, hasExistingRequest: true }).eligible, "Excluye con remesa previa");
ok(!evaluateCandidacy({ ...base, clientSepaEnabled: false }).eligible, "Excluye cliente NO habilitado (opt-in)");
ok(isNegocioVivoIssuer("negocio vivo s.c.a.") === true, "isNegocioVivoIssuer case-insensitive");

// ---- Token ----
const { token, tokenHash } = generateApprovalToken();
ok(hashToken(token) === tokenHash, "hashToken(token) coincide con el hash guardado");
ok(token.length >= 40, "Token suficientemente largo (256 bits base64url)");
const other = generateApprovalToken();
ok(other.tokenHash !== tokenHash, "Dos tokens generan hashes distintos");
ok(safeEqualHex(tokenHash, tokenHash) === true, "safeEqualHex true para iguales");
ok(safeEqualHex(tokenHash, other.tokenHash) === false, "safeEqualHex false para distintos");
ok(safeEqualHex(tokenHash, "abcd") === false, "safeEqualHex false para longitudes distintas");
ok(hashToken("x") !== "x", "El hash no es el token en claro");

// ---- IBAN ----
const masked = maskIban("ES91 2100 0418 4502 0005 1332");
ok(!!masked && masked.startsWith("ES91"), "maskIban conserva cabecera");
ok(!!masked && masked.replace(/\s/g, "").endsWith("1332"), "maskIban conserva últimos 4");
ok(!!masked && !masked.replace(/\s/g, "").includes("210004184502"), "maskIban NO expone el cuerpo del IBAN");
ok(maskIban("no-es-iban") === null, "maskIban rechaza formato inválido");

// ---- Provider ----
delete process.env.SANTANDER_API_BASE_URL;
delete process.env.SANTANDER_API_KEY;
ok(getSantanderProviderStatus() === "NOT_CONFIGURED", "Provider NOT_CONFIGURED sin credenciales");
(async () => {
  let threw = false;
  try {
    await prepareRemittance({ remittanceRequestId: "r1", amountCents: 100, mandateRef: null });
  } catch (e) {
    threw = e instanceof ProviderNotConfiguredError;
  }
  ok(threw, "prepareRemittance lanza ProviderNotConfiguredError (no ejecuta ni simula cobro)");

  console.log(failed === 0 ? "\nTODO OK" : `\n${failed} FALLO(S)`);
  process.exit(failed === 0 ? 0 : 1);
})();
