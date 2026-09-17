import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForMobileAuthentication } from "../mobile-adb-authentication";

afterEach(() => vi.useRealTimers());

describe("bounded USB negotiation", () => {
  it("returns a trusted connection without closing it", async () => {
    const transport = { close: vi.fn(async () => undefined) };
    const controller = new AbortController();
    await expect(waitForMobileAuthentication(Promise.resolve(transport), { signal: controller.signal, approvalRequested: () => false })).resolves.toBe(transport);
    controller.abort();
    expect(transport.close).not.toHaveBeenCalled();
  });

  it.each([false, true])("times out without inventing an approval request (requested=%s)", async requested => {
    vi.useFakeTimers();
    const pending = waitForMobileAuthentication(new Promise<{ close: () => Promise<void> }>(() => {}), {
      signal: new AbortController().signal, approvalRequested: () => requested
    });
    const assertion = expect(pending).rejects.toThrow(requested ? "Android no ha confirmado" : "No se ha recibido una petición");
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels promptly and closes a transport that arrives after cancellation", async () => {
    let resolve!: (value: { close: () => Promise<void> }) => void;
    const source = new Promise<{ close: () => Promise<void> }>(done => { resolve = done; });
    const controller = new AbortController();
    const pending = waitForMobileAuthentication(source, { signal: controller.signal, approvalRequested: () => false });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const close = vi.fn(async () => undefined);
    resolve({ close });
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
});
