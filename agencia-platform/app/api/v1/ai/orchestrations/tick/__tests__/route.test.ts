/**
 * Cron entrypoint /tick — auth de cron fail-closed, flag off, y agregado del lote.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { runBatchMock } = vi.hoisted(() => ({ runBatchMock: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/orchestrator/scheduler", () => ({ buildRunStep: () => async () => ({ to: "completed" }) }));
vi.mock("@/lib/ai/orchestrator/worker", () => ({ runBatch: runBatchMock }));
vi.mock("@/lib/ai/orchestrator/store", () => ({ getOrchestration: async () => null }));

import { POST } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_RUN_ORCHESTRATOR = "on";
  process.env.INTERNAL_CRON_TOKEN = "tok-123";
  delete process.env.CRON_SECRET;
  runBatchMock.mockResolvedValue({ claimed: 2, advanced: 2, completed: 1, parked: 1, terminal: 1, errors: 0, steps: 5 });
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = (headers: Record<string, string> = {}) => POST(new Request("https://h/api/v1/ai/orchestrations/tick", { method: "POST", headers }));

describe("POST /tick", () => {
  it("sin token en la petición → 401 (fail-closed)", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(runBatchMock).not.toHaveBeenCalled();
  });
  it("token incorrecto → 401", async () => {
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
  });
  it("sin token configurado en el entorno → 401 (fail-closed)", async () => {
    delete process.env.INTERNAL_CRON_TOKEN;
    expect((await call({ authorization: "Bearer tok-123" })).status).toBe(401);
  });
  it("flag off → no procesa nada (disabled)", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "off";
    const res = await call({ authorization: "Bearer tok-123" });
    const body = await res.json();
    expect(body.disabled).toBe(true);
    expect(runBatchMock).not.toHaveBeenCalled();
  });
  it("auth ok + flag on → procesa lote y devuelve agregado (sin PII)", async () => {
    const res = await call({ authorization: "Bearer tok-123" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.batch.completed).toBe(1);
    expect(runBatchMock).toHaveBeenCalledOnce();
    // el agregado no contiene texto/PII, solo contadores
    expect(JSON.stringify(body.batch)).not.toMatch(/[a-z]+@[a-z]+/i);
  });
  it("también acepta x-cron-secret", async () => {
    expect((await call({ "x-cron-secret": "tok-123" })).status).toBe(200);
  });
});
