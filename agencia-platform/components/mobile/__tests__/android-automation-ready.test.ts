import { describe, expect, it, vi } from "vitest";
import { prepareAndroidForAutomation } from "@/components/mobile/android-automation-ready";

describe("Android automation readiness", () => {
  it("wakes the device and dismisses only a non-secure keyguard before opening an app", async () => {
    const runCommand = vi.fn(async () => "");

    await prepareAndroidForAutomation(runCommand);

    expect(runCommand.mock.calls).toEqual([
      [["input", "keyevent", "KEYCODE_WAKEUP"]],
      [["wm", "dismiss-keyguard"]]
    ]);
  });
});
