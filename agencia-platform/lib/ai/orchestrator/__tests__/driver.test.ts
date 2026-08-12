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

  it("no persiste ningún 'executed:true' — es solo traza de estados (shadow)", async () => {
    await runAndPersistSimulation(prisma as any, { workspaceId: "w1", taskId: "t4", scenario: [{ ok: true, verifyOk: false }, { ok: true }], config: cfg });
    expect(JSON.stringify(prisma._steps)).not.toMatch(/"executed":true/);
    // la orquestación se creó en modo shadow
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.mode).toBe("shadow");
  });
});
