import { describe, expect, it, vi } from "vitest";
import { mobileWorkerActivity, runWhileConnected } from "../mobile-worker-activity";

describe("recuperación de actividad tras perder USB", () => {
  it("recupera una tarea del servidor sin fingir que ya está ejecutándose", () => {
    expect(mobileWorkerActivity(false, [{ status: "RUNNING" }])).toBe("recovering");
    expect(mobileWorkerActivity(true, [{ status: "RUNNING" }])).toBe("working");
    expect(mobileWorkerActivity(false, [{ status: "QUEUED" }])).toBe("queued");
    expect(mobileWorkerActivity(false, [{ status: "COMPLETED" }])).toBe("idle");
    expect(mobileWorkerActivity(false, [{ status: "FAILED" }])).toBe("idle");
  });
  it("libera una ejecución bloqueada al desaparecer USB", async () => {
    const controller = new AbortController();
    const run = vi.fn(() => new Promise<void>(() => {}));
    const pending = runWhileConnected(controller.signal, run);
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    controller.abort();
    await expect(pending).rejects.toThrow(/USB/);
  });
  it("no empieza una acción si el móvil desapareció durante el claim", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn();
    await expect(runWhileConnected(controller.signal, run)).rejects.toThrow(/USB/);
    expect(run).not.toHaveBeenCalled();
  });
  it("conserva el resultado cuando no se pierde la conexión", async () => {
    await expect(runWhileConnected(new AbortController().signal, async () => "ok")).resolves.toBe("ok");
  });
  it("una respuesta tardía no revive la ejecución que perdió USB", async () => {
    const controller = new AbortController();
    let finish!: (result: string) => void;
    const pending = runWhileConnected(controller.signal, () => new Promise<string>(resolve => { finish = resolve; }));
    await Promise.resolve();
    controller.abort();
    finish("terminado tarde");
    await expect(pending).rejects.toThrow(/USB/);
  });
});
