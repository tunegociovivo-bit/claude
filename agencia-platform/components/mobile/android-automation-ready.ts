export type AndroidAutomationCommandRunner = (command: readonly string[]) => Promise<unknown>;

const AUTOMATION_SCREEN_TIMEOUT_MS = 60 * 60 * 1000;

function parseAndroidIntegerSetting(value: unknown): number | null {
  const storedValue = String(value).trim();
  return /^\d+$/.test(storedValue) ? Number(storedValue) : null;
}

async function restoreAndroidSetting(
  runCommand: AndroidAutomationCommandRunner,
  namespace: "global" | "system",
  key: string,
  value: number | null
): Promise<void> {
  if (value === null) {
    await runCommand(["settings", "delete", namespace, key]);
    return;
  }

  await runCommand(["settings", "put", namespace, key, String(value)]);
}

export async function prepareAndroidForAutomation(
  runCommand: AndroidAutomationCommandRunner
): Promise<void> {
  await runCommand(["input", "keyevent", "KEYCODE_WAKEUP"]);
  await runCommand(["wm", "dismiss-keyguard"]);
}

export async function keepAndroidAwakeDuringAutomation<T>(
  runCommand: AndroidAutomationCommandRunner,
  automation: () => Promise<T>,
  reportRestoreError: (error: unknown) => void = (error) => {
    console.warn("[F-Móviles] No se ha podido restaurar el ajuste de pantalla de Android.", error);
  }
): Promise<T> {
  const stayAwakeValue = parseAndroidIntegerSetting(
    await runCommand(["settings", "get", "global", "stay_on_while_plugged_in"])
  );
  const screenTimeoutValue = parseAndroidIntegerSetting(
    await runCommand(["settings", "get", "system", "screen_off_timeout"])
  );
  const temporaryStayAwakeValue = (stayAwakeValue ?? 0) | 2;
  const temporaryScreenTimeoutValue = Math.max(
    screenTimeoutValue ?? 0,
    AUTOMATION_SCREEN_TIMEOUT_MS
  );

  try {
    await runCommand([
      "settings",
      "put",
      "global",
      "stay_on_while_plugged_in",
      String(temporaryStayAwakeValue)
    ]);
    await runCommand([
      "settings",
      "put",
      "system",
      "screen_off_timeout",
      String(temporaryScreenTimeoutValue)
    ]);
    await runCommand(["input", "keyevent", "KEYCODE_WAKEUP"]);
    return await automation();
  } finally {
    const settingsToRestore = [
      ["system", "screen_off_timeout", screenTimeoutValue],
      ["global", "stay_on_while_plugged_in", stayAwakeValue]
    ] as const;

    for (const [namespace, key, value] of settingsToRestore) {
      try {
        await restoreAndroidSetting(runCommand, namespace, key, value);
      } catch (restoreError) {
        try {
          reportRestoreError(restoreError);
        } catch {
          // The automation result remains authoritative even if reporting fails.
        }
      }
    }
  }
}
