import { describe, expect, it, vi } from "vitest";
import {
  keepAndroidAwakeDuringAutomation,
  prepareAndroidForAutomation
} from "@/components/mobile/android-automation-ready";

describe("Android automation readiness", () => {
  it("wakes the device and dismisses only a non-secure keyguard before opening an app", async () => {
    const runCommand = vi.fn(async () => "");

    await prepareAndroidForAutomation(runCommand);

    expect(runCommand.mock.calls).toEqual([
      [["input", "keyevent", "KEYCODE_WAKEUP"]],
      [["wm", "dismiss-keyguard"]]
    ]);
  });

  it("keeps the screen awake only while an approved automation is running", async () => {
    const events: string[] = [];
    const runCommand = vi.fn(async (command: readonly string[]) => {
      events.push(command.join(" "));
      return command.join(" ") === "settings get global stay_on_while_plugged_in" ? "0\n" : "";
    });

    const result = await keepAndroidAwakeDuringAutomation(runCommand, async () => {
      events.push("automation");
      return 17;
    });

    expect(result).toBe(17);
    expect(events).toEqual([
      "settings get global stay_on_while_plugged_in",
      "settings put global stay_on_while_plugged_in 2",
      "automation",
      "settings put global stay_on_while_plugged_in 0"
    ]);
  });

  it("restores an unset stay-awake preference when automation fails", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) =>
      command.join(" ") === "settings get global stay_on_while_plugged_in" ? "null\n" : ""
    );

    await expect(keepAndroidAwakeDuringAutomation(runCommand, async () => {
      throw new Error("automation failed");
    })).rejects.toThrow("automation failed");

    expect(runCommand.mock.calls).toEqual([
      [["settings", "get", "global", "stay_on_while_plugged_in"]],
      [["settings", "put", "global", "stay_on_while_plugged_in", "2"]],
      [["settings", "delete", "global", "stay_on_while_plugged_in"]]
    ]);
  });
});
