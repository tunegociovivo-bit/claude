/**
 * Pruebas del agente (sin navegador). Cubren:
 *  - Máquina de estados feliz → PREPARED (nunca firma).
 *  - Anomalías (login, MFA/CAPTCHA, cambio de DOM, discrepancias, no verificable)
 *    → PAUSA (NEEDS_USER), sin cerrar como preparado.
 *  - Barrera anti-firma: etiquetas prohibidas.
 *  - Saneado de logs.
 *
 * Ejecuta: `npx tsx test/run.ts`
 */
import { MockSantanderAdapter, type MockAnomaly } from "../src/santander/mock.js";
import { isForbiddenActionLabel } from "../src/santander/types.js";
import type { AdapterHooks, AuthorizedJob } from "../src/santander/types.js";
import { sanitize } from "../src/logger.js";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

const JOB: AuthorizedJob = {
  jobId: "job_1", invoiceNumber: "F-2026-001", clientName: "Cliente Demo SL",
  amountCents: 12345, currency: "EUR", mandateRef: "MND-001", ibanMasked: "ES**…**1234",
  santanderTemplate: "Cliente Demo"
};

function recordingHooks() {
  const progress: string[] = [];
  let needsUser: string | null = null;
  const hooks: AdapterHooks = {
    onProgress: async (_s, p) => { progress.push(p); },
    onNeedsUser: async (r) => { needsUser = r; },
    log: () => {}
  };
  return { hooks, progress, get needsUser() { return needsUser; } };
}

async function runScenario(anomaly: MockAnomaly, opts?: any) {
  const adapter = new MockSantanderAdapter({ anomaly, ...(opts ?? {}) });
  const rec = recordingHooks();
  const outcome = await adapter.run(JOB, rec.hooks);
  await adapter.close();
  return { outcome, rec };
}

async function main() {
  console.log("Máquina de estados y seguridad del agente:");

  // 1) Camino feliz → PREPARED, nunca firma.
  {
    const { outcome, rec } = await runScenario("none");
    ok("camino feliz termina en PREPARED", outcome.kind === "PREPARED");
    ok("no se solicitó intervención en camino feliz", rec.needsUser === null);
    ok("hubo progreso reportado", rec.progress.length >= 5);
  }

  // 2) Anomalías → NEEDS_USER (pausa), nunca PREPARED.
  const anomalies: MockAnomaly[] = ["needs_login", "mfa", "dom_changed", "amount_mismatch", "client_mismatch", "pending_not_verifiable"];
  for (const a of anomalies) {
    const { outcome, rec } = await runScenario(a, a === "amount_mismatch" ? { shownAmountCents: 999 } : {});
    ok(`anomalía '${a}' → NEEDS_USER`, outcome.kind === "NEEDS_USER");
    ok(`anomalía '${a}' NO termina en PREPARED`, outcome.kind !== "PREPARED");
    ok(`anomalía '${a}' reporta motivo`, typeof rec.needsUser === "string" && (rec.needsUser as string).length > 0);
  }

  // 3) Barrera anti-firma: etiquetas prohibidas.
  console.log("\nBarrera anti-firma:");
  for (const label of ["Firmar", "FIRMAR REMESA", "Confirmar envío", "Autorizar", "Enviar al banco", "Ejecutar", "Pagar", "Sign"]) {
    ok(`etiqueta prohibida detectada: "${label}"`, isForbiddenActionLabel(label));
  }
  for (const label of ["Guardar", "Preparar", "Duplicar", "Continuar", "Siguiente"]) {
    ok(`etiqueta permitida NO bloqueada: "${label}"`, !isForbiddenActionLabel(label));
  }

  // 4) Saneado de logs.
  console.log("\nSaneado de logs:");
  const dirty = 'IBAN ES9121000418450200051332 token=abcdEFGH1234ijklMNOP5678qrst email juan.perez@example.com cuenta 001234567890';
  const clean = sanitize(dirty);
  ok("IBAN redactado", !clean.includes("21000418450200051332"));
  ok("token redactado", !clean.includes("abcdEFGH1234ijklMNOP5678qrst"));
  ok("email parcialmente redactado", !clean.includes("juan.perez@example.com"));
  ok("dígitos largos redactados", !/\b001234567890\b/.test(clean));

  console.log(`\nResultado: ${passed} OK, ${failed} fallidos`);
  if (failed > 0) process.exit(1);
}

void main();
