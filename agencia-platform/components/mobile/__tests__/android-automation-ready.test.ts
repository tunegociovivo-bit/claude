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

  it("attempts to restore the preference when enabling stay-awake fails", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      if (serialized === "settings get global stay_on_while_plugged_in") return "1\n";
      if (serialized === "settings put global stay_on_while_plugged_in 3") {
        throw new Error("activation response lost");
      }
      return "";
    });
    const automation = vi.fn(async () => "done");

    await expect(keepAndroidAwakeDuringAutomation(runCommand, automation))
      .rejects.toThrow("activation response lost");

    expect(automation).not.toHaveBeenCalled();
    expect(runCommand.mock.calls).toEqual([
      [["settings", "get", "global", "stay_on_while_plugged_in"]],
      [["settings", "put", "global", "stay_on_while_plugged_in", "3"]],
      [["settings", "put", "global", "stay_on_while_plugged_in", "1"]]
    ]);
  });

  it("preserves a completed automation result if restoring the preference fails", async () => {
    const restoreError = new Error("restore failed");
    const reportRestoreError = vi.fn();
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      if (serialized === "settings get global stay_on_while_plugged_in") return "0\n";
      if (serialized === "settings put global stay_on_while_plugged_in 0") throw restoreError;
      return "";
    });

    const result = await keepAndroidAwakeDuringAutomation(
      runCommand,
      async () => "completed",
      reportRestoreError
    );

    expect(result).toBe("completed");
    expect(reportRestoreError).toHaveBeenCalledWith(restoreError);
  });

  it("preserves the automation error if restoring the preference also fails", async () => {
    const automationError = new Error("automation failed");
    const restoreError = new Error("restore failed");
    const reportRestoreError = vi.fn();
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      if (serialized === "settings get global stay_on_while_plugged_in") return "0\n";
      if (serialized === "settings put global stay_on_while_plugged_in 0") throw restoreError;
      return "";
    });

    await expect(keepAndroidAwakeDuringAutomation(
      runCommand,
      async () => { throw automationError; },
      reportRestoreError
    )).rejects.toBe(automationError);

    expect(reportRestoreError).toHaveBeenCalledWith(restoreError);
  });
});
