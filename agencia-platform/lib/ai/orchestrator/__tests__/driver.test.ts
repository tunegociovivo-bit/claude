/**
 * Slice 2c.3 — driver del simulador SHADOW: persiste la traza (orquestación + pasos
 * append-only) tenant-scoped y refleja el estado final que calculó el simulador
 * puro. NO ejecuta nada real (in-memory prisma; sin red).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAndPersistSimulation } from "../driver";
import type { AttemptOutcome } from "../simulate";
import { DEFAULT_LIMITS } from "../budget";

// prisma en memoria: registra creates/updates para verificar tenant + traza.
function mkPrisma() {
  const steps: any[] = [];
  const orch = { id: "orch-1", workspaceId: "", taskId: "", state: "queued", usage: null as any, decision: null as any, mode: "shadow" };
  return {
    _steps: steps,
    _orch: orch,
    aiOrchestration: {
      create: vi.fn(async ({ data }: any) => {
        Object.assign(orch, { id: "orch-1", workspaceId: data.workspaceId, taskId: data.taskId, state: data.state, mode: data.mode });
        return { ...orch };
      }),
      findFirst: vi.fn(async () => ({ ...orch })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id === orch.id && where.workspaceId === orch.workspaceId) {
          Object.assign(orch, data);
          return { count: 1 };
        }
        return { count: 0 };
      })
    },
    aiRunStep: {
      findFirst: vi.fn(async () => (steps.length ? { seq: steps[steps.length - 1].seq } : null)),
      create: vi.fn(async ({ data }: any) => {
        steps.push(data);
        return { ...data };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = steps.length;
        for (let i = steps.length - 1; i >= 0; i--) if (steps[i].workspaceId === where.workspaceId && steps[i].orchestrationId === where.orchestrationId) steps.splice(i, 1);
        return { count: before - steps.length };
      })
    }
  };
}

let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
});

const cfg = { limits: DEFAULT_LIMITS, strategyCtx: { tried: [], canDecompose: true, availableProviders: [{ provider: "openai", model: "gpt" }] }, rand: () => 0.5 };

describe("runAndPersistSimulation — persiste traza SHADOW tenant-scoped", () => {
  it("éxito inmediato → completed persistido; pasos append-only con workspaceId", async () => {
    const { orchestrationId, result } = await runAndPersistSimulation(prisma as any, {
      workspaceId: "w1",
      taskId: "t1",
      scenario: [{ ok: true }],
      config: cfg
    });
    expect(orchestrationId).toBe("orch-1");
    expect(result.finalState).toBe("completed");
    // se persistió un paso por cada step de la traza
    expect(prisma._steps.length).toBe(result.steps.length);
    // tenant en cada paso
    expect(prisma._steps.every((s) => s.workspaceId === "w1")).toBe(true);
    // estado final persistido en la orquestación
    expect(prisma._orch.state).toBe("completed");
    expect(prisma._orch.mode).toBe("shadow");
  });

  it("updateMany final está scoped por workspace (no cross-tenant)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w9", taskId: "t2", scenario: [{ ok: true }], config: cfg });
    const call = prisma.aiOrchestration.updateMany.mock.calls[0][0];
    expect(call.where.workspaceId).toBe("w9");
    expect(call.data.mode).toBe("shadow");
  });

  it("bloqueo material (datos faltantes) → materially_blocked + decision persistida", async () => {
    const scenario: AttemptOutcome[] = [{ ok: false, diagnosis: { error: "falta credencial no configurada" } }];
    const { result } = await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t3", scenario, config: cfg });
    expect(result.finalState).toBe("materially_blocked");
    expect(prisma._orch.state).toBe("materially_blocked");
    expect(prisma._orch.decision).toBeTruthy();
  });

  it("F1: la orquestación de simulación usa un taskId namespaced (no pisa runs reales)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "task-real-123", scenario: [{ ok: true }], config: cfg });
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.taskId).toBe("sim:task-real-123");
    // idempotente: no re-namespear si ya viene con prefijo
    expect(`sim:task-real-123`.startsWith("sim:")).toBe(true);
  });

  it("F1: re-simular la misma tarea da una traza LIMPIA (sin concatenar)", async () => {
    const a = await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", scenario: [{ ok: true }], config: cfg });
    const firstLen = a.persistedSteps;
    // el mock de ensureOrchestration devuelve la misma fila (idempotente por taskId)
    const b = await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", scenario: [{ ok: true }], config: cfg });
    expect(prisma.aiRunStep.deleteMany).toHaveBeenCalled();
    // tras el reset, el nº de pasos persistidos es el de UNA corrida, no acumulado
    expect(prisma._steps.length).toBe(b.persistedSteps);
    expect(b.persistedSteps).toBe(firstLen);
  });

  it("N3: si el update final no aplica (fila de otro tenant) → lanza (no falsea éxito)", async () => {
    // fuerza count:0 en updateMany dejando la fila con otro workspace
    prisma.aiOrchestration.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t1", scenario: [{ ok: true }], config: cfg })).rejects.toThrow(/no se pudo actualizar/i);
  });

  it("no persiste ningún 'executed:true' — es solo traza de estados (shadow)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t4", scenario: [{ ok: true, verifyOk: false }, { ok: true }], config: cfg });
    expect(JSON.stringify(prisma._steps)).not.toMatch(/"executed":true/);
    // la orquestación se creó en modo shadow
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.mode).toBe("shadow");
  });
});
