/**
 * Bucle principal del agente:
 *  - Late (heartbeat) periódicamente para aparecer "online" en el HUB.
 *  - Sondea trabajos con claim (el HUB solo entrega si el kill switch está ON).
 *  - Por cada trabajo, ejecuta el adaptador de Santander y reporta:
 *      progreso (RUNNING), pausa (NEEDS_USER) o cierre (PREPARADO / FALLIDO).
 *  - NUNCA firma ni cobra: el mejor final posible es PREPARED_PENDING_SIGNATURE.
 *
 * El agente procesa de UNO EN UNO: no reclama otro trabajo hasta cerrar el actual.
 */
import type { AgentConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { HubClient, type ClaimedJob } from "./hub-client.js";
import type { SantanderAdapter, AdapterHooks, AuthorizedJob, StepOutcome } from "./santander/types.js";
import { MockSantanderAdapter } from "./santander/mock.js";
import { LiveSantanderAdapter } from "./santander/live.js";
import { effectiveReconciliationLastAttempt, reconciliationRetryDecision, SantanderReconciliationReader, shouldRunDailyReconciliation } from "./santander/reconciliation.js";
import { remittanceRetryDecision, remittanceRetryDelayMs } from "./santander/retry.js";
import { isRecoverableCdpFailure, recoverDedicatedChrome } from "./santander/chrome-recovery.js";

export class Runner {
  private stopped = false;
  private hub: HubClient;
  private lastReconciliationAttemptAt: Date | null = null;

  constructor(private cfg: AgentConfig, private log: Logger) {
    this.hub = new HubClient(cfg);
  }

  stop() { this.stopped = true; }

  async start(): Promise<void> {
    this.log.info(`Agente iniciado v${this.cfg.version} · modo Santander: ${this.cfg.santanderMode} · HUB: ${this.cfg.hubUrl}`);
    // Heartbeat en su propio intervalo.
    const hb = setInterval(() => { void this.safeHeartbeat(); }, this.cfg.heartbeatSeconds * 1000);
    void this.safeHeartbeat();

    try {
      while (!this.stopped) {
        // Una conciliación solicitada (lastSyncAt=null) debe poder adelantarse
        // a trabajos en cola; nunca interrumpe un trabajo ya iniciado.
        let job: ClaimedJob | null = null;
        try {
          job = await this.hub.claim();
        } catch (e: any) {
          this.log.warn(`No se pudo reclamar trabajo: ${e?.message ?? e}`);
        }
        if (job) {
          await this.processJob(job);
        } else {
          await this.maybeReconcile();
          await sleep(this.cfg.pollSeconds * 1000, () => this.stopped);
        }
      }
    } finally {
      clearInterval(hb);
    }
  }

  private async maybeReconcile(): Promise<void> {
    if (this.cfg.santanderMode !== "live") return;
    try {
      const config = await this.hub.reconciliationConfig();
      if (!config?.enabled) return;
      const now = new Date();
      if (!shouldRunDailyReconciliation(now, config.lastSyncAt ? new Date(config.lastSyncAt) : null, config.dailyAt, config.timeZone)) return;
      // Si Santander no está disponible, no reabrir una ventana en cada ciclo
      // de sondeo. Un intento fallido queda enfriado durante 30 minutos.
      const lastAttempt = effectiveReconciliationLastAttempt(
        config.retryAttempts,
        config.lastFailureAt ? new Date(config.lastFailureAt) : null,
        this.lastReconciliationAttemptAt
      );
      if (reconciliationRetryDecision(now, lastAttempt, config.retryAttempts, config.timeZone) !== "RUN") return;
      this.lastReconciliationAttemptAt = now;
      const reader = new SantanderReconciliationReader({ cdpUrl: this.cfg.chromeCdpUrl, santanderOrigin: this.cfg.santanderOrigin, credentialFile: this.cfg.santanderCredentialFile });
      let movements;
      try {
        movements = await reader.scan(new Date(config.startsAt));
      } catch (error) {
        if (!isRecoverableCdpFailure(error)) throw error;
        this.log.warn("Chrome bancario bloqueado: reiniciando únicamente el perfil dedicado y reintentando ahora.");
        await recoverDedicatedChrome(this.cfg.chromeCdpUrl);
        await sleep(3_000, () => this.stopped);
        movements = await reader.scan(new Date(config.startsAt));
      }
      const result = await this.hub.reportMovements(movements);
      this.log.info(`Conciliación: ${result.imported} movimientos nuevos, ${result.matched} facturas conciliadas.`);
    } catch (e: any) {
      const reason = String(e?.message ?? e).slice(0, 1000);
      this.log.warn(`Conciliación aplazada: ${reason}`);
      try {
        const incident = await this.hub.reportReconciliationFailure(reason);
        this.log.warn(`Conciliación: intento ${incident.attempts}/3${incident.notified ? "; aviso enviado" : ""}.`);
      } catch (reportError: any) {
        this.log.warn(`No se pudo registrar el fallo de conciliación: ${reportError?.message ?? reportError}`);
      }
    }
  }

  private async safeHeartbeat(): Promise<void> {
    try {
      const ok = await this.hub.heartbeat();
      if (!ok) this.log.warn("Heartbeat rechazado (¿token revocado?).");
    } catch (e: any) {
      this.log.warn(`Heartbeat falló: ${e?.message ?? e}`);
    }
  }

  private makeAdapter(): SantanderAdapter {
    if (this.cfg.santanderMode === "live") {
      return new LiveSantanderAdapter({
        cdpUrl: this.cfg.chromeCdpUrl,
        santanderOrigin: this.cfg.santanderOrigin,
        selectorsFile: this.cfg.selectorsFile,
        credentialFile: this.cfg.santanderCredentialFile
      });
    }
    return new MockSantanderAdapter();
  }

  private async processJob(job: ClaimedJob): Promise<void> {
    this.log.info(`Trabajo reclamado ${job.jobId} · ${job.clientName} · ${(job.amountCents / 100).toFixed(2)} ${job.currency}`);
    const authorized: AuthorizedJob = {
      jobId: job.jobId, invoiceNumber: job.invoiceNumber, clientName: job.clientName,
      amountCents: job.amountCents, currency: job.currency, mandateRef: job.mandateRef,
      ibanMasked: job.ibanMasked, santanderTemplate: job.santanderTemplate
    };

    const hooks: Omit<AdapterHooks, "onNeedsUser"> = {
      onProgress: async (state, progress) => {
        this.log.debug(`[${job.jobId}] ${state}: ${progress}`);
        try { await this.hub.progress(job.jobId, "RUNNING", { progress: `${state}: ${progress}` }); }
        catch (e: any) { this.log.warn(`No se pudo reportar progreso: ${e?.message ?? e}`); }
      },
      log: (m) => this.log.debug(`[${job.jobId}] ${m}`)
    };

    try {
      const maxAttempts = 3;
      let outcome: StepOutcome = { kind: "FAILED", error: "No se inició la automatización bancaria" };
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const adapter = this.makeAdapter();
        let pausedReason = "";
        try {
          outcome = await adapter.run(authorized, {
            ...hooks,
            onNeedsUser: async (reason) => { pausedReason = reason; }
          });
        } finally {
          try { await adapter.close(); } catch { /* ignore */ }
        }
        if (outcome.kind !== "NEEDS_USER") break;
        const reason = pausedReason || outcome.reason;
        if (remittanceRetryDecision(reason, attempt, maxAttempts) !== "RETRY") {
          this.log.warn(`[${job.jobId}] NEEDS_USER: ${reason}`);
          await this.hub.progress(job.jobId, "NEEDS_USER", { reason });
          break;
        }
        const delayMs = remittanceRetryDelayMs(attempt);
        this.log.warn(`[${job.jobId}] Fallo transitorio de acceso; reintento ${attempt + 1}/${maxAttempts} en ${delayMs / 1000}s.`);
        await this.hub.progress(job.jobId, "RUNNING", { progress: `Reintentando acceso a Santander (${attempt + 1}/${maxAttempts})` });
        await sleep(delayMs, () => this.stopped);
      }
      switch (outcome.kind) {
        case "PREPARED":
          // Doble barrera: el HUB volverá a exigir verifiedPendingSignature=true.
          await this.hub.completePrepared(job.jobId, outcome.resultRef);
          this.log.info(`[${job.jobId}] PREPARADO y pendiente de firma (sin firmar).`);
          break;
        case "NEEDS_USER":
          // Ya se reportó por hooks; el trabajo queda en pausa esperando intervención.
          this.log.info(`[${job.jobId}] En pausa (intervención requerida).`);
          break;
        case "FAILED":
          await this.hub.completeFailed(job.jobId, outcome.error);
          this.log.warn(`[${job.jobId}] FALLIDO: ${outcome.error}`);
          break;
        default:
          await this.hub.completeFailed(job.jobId, "Resultado desconocido del adaptador");
      }
    } catch (e: any) {
      this.log.error(`[${job.jobId}] Error no controlado: ${e?.message ?? e}`);
      try { await this.hub.completeFailed(job.jobId, `Error del agente: ${e?.message ?? e}`); } catch { /* ignore */ }
    } finally { /* cada intento libera su conexión CDP */ }
  }
}

function sleep(ms: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const step = 500;
    let waited = 0;
    const t = setInterval(() => {
      waited += step;
      if (cancelled() || waited >= ms) { clearInterval(t); resolve(); }
    }, step);
  });
}
