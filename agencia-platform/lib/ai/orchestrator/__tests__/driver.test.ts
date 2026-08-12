/**
 * Slice 2c.3 — driver del simulador SHADOW: persiste la traza (orquestación + pasos
 * append-only) tenant-scoped, atómica (transacción con claim por versión) y refleja
 * el estado final que calculó el simulador puro. NO ejecuta nada real (in-memory
 * prisma; sin red).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAndPersistSimulation, ConcurrentSimulationError } from "../driver";
import type { AttemptOutcome } from "../simulate";
import { DEFAULT_LIMITS } from "../budget";

// prisma en memoria version-aware: modela el optimistic locking real (updateMany con
// guard de `version`) y $transaction (interactiva → mismo store).
function mkPrisma() {
  const steps: any[] = [];
  const orch: any = { id: "orch-1", workspaceId: "", taskId: "", state: "queued", usage: null, decision: null, mode: "shadow", version: 0, createdById: null };
  const self: any = {
    _steps: steps,
    _orch: orch,
    aiOrchestration: {
      create: vi.fn(async ({ data }: any) => {
        Object.assign(orch, { id: "orch-1", workspaceId: data.workspaceId, taskId: data.taskId, state: data.state, mode: data.mode, version: data.version ?? 0, createdById: data.createdById ?? null });
        return { ...orch };
      }),
      findFirst: vi.fn(async () => ({ ...orch })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const tenantOk = where.id === orch.id && where.workspaceId === orch.workspaceId;
        const versionOk = where.version === undefined || where.version === orch.version;
        if (tenantOk && versionOk) {
          Object.assign(orch, data);
          return { count: 1 };
        }
        return { count: 0 };
      })
    },
    aiRunStep: {
      findFirst: vi.fn(async () => (steps.length ? { seq: steps[steps.length - 1].seq } : null)),
      create: vi.fn(async ({ data }: any) => {
        if (steps.some((s) => s.orchestrationId === data.orchestrationId && s.seq === data.seq)) {
          const e: any = new Error("unique"); e.code = "P2002"; throw e;
        }
        steps.push(data);
        return { ...data };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = steps.length;
        for (let i = steps.length - 1; i >= 0; i--) if (steps[i].workspaceId === where.workspaceId && steps[i].orchestrationId === where.orchestrationId) steps.splice(i, 1);
        return { count: before - steps.length };
      })
    },
    $transaction: vi.fn(async (fn: any) => fn(self))
  };
  return self;
}

let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
});

const cfg = { limits: DEFAULT_LIMITS, strategyCtx: { tried: [], canDecompose: true, availableProviders: [{ provider: "openai", model: "gpt" }] }, rand: () => 0.5 };

describe("runAndPersistSimulation — persiste traza SHADOW tenant-scoped y atómica", () => {
  it("éxito inmediato → completed persistido; pasos append-only con workspaceId", async () => {
    const { orchestrationId, result, persistedSteps } = await runAndPersistSimulation(prisma as any, {
      workspaceId: "w1",
      taskId: "t1",
      scenario: [{ ok: true }],
      config: cfg
    });
    expect(orchestrationId).toBe("orch-1");
    expect(result.finalState).toBe("completed");
    expect(persistedSteps).toBe(result.steps.length);
    expect(prisma._steps.length).toBe(result.steps.length);
    expect(prisma._steps.every((s: any) => s.workspaceId === "w1")).toBe(true);
    expect(prisma._orch.state).toBe("completed");
    expect(prisma._orch.mode).toBe("shadow");
    // versión avanzó por el claim + update final (0 → 2)
    expect(prisma._orch.version).toBe(2);
    // todo ocurrió dentro de una transacción
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("updateMany final está scoped por workspace (no cross-tenant)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w9", taskId: "t2", scenario: [{ ok: true }], config: cfg });
    const finalCall = prisma.aiOrchestration.updateMany.mock.calls.at(-1)![0];
    expect(finalCall.where.workspaceId).toBe("w9");
    expect(finalCall.data.mode).toBe("shadow");
  });

  it("persiste createdById (auditoría de quién lanzó la simulación)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", createdById: "u42", scenario: [{ ok: true }], config: cfg });
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.createdById).toBe("u42");
  });

  it("bloqueo material (datos faltantes) → materially_blocked + decision persistida", async () => {
    const scenario: AttemptOutcome[] = [{ ok: false, diagnosis: { error: "falta credencial no configurada" } }];
    const { result } = await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t3", scenario, config: cfg });
    expect(result.finalState).toBe("materially_blocked");
    expect(prisma._orch.state).toBe("materially_blocked");
    expect(prisma._orch.decision).toBeTruthy();
  });

  it("F1: taskId namespaced (no pisa runs reales)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "task-real-123", scenario: [{ ok: true }], config: cfg });
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.taskId).toBe("sim:task-real-123");
  });

  it("F1: re-simular la misma tarea da una traza LIMPIA (sin concatenar)", async () => {
    const a = await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", scenario: [{ ok: true }], config: cfg });
    const b = await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", scenario: [{ ok: true }], config: cfg });
    expect(prisma.aiRunStep.deleteMany).toHaveBeenCalled();
    expect(prisma._steps.length).toBe(b.persistedSteps);
    expect(b.persistedSteps).toBe(a.persistedSteps);
  });

  it("M2: claim con versión desactualizada (carrera) → ConcurrentSimulationError, rollback", async () => {
    // simula que otro proceso ya avanzó la versión entre el read y el claim
    prisma.aiOrchestration.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await expect(runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", scenario: [{ ok: true }], config: cfg })).rejects.toBeInstanceOf(ConcurrentSimulationError);
  });

  it("M2: todo va dentro de $transaction (atomicidad)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", scenario: [{ ok: true, verifyOk: false }, { ok: true }], config: cfg });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("no persiste ningún 'executed:true' — es solo traza de estados (shadow)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t4", scenario: [{ ok: true, verifyOk: false }, { ok: true }], config: cfg });
    expect(JSON.stringify(prisma._steps)).not.toMatch(/"executed":true/);
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.mode).toBe("shadow");
  });
});
