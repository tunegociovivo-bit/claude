/**
 * Contrato FASE 2 · objetivo 6 — poller sin solapamiento y pausable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPoller } from "../poller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createPoller", () => {
  it("no arranca hasta start(); luego dispara cada intervalo", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ intervalMs: 1000, task });
    expect(task).not.toHaveBeenCalled();
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("immediate dispara una vez al arrancar", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ intervalMs: 1000, task, immediate: true });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("SIN SOLAPAMIENTO: una tarea lenta no se solapa con la siguiente", async () => {
    let resolve!: () => void;
    const task = vi.fn().mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const p = createPoller({ intervalMs: 1000, task });
    p.start();
    await vi.advanceTimersByTimeAsync(1000); // dispara la 1ª (queda pendiente)
    expect(task).toHaveBeenCalledTimes(1);
    // Aunque pase mucho más que el intervalo, NO se lanza otra mientras la 1ª sigue.
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
    // Al terminar la 1ª, se reprograma y a intervalo dispara la 2ª.
    resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("pause() detiene los ticks; resume() los reanuda", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ intervalMs: 1000, task });
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    p.pause();
    expect(p.isPaused()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1); // pausado: nada
    p.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("resume({runNow:true}) dispara inmediatamente al volver la pestaña", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ intervalMs: 10_000, task });
    p.start();
    p.pause();
    p.resume({ runNow: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("stop() cancela y no vuelve a disparar", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ intervalMs: 1000, task });
    p.start();
    p.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).not.toHaveBeenCalled();
    expect(p.isStopped()).toBe(true);
  });

  it("un error en la tarea no rompe el poller (onError + sigue)", async () => {
    const onError = vi.fn();
    const task = vi.fn().mockRejectedValue(new Error("boom"));
    const p = createPoller({ intervalMs: 1000, task, onError });
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2); // se reprogramó pese al error
    p.stop();
  });
});
