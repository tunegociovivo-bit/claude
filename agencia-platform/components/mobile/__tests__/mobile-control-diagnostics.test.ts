import { describe, expect, it, vi } from "vitest";
import { mobileControlPermissionError, readMobileControlOutput } from "@/components/mobile/mobile-control-diagnostics";

describe("Android control diagnostics", () => {
  it("explains the device permission error instead of silently ignoring input", () => {
    expect(mobileControlPermissionError("java.lang.SecurityException: Injecting input events requires the INJECT_EVENTS permission"))
      .toContain("bloqueando las pulsaciones");
    expect(mobileControlPermissionError("[server] INFO: Device: Xiaomi Mi 10")).toBeNull();
  });
  it("drains server output and reports only actionable input errors", async () => {
    const report = vi.fn();
    const output = new ReadableStream<string>({ start(controller) {
      controller.enqueue("[server] INFO: started");
      controller.enqueue("INJECT_EVENTS permission denied");
      controller.close();
    } });
    await readMobileControlOutput(output, report);
    expect(report).toHaveBeenCalledOnce();
    expect(output.locked).toBe(false);
  });
});
