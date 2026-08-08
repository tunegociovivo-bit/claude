/**
 * Adaptador MOCK: recorre la máquina de estados SIN tocar el banco ni el
 * navegador. Sirve para dry-run y para las pruebas automatizadas. Permite
 * INYECTAR anomalías (MFA/CAPTCHA, cambio de DOM, discrepancia de importe…)
 * para verificar que el sistema PAUSA en lugar de continuar.
 *
 * Nunca "firma": el escenario más favorable termina en PREPARED (preparado y
 * verificado pendiente de firma).
 */
import type { AuthorizedJob, AdapterHooks, SantanderAdapter, StepOutcome, AdapterState } from "./types.js";

export type MockAnomaly =
  | "none"
  | "needs_login"      // sesión no iniciada → pausa
  | "mfa"              // OTP/CAPTCHA en pantalla → pausa
  | "dom_changed"      // no se encuentra un elemento esperado → pausa
  | "amount_mismatch"  // el importe en pantalla no coincide con lo autorizado → pausa
  | "client_mismatch"  // el cliente/IBAN no coincide → pausa
  | "pending_not_verifiable"; // no se puede confirmar el estado pendiente de firma → pausa

export interface MockOptions {
  anomaly?: MockAnomaly;
  /** Importe que "muestra" el portal (para forzar discrepancias). Por defecto = autorizado. */
  shownAmountCents?: number;
  /** Cliente que "muestra" el portal. Por defecto = autorizado. */
  shownClientName?: string;
}

const FLOW: AdapterState[] = [
  "CHECK_ALLOWLIST", "CHECK_SESSION", "OPEN_REMITTANCES", "SELECT_PREVIOUS",
  "DUPLICATE_PREVIOUS", "EDIT_AUTHORIZED", "VALIDATE_MATCH", "PREPARE_FOR_SIGNATURE", "VERIFY_PENDING"
];

export class MockSantanderAdapter implements SantanderAdapter {
  constructor(private opts: MockOptions = {}) {}

  async run(job: AuthorizedJob, hooks: AdapterHooks): Promise<StepOutcome> {
    const anomaly = this.opts.anomaly ?? "none";
    for (const state of FLOW) {
      // Anomalías que provocan PAUSA (NEEDS_USER) en el punto correspondiente.
      if (state === "CHECK_SESSION" && anomaly === "needs_login") {
        return this.pause(hooks, "No hay sesión iniciada en Santander. Inicia sesión tú y reanuda.");
      }
      if (state === "CHECK_SESSION" && anomaly === "mfa") {
        return this.pause(hooks, "Se requiere OTP/CAPTCHA. Complétalo tú en el navegador.");
      }
      if (state === "SELECT_PREVIOUS" && anomaly === "dom_changed") {
        return this.pause(hooks, "No se encontró la remesa anterior (posible cambio de interfaz). Revisa el portal.");
      }
      if (state === "VALIDATE_MATCH" && anomaly === "amount_mismatch") {
        const shown = this.opts.shownAmountCents ?? job.amountCents;
        return this.pause(hooks, `Discrepancia de importe: portal ${shown} vs autorizado ${job.amountCents}.`);
      }
      if (state === "VALIDATE_MATCH" && anomaly === "client_mismatch") {
        return this.pause(hooks, "Discrepancia de cliente/IBAN entre el portal y lo autorizado.");
      }
      if (state === "VERIFY_PENDING" && anomaly === "pending_not_verifiable") {
        return this.pause(hooks, "No se pudo verificar visualmente el estado 'pendiente de firma'.");
      }
      await hooks.onProgress(state, `MOCK: ${state}`);
    }
    // Escenario favorable: preparado y verificado pendiente de firma. Nunca firmado.
    return { kind: "PREPARED", resultRef: `mock:${job.jobId}` };
  }

  private async pause(hooks: AdapterHooks, reason: string): Promise<StepOutcome> {
    await hooks.onNeedsUser(reason);
    return { kind: "NEEDS_USER", reason };
  }

  async close(): Promise<void> {
    /* nada que cerrar en mock */
  }
}
