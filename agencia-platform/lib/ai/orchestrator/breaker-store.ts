/**
 * Circuit breaker DURABLE cross-proceso (Postgres), por (workspace, proveedor).
 *
 * La FILA es el lock: la sonda half-open se reclama con un `updateMany` guardado por
 * `version` → entre N instancias, solo UNA obtiene la sonda (single-probe). Un lease de
 * sonda expirado se re-reclama (recuperación). El registro éxito/fallo es IDEMPOTENTE
 * por `attemptToken`. FAIL-CLOSED: ante cualquier error de BD, el gate NO deja pasar
 * (protege al proveedor) y `peekBlocked` devuelve `true`.
 *
 * No usa Redis. Compatible con la máquina pura `circuit-breaker.ts` (misma semántica),
 * que se conserva para tests puros.
 */
import { type BreakerConfig, DEFAULT_BREAKER } from "./circuit-breaker";

type PrismaLike = any;

export type BreakerRow = {
  workspaceId: string;
  provider: string;
  state: "closed" | "open" | "half_open";
  failureCount: number;
  windowStartedAt: Date | null;
  openedAt: Date | null;
  lastFailureAt: Date | null;
  lastAttemptToken: string | null;
  probeOwner: string | null;
  probeExpiresAt: Date | null;
  version: number;
};

export type PassResult = { pass: boolean; probe: boolean };

export interface DurableBreaker {
  /** ¿Bloqueado ahora? (open sin cooldown cumplido, o half-open con sonda viva). Para
   *  que el routing excluya el proveedor. Fail-closed: error BD → true (bloqueado). */
  peekBlocked(workspaceId: string, provider: string, now: Date): Promise<boolean>;
  /** Intenta pasar; si procede una sonda, la RECLAMA atómicamente (single-probe).
   *  Fail-closed: error BD → { pass:false }. */
  tryPass(workspaceId: string, provider: string, owner: string, now: Date): Promise<PassResult>;
  /** Registra el resultado REAL de un intento (idempotente por `attemptToken`).
   *  Best-effort: error BD se traga (el gate ya es fail-closed). */
  record(workspaceId: string, provider: string, ok: boolean, now: Date, attemptToken: string): Promise<void>;
}

const liveProbe = (row: Pick<BreakerRow, "probeOwner" | "probeExpiresAt">, now: Date): boolean =>
  !!(row.probeOwner && row.probeExpiresAt && row.probeExpiresAt.getTime() > now.getTime());

const cooldownElapsed = (openedAt: Date | null, now: Date, cfg: BreakerConfig): boolean =>
  openedAt != null && now.getTime() - openedAt.getTime() >= cfg.cooldownMs;

export function makeDbBreaker(prisma: PrismaLike, cfg: BreakerConfig = DEFAULT_BREAKER, probeLeaseMs = 60_000): DurableBreaker {
  const load = (workspaceId: string, provider: string): Promise<BreakerRow | null> =>
    prisma.aiProviderBreaker.findFirst({ where: { workspaceId, provider } });

  async function peekBlocked(workspaceId: string, provider: string, now: Date): Promise<boolean> {
    try {
      const row = await load(workspaceId, provider);
      if (!row || row.state === "closed") return false;
      if (row.state === "open") {
        // Bloqueado si aún enfría, o si hay una sonda viva de otro.
        return !cooldownElapsed(row.openedAt, now, cfg) || liveProbe(row, now);
      }
      // half_open: bloqueado solo si la sonda está viva (si expiró, es reclamable).
      return liveProbe(row, now);
    } catch {
      return true; // fail-closed
    }
  }

  async function tryPass(workspaceId: string, provider: string, owner: string, now: Date): Promise<PassResult> {
    try {
      const row = await load(workspaceId, provider);
      if (!row || row.state === "closed") return { pass: true, probe: false };

      if (row.state === "open") {
        if (!cooldownElapsed(row.openedAt, now, cfg)) return { pass: false, probe: false };
        if (liveProbe(row, now)) return { pass: false, probe: false };
        // Cooldown cumplido y sin sonda viva → intenta reclamar la ÚNICA sonda.
        return await claimProbe(workspaceId, provider, owner, now, row.version, "open");
      }
      // half_open
      if (liveProbe(row, now)) return { pass: false, probe: false };
      return await claimProbe(workspaceId, provider, owner, now, row.version, "half_open");
    } catch {
      return { pass: false, probe: false }; // fail-closed
    }
  }

  async function claimProbe(workspaceId: string, provider: string, owner: string, now: Date, version: number, fromState: "open" | "half_open"): Promise<PassResult> {
    const res = await prisma.aiProviderBreaker.updateMany({
      where: {
        workspaceId,
        provider,
        version,
        state: fromState,
        OR: [{ probeOwner: null }, { probeExpiresAt: { lte: now } }]
      },
      data: { state: "half_open", probeOwner: owner, probeExpiresAt: new Date(now.getTime() + probeLeaseMs), version: version + 1 }
    });
    return res.count === 1 ? { pass: true, probe: true } : { pass: false, probe: false };
  }

  function computeNext(row: BreakerRow | null, ok: boolean, now: Date, token: string): Partial<BreakerRow> {
    if (ok) {
      // Éxito → cierra el circuito (idempotente).
      return { state: "closed", failureCount: 0, windowStartedAt: null, openedAt: null, probeOwner: null, probeExpiresAt: null, lastAttemptToken: token };
    }
    // Fallo. Prune de la ventana.
    const windowExpired = !row || !row.windowStartedAt || now.getTime() - row.windowStartedAt.getTime() >= cfg.windowMs;
    const windowStartedAt = windowExpired ? now : row!.windowStartedAt;
    const failureCount = (windowExpired ? 0 : row!.failureCount) + 1;
    // Un fallo en half_open (sonda) re-abre inmediatamente.
    if (row?.state === "half_open") {
      return { state: "open", failureCount, windowStartedAt, openedAt: now, lastFailureAt: now, probeOwner: null, probeExpiresAt: null, lastAttemptToken: token };
    }
    if (failureCount >= cfg.failureThreshold) {
      return { state: "open", failureCount, windowStartedAt, openedAt: now, lastFailureAt: now, probeOwner: null, probeExpiresAt: null, lastAttemptToken: token };
    }
    return { state: "closed", failureCount, windowStartedAt, openedAt: null, lastFailureAt: now, lastAttemptToken: token };
  }

  async function record(workspaceId: string, provider: string, ok: boolean, now: Date, attemptToken: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const row = await load(workspaceId, provider);
        if (row && row.lastAttemptToken === attemptToken) return; // idempotente
        const next = computeNext(row, ok, now, attemptToken);
        if (!row) {
          try {
            await prisma.aiProviderBreaker.create({ data: { workspaceId, provider, version: 0, ...next } });
            return;
          } catch (e: any) {
            if (e?.code === "P2002") continue; // otra instancia la creó → reintenta como update
            throw e;
          }
        }
        const res = await prisma.aiProviderBreaker.updateMany({
          where: { workspaceId, provider, version: row.version },
          data: { ...next, version: row.version + 1 }
        });
        if (res.count === 1) return;
        // conflicto de versión (otra instancia) → reintenta
      } catch {
        return; // best-effort: el gate ya es fail-closed
      }
    }
  }

  return { peekBlocked, tryPass, record };
}
