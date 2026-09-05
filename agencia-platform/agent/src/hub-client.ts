/**
 * Cliente HTTPS del HUB. Solo salidas HTTPS al HUB de Negocio Vivo, autenticadas
 * con el token del agente (Bearer). No expone ni almacena secretos del banco.
 *
 * Contratos (ver app/api/v1/facturacion/agent/*):
 *   POST /heartbeat                       { version, platform } → { ok }
 *   POST /claim                           → { job } | { job: null }
 *   POST /jobs/:id/progress               { state, progress?, reason? }
 *   POST /jobs/:id/complete               { result, verifiedPendingSignature?, resultRef?, error? }
 */
import type { AgentConfig } from "./config.js";

export interface ClaimedJob {
  jobId: string;
  invoiceNumber: string | null;
  clientName: string;
  amountCents: number;
  currency: string;
  mandateRef: string | null;
  ibanMasked: string | null;
  santanderTemplate: string | null;
  leaseUntil: string;
}

export interface ReconciliationConfig {
  enabled: boolean;
  startsAt: string;
  dailyAt: string;
  timeZone: string;
  lastSyncAt: string | null;
  retryAttempts: number;
  lastFailureAt: string | null;
  forceRequestedAt: string | null;
}

export class HubClient {
  constructor(private cfg: AgentConfig) {}

  private base(path: string): string {
    return `${this.cfg.hubUrl}/api/v1/facturacion/agent${path}`;
  }

  private async post(path: string, body?: any): Promise<{ status: number; json: any }> {
    const url = this.base(path);
    if (!url.startsWith("https://")) throw new Error("El HUB debe ser HTTPS");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.agentToken}`
      },
      body: body ? JSON.stringify(body) : "{}"
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  private async get(path: string): Promise<{ status: number; json: any }> {
    const res = await fetch(this.base(path), { headers: { Authorization: `Bearer ${this.cfg.agentToken}` } });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  async heartbeat(): Promise<boolean> {
    const { status } = await this.post("/heartbeat", { version: this.cfg.version, platform: process.platform });
    return status === 200;
  }

  /** Reclama el siguiente trabajo. null si no hay o si el kill switch está apagado. */
  async claim(): Promise<ClaimedJob | null> {
    const { status, json } = await this.post("/claim");
    if (status !== 200) throw new Error(`claim falló (${status})`);
    return (json?.job as ClaimedJob | null) ?? null;
  }

  async progress(jobId: string, state: "RUNNING" | "NEEDS_USER", opts?: { progress?: string; reason?: string }): Promise<void> {
    const { status, json } = await this.post(`/jobs/${jobId}/progress`, { state, progress: opts?.progress, reason: opts?.reason });
    if (status !== 200) throw new Error(`progress falló (${status}): ${json?.error?.message ?? ""}`);
  }

  /** Cierra como PREPARADO PENDIENTE DE FIRMA. Exige verificación visible previa. */
  async completePrepared(jobId: string, resultRef?: string): Promise<void> {
    const { status, json } = await this.post(`/jobs/${jobId}/complete`, {
      result: "PREPARED_PENDING_SIGNATURE",
      verifiedPendingSignature: true,
      resultRef
    });
    if (status !== 200) throw new Error(`complete(prepared) falló (${status}): ${json?.error?.message ?? ""}`);
  }

  async completeFailed(jobId: string, error: string): Promise<void> {
    const { status } = await this.post(`/jobs/${jobId}/complete`, { result: "FAILED", error });
    if (status !== 200) throw new Error(`complete(failed) falló (${status})`);
  }

  async reconciliationConfig(): Promise<ReconciliationConfig | null> {
    const { status, json } = await this.get("/reconciliation/config");
    return status === 200 ? json as ReconciliationConfig : null;
  }

  async reportMovements(movements: any[]): Promise<{ imported: number; matched: number }> {
    const { status, json } = await this.post("/reconciliation/transactions", { movements });
    if (status !== 200) throw new Error(`reconciliation falló (${status})`);
    return { imported: Number(json.imported ?? 0), matched: Number(json.matched ?? 0) };
  }

  async reportReconciliationFailure(reason: string): Promise<{ attempts: number; notified: boolean }> {
    const { status, json } = await this.post("/reconciliation/failure", { reason });
    if (status !== 200) throw new Error(`reconciliation failure report falló (${status})`);
    return { attempts: Number(json.attempts ?? 0), notified: Boolean(json.notified) };
  }
}
