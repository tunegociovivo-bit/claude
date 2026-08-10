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
import { buildRemittanceGeneratorUrl, canContinueToDirectDebit, decideLoginAction, formatSantanderAmount, isAuthenticatedSantanderUrl, isEnvioremFrameUrl, isRemittanceGeneratorUrl, isSafeBasicPaymentsLabel, isSafePaginationControl, isSafeReconnectLabel, isSafeRemittanceGenerationLabel, numericPageLabels, parseDisplayedAmountCents, shouldAttemptSavedLogin, shouldRetryVisibleOption, shouldWaitForAmountConfirmation, shouldWaitForRemittanceList, uniqueVisibleIndex, validateAccessKey } from "../src/santander/login.js";

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
  console.log("Acceso seguro a Santander:");
  ok("acepta una clave de acceso de ocho caracteres", validateAccessKey("12345678") === "12345678");
  for (const candidate of ["", "1234567", "123456789", "1234 678", "1234\n678"]) {
    let rejected = false;
    try { validateAccessKey(candidate); } catch (error) {
      rejected = true;
      ok("el error no revela la clave", !String(error).includes(candidate) || candidate.length === 0);
    }
    ok(`rechaza clave inválida de longitud ${candidate.length}`, rejected);
  }

  const safeLogin = {
    currentUrl: "https://empresas3.gruposantander.es/paas/loginnwe/",
    allowedOrigin: "https://empresas3.gruposantander.es",
    visibleKeyFields: 8,
    rememberedUser: true,
    hasStoredCredential: true
  };
  ok("autoriza el relleno solo en el login oficial", decideLoginAction(safeLogin) === "SUBMIT_SAVED_KEY");
  ok("rechaza un dominio parecido", decideLoginAction({ ...safeLogin, currentUrl: "https://empresas3.gruposantander.es.ejemplo.com/paas/loginnwe/" }) === "PAUSE");
  ok("rechaza HTTP", decideLoginAction({ ...safeLogin, currentUrl: "http://empresas3.gruposantander.es/paas/loginnwe/" }) === "PAUSE");
  ok("rechaza una pantalla que no tenga ocho casillas", decideLoginAction({ ...safeLogin, visibleKeyFields: 7 }) === "PAUSE");
  ok("requiere que Santander recuerde el usuario", decideLoginAction({ ...safeLogin, rememberedUser: false }) === "PAUSE");
  ok("requiere una credencial local cifrada", decideLoginAction({ ...safeLogin, hasStoredCredential: false }) === "PAUSE");
  ok("reconoce la portada autenticada oficial", isAuthenticatedSantanderUrl("https://empresas3.gruposantander.es/paas/nwe/app/posglobal", safeLogin.allowedOrigin));
  ok("reconoce el módulo autenticado de remesas", isAuthenticatedSantanderUrl("https://empresas3.gruposantander.es/paas/nwe/app/portal/distribuidoras/remesas", safeLogin.allowedOrigin));
  ok("no confunde el login con una sesión autenticada", !isAuthenticatedSantanderUrl(safeLogin.currentUrl, safeLogin.allowedOrigin));
  ok("no acepta una aplicación en un dominio parecido", !isAuthenticatedSantanderUrl("https://empresas3.gruposantander.es.ejemplo.com/paas/nwe/app/posglobal", safeLogin.allowedOrigin));
  ok("no confía solo en una URL autenticada si falta la marca visual de sesión", shouldAttemptSavedLogin(false));
  ok("no intenta acceder de nuevo si la sesión está verificada visualmente", !shouldAttemptSavedLogin(true));
  ok("ordena y limita enlaces de paginación", JSON.stringify(numericPageLabels(["3", "1", "13", "2", "3", "0", "101", "Enviar"])) === JSON.stringify(["1", "2", "3", "13"]));
  ok("acepta paginación numérica como enlace o botón", isSafePaginationControl("link", "4") && isSafePaginationControl("button", "4"));
  ok("rechaza controles no numéricos o con otro rol", !isSafePaginationControl("button", "Enviar") && !isSafePaginationControl("menuitem", "4"));
  ok("reconoce el marco interno del generador de adeudos", isRemittanceGeneratorUrl("https://empresas3.gruposantander.es/paas/genweb/nwe-gw-19-ui/#!/generator/charges/debtsSEPA/all", safeLogin.allowedOrigin));
  ok("rechaza un generador fuera del dominio oficial", !isRemittanceGeneratorUrl("https://evil.example/paas/genweb/nwe-gw-19-ui/#!/generator/charges/debtsSEPA/all", safeLogin.allowedOrigin));
  ok("construye la ruta oficial directa al generador", buildRemittanceGeneratorUrl(safeLogin.allowedOrigin) === "https://empresas3.gruposantander.es/paas/genweb/nwe-gw-19-ui/#!/generator/charges/debtsSEPA/all");
  let rejectedGeneratorOrigin = false;
  try { buildRemittanceGeneratorUrl("http://empresas3.gruposantander.es"); } catch { rejectedGeneratorOrigin = true; }
  ok("rechaza construir el generador sobre un origen no HTTPS", rejectedGeneratorOrigin);
  ok("formatea el importe autorizado para Santander", formatSantanderAmount(24200) === "242,00");
  ok("interpreta un importe europeo de Santander", parseDisplayedAmountCents("1.234,56 EUR") === 123456);
  ok("rechaza un importe no verificable", parseDisplayedAmountCents("no visible") === null);
  ok("solo acepta la acción exacta Volver a conectar", isSafeReconnectLabel("Volver a conectar") && !isSafeReconnectLabel("Conectar y firmar"));
  ok("espera la confirmación asíncrona del importe", shouldWaitForAmountConfirmation(18150, 24200, 0, 10));
  ok("deja de esperar cuando Santander confirma", !shouldWaitForAmountConfirmation(24200, 24200, 1, 10));
  ok("limita la espera del importe", !shouldWaitForAmountConfirmation(18150, 24200, 10, 10));
  ok("reconoce el marco oficial de envío", isEnvioremFrameUrl("https://empresas3.gruposantander.es/paas/enviorem/#/remesas", safeLogin.allowedOrigin));
  ok("rechaza un marco de envío ajeno", !isEnvioremFrameUrl("https://evil.example/paas/enviorem/#/remesas", safeLogin.allowedOrigin));
  ok("espera si la tabla aún no ha cargado", shouldWaitForRemittanceList(false, [], 0, 20));
  ok("deja de esperar al aparecer la paginación", !shouldWaitForRemittanceList(false, ["1", "2"], 1, 20));
  ok("limita la espera de la tabla", !shouldWaitForRemittanceList(false, [], 20, 20));
  ok("selecciona la única opción visible", uniqueVisibleIndex([false, true, false]) === 1);
  ok("rechaza opciones visibles ambiguas", uniqueVisibleIndex([true, false, true]) === null);
  ok("rechaza si ninguna opción está visible", uniqueVisibleIndex([false, false]) === null);
  ok("solo acepta la categoría exacta de cobros básicos", isSafeBasicPaymentsLabel("Pagos y cobros básicos") && !isSafeBasicPaymentsLabel("Pagos internacionales"));
  ok("continúa si la categoría ya está abierta y el adeudo es único", canContinueToDirectDebit(false, true));
  ok("se detiene si no abrió la categoría ni ve un adeudo único", !canContinueToDirectDebit(false, false));
  ok("espera opciones que Santander renderiza con retraso", shouldRetryVisibleOption(false, 0, 30) && !shouldRetryVisibleOption(true, 0, 30) && !shouldRetryVisibleOption(false, 30, 30));
  ok("acepta la tarjeta segura de generación de remesas", isSafeRemittanceGenerationLabel("Generación de remesas"));
  ok("tolera el texto corto histórico de la tarjeta", isSafeRemittanceGenerationLabel("Generación"));
  ok("rechaza tarjetas de firma o pagos", !isSafeRemittanceGenerationLabel("Generación y firma") && !isSafeRemittanceGenerationLabel("Generación de pagos"));

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
