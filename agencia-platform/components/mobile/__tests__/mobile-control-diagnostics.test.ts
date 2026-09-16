import { describe, expect, it, vi } from "vitest";
import { discardMobileClipboard, mobileControlPermissionError, readMobileControlOutput } from "@/components/mobile/mobile-control-diagnostics";

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
  it("drains clipboard backpressure so following paste acknowledgements can arrive", async () => {
    const channel = new TransformStream<string, string>();
    const writer = channel.writable.getWriter();
    const acknowledged = vi.fn();
    const messages = (async () => {
      await writer.write("first clipboard notification");
      await writer.write("second clipboard notification");
      acknowledged();
      await writer.close();
    })();
    await Promise.all([discardMobileClipboard(channel.readable), messages]);
    expect(acknowledged).toHaveBeenCalledOnce();
    expect(channel.readable.locked).toBe(false);
  });
});
