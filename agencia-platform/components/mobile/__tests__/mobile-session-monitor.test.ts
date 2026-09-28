import { describe, expect, it, vi } from "vitest";
import { createMobileSessionMonitor } from "../mobile-session-monitor";

describe("mobile session transport monitor", () => {
  it("ends a session on USB failure without waiting for the video stream", async () => {
    const onEnd = vi.fn();
    const monitor = createMobileSessionMonitor(() => true, onEnd);
    const error = new Error("transferOut failed");
    monitor.observe(new Promise(() => undefined), "Video ended");
    monitor.observe(Promise.reject(error), "ADB ended");
    await Promise.resolve();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("ends a session when video finishes without throwing", async () => {
    const onEnd = vi.fn();
    createMobileSessionMonitor(() => true, onEnd).observe(Promise.resolve(), "Video ended");
    await Promise.resolve();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(new Error("Video ended"));
  });

  it("does not restart cleanup for cascading transport and video failures", async () => {
    const onEnd = vi.fn();
    const monitor = createMobileSessionMonitor(() => true, onEnd);
    monitor.observe(Promise.reject(new Error("USB failed")), "ADB ended");
    monitor.observe(Promise.reject(new Error("Video failed")), "Video ended");
    await Promise.resolve();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("consumes an old session rejection without affecting its replacement", async () => {
    let current = true;
    const onEnd = vi.fn();
    let reject!: (error: Error) => void;
    const disconnected = new Promise<void>((_, fail) => { reject = fail; });
    createMobileSessionMonitor(() => current, onEnd).observe(disconnected, "ADB ended");
    current = false;
    reject(new Error("Old USB connection ended"));
    await Promise.resolve();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
