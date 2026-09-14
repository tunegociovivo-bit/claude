import { describe, expect, it, vi } from "vitest";
import {
  createAndroidAwakeSession,
  keepAndroidAwakeDuringAutomation,
  prepareAndroidForAutomation,
  startAndroidAwakeSession
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
      if (command.join(" ") === "settings get global stay_on_while_plugged_in") return "0\n";
      if (command.join(" ") === "settings get system screen_off_timeout") return "15000\n";
      return "";
    });

    const result = await keepAndroidAwakeDuringAutomation(runCommand, async () => {
      events.push("automation");
      return 17;
    });

    expect(result).toBe(17);
    expect(events).toEqual([
      "settings get global stay_on_while_plugged_in",
      "settings get system screen_off_timeout",
      "settings put global stay_on_while_plugged_in 2",
      "settings put system screen_off_timeout 3600000",
      "input keyevent KEYCODE_WAKEUP",
      "automation",
      "settings put system screen_off_timeout 15000",
      "settings put global stay_on_while_plugged_in 0"
    ]);
  });

  it("keeps the screen awake from session start until the session is explicitly restored", async () => {
    const events: string[] = [];
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      events.push(serialized);
      if (serialized === "settings get global stay_on_while_plugged_in") return "0\n";
      if (serialized === "settings get system screen_off_timeout") return "15000\n";
      return "";
    });

    const session = await startAndroidAwakeSession(runCommand);

    expect(events).toEqual([
      "settings get global stay_on_while_plugged_in",
      "settings get system screen_off_timeout",
      "settings put global stay_on_while_plugged_in 2",
      "settings put system screen_off_timeout 3600000",
      "input keyevent KEYCODE_WAKEUP"
    ]);

    await session.restore();
    await session.restore();

    expect(events).toEqual([
      "settings get global stay_on_while_plugged_in",
      "settings get system screen_off_timeout",
      "settings put global stay_on_while_plugged_in 2",
      "settings put system screen_off_timeout 3600000",
      "input keyevent KEYCODE_WAKEUP",
      "settings put system screen_off_timeout 15000",
      "settings put global stay_on_while_plugged_in 0"
    ]);
  });

  it("makes concurrent restore calls wait for the same cleanup", async () => {
    let releaseTimeoutRestore: (() => void) | undefined;
    const timeoutRestoreGate = new Promise<void>((resolve) => {
      releaseTimeoutRestore = resolve;
    });
    const events: string[] = [];
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      events.push(serialized);
      if (serialized === "settings get global stay_on_while_plugged_in") return "0\n";
      if (serialized === "settings get system screen_off_timeout") return "15000\n";
      if (serialized === "settings put system screen_off_timeout 15000") {
        await timeoutRestoreGate;
      }
      return "";
    });
    const session = await startAndroidAwakeSession(runCommand);

    const firstRestore = session.restore();
    await vi.waitFor(() => {
      expect(events).toContain("settings put system screen_off_timeout 15000");
    });
    let secondRestoreFinished = false;
    const secondRestore = session.restore().then(() => {
      secondRestoreFinished = true;
    });

    await Promise.resolve();
    expect(secondRestoreFinished).toBe(false);

    releaseTimeoutRestore?.();
    await Promise.all([firstRestore, secondRestore]);
    expect(events.filter((event) => event === "settings put system screen_off_timeout 15000"))
      .toHaveLength(1);
    expect(events.filter((event) => event === "settings put global stay_on_while_plugged_in 0"))
      .toHaveLength(1);
  });

  it("waits for an in-flight activation before restoring a closing session", async () => {
    let releaseActivation: (() => void) | undefined;
    const activationGate = new Promise<void>((resolve) => {
      releaseActivation = resolve;
    });
    const events: string[] = [];
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      events.push(serialized);
      if (serialized === "settings get global stay_on_while_plugged_in") return "0\n";
      if (serialized === "settings get system screen_off_timeout") return "15000\n";
      if (serialized === "settings put system screen_off_timeout 3600000") {
        await activationGate;
      }
      return "";
    });

    const session = createAndroidAwakeSession(runCommand);
    await vi.waitFor(() => {
      expect(events).toContain("settings put system screen_off_timeout 3600000");
    });
    let restoreFinished = false;
    const restore = session.restore().then(() => {
      restoreFinished = true;
    });

    await Promise.resolve();
    expect(restoreFinished).toBe(false);

    releaseActivation?.();
    await Promise.all([session.ready, restore]);
    expect(events).toEqual([
      "settings get global stay_on_while_plugged_in",
      "settings get system screen_off_timeout",
      "settings put global stay_on_while_plugged_in 2",
      "settings put system screen_off_timeout 3600000",
      "input keyevent KEYCODE_WAKEUP",
      "settings put system screen_off_timeout 15000",
      "settings put global stay_on_while_plugged_in 0"
    ]);
  });

  it("restores an unset stay-awake preference when automation fails", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      if (serialized === "settings get global stay_on_while_plugged_in") return "null\n";
      if (serialized === "settings get system screen_off_timeout") return "null\n";
      return "";
    });

    await expect(keepAndroidAwakeDuringAutomation(runCommand, async () => {
      throw new Error("automation failed");
    })).rejects.toThrow("automation failed");

    expect(runCommand.mock.calls).toEqual([
      [["settings", "get", "global", "stay_on_while_plugged_in"]],
      [["settings", "get", "system", "screen_off_timeout"]],
      [["settings", "put", "global", "stay_on_while_plugged_in", "2"]],
      [["settings", "put", "system", "screen_off_timeout", "3600000"]],
      [["input", "keyevent", "KEYCODE_WAKEUP"]],
      [["settings", "delete", "system", "screen_off_timeout"]],
      [["settings", "delete", "global", "stay_on_while_plugged_in"]]
    ]);
  });

  it("attempts to restore the preference when enabling stay-awake fails", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      if (serialized === "settings get global stay_on_while_plugged_in") return "1\n";
      if (serialized === "settings get system screen_off_timeout") return "30000\n";
      if (serialized === "settings put system screen_off_timeout 3600000") {
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
      [["settings", "get", "system", "screen_off_timeout"]],
      [["settings", "put", "global", "stay_on_while_plugged_in", "3"]],
      [["settings", "put", "system", "screen_off_timeout", "3600000"]],
      [["settings", "put", "system", "screen_off_timeout", "30000"]],
      [["settings", "put", "global", "stay_on_while_plugged_in", "1"]]
    ]);
  });

  it("preserves a completed automation result if restoring the preference fails", async () => {
    const restoreError = new Error("restore failed");
    const reportRestoreError = vi.fn();
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      if (serialized === "settings get global stay_on_while_plugged_in") return "0\n";
      if (serialized === "settings get system screen_off_timeout") return "15000\n";
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
      if (serialized === "settings get system screen_off_timeout") return "15000\n";
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

  it("restores stay-awake even if restoring the original timeout fails", async () => {
    const timeoutRestoreError = new Error("timeout restore failed");
    const reportRestoreError = vi.fn();
    const runCommand = vi.fn(async (command: readonly string[]) => {
      const serialized = command.join(" ");
      if (serialized === "settings get global stay_on_while_plugged_in") return "0\n";
      if (serialized === "settings get system screen_off_timeout") return "15000\n";
      if (serialized === "settings put system screen_off_timeout 15000") {
        throw timeoutRestoreError;
      }
      return "";
    });

    await expect(keepAndroidAwakeDuringAutomation(
      runCommand,
      async () => "completed",
      reportRestoreError
    )).resolves.toBe("completed");

    expect(runCommand).toHaveBeenCalledWith([
      "settings",
      "put",
      "global",
      "stay_on_while_plugged_in",
      "0"
    ]);
    expect(reportRestoreError).toHaveBeenCalledWith(timeoutRestoreError);
  });
});
