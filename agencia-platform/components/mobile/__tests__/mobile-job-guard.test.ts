import { describe, expect, it } from "vitest";
import { abortMobileJob, clearMobileJob, guardDependencies } from "../mobile-job-guard";

describe("vigilancia de trabajos", () => {
  it("un reintento nuevo no resucita las acciones de la ejecución anterior", async () => {
    clearMobileJob("generation");
    const old = guardDependencies("generation", { tap: async () => {} });
    abortMobileJob("generation");
    clearMobileJob("generation");
    await expect(old.tap()).rejects.toThrow(/detenido/);
    const current = guardDependencies("generation", { tap: async () => "ok" });
    await expect(current.tap()).resolves.toBe("ok");
  });
  it("corta una acción colgada", async () => {
    const deps = guardDependencies("j1", { read: () => new Promise<string>(() => {}) }, 20);
    await expect(deps.read()).rejects.toThrow(/no ha respondido/);
  });
  it("no deja seguir a un trabajo abortado", async () => {
    let taps = 0;
    const deps = guardDependencies("j2", { tap: async () => { taps += 1; } });
    await deps.tap();
    abortMobileJob("j2");
    await expect(deps.tap()).rejects.toThrow(/detenido/);
    expect(taps).toBe(1);
    clearMobileJob("j2");
  });
});
