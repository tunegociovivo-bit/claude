import { describe, expect, it, vi } from "vitest";
import { runManualInvoiceProcessors } from "../manual-run";

describe("ejecución manual de facturas de gestoría", () => {
  it("espera a que todos los descargadores terminen antes de responder", async () => {
    const completed: string[] = [];
    let releaseGoogle!: () => void;
    const googlePending = new Promise<void>((resolve) => { releaseGoogle = resolve; });
    const processors = [
      vi.fn(async () => { completed.push("holded"); }),
      vi.fn(async () => { await googlePending; completed.push("google"); }),
      vi.fn(async () => { completed.push("meta"); })
    ];

    let resolved = false;
    const execution = runManualInvoiceProcessors("run-1", processors).then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    releaseGoogle();
    await execution;

    for (const processor of processors) expect(processor).toHaveBeenCalledWith("run-1");
    expect(completed.sort()).toEqual(["google", "holded", "meta"]);
  });

  it("propaga el fallo del descargador para que la API no deje un PENDING silencioso", async () => {
    await expect(runManualInvoiceProcessors("run-2", [async () => { throw new Error("fallo controlado"); }]))
      .rejects.toThrow("fallo controlado");
  });
});
