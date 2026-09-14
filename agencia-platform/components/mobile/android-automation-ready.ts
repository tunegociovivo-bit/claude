export type AndroidAutomationCommandRunner = (command: readonly string[]) => Promise<unknown>;
export type AndroidAwakeSession = { restore: () => Promise<void> };

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

function reportAndroidRestoreError(error: unknown): void {
  console.warn("[F-Móviles] No se ha podido restaurar el ajuste de pantalla de Android.", error);
}

export async function prepareAndroidForAutomation(
  runCommand: AndroidAutomationCommandRunner
): Promise<void> {
  await runCommand(["input", "keyevent", "KEYCODE_WAKEUP"]);
  await runCommand(["wm", "dismiss-keyguard"]);
}

export async function startAndroidAwakeSession(
  runCommand: AndroidAutomationCommandRunner,
  reportRestoreError: (error: unknown) => void = reportAndroidRestoreError
): Promise<AndroidAwakeSession> {
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
  let restored = false;

  const restore = async () => {
    if (restored) return;
    restored = true;

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
          // The session result remains authoritative even if reporting fails.
        }
      }
    }
  };

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
  } catch (activationError) {
    await restore();
    throw activationError;
  }

  return { restore };
}

export async function keepAndroidAwakeDuringAutomation<T>(
  runCommand: AndroidAutomationCommandRunner,
  automation: () => Promise<T>,
  reportRestoreError: (error: unknown) => void = reportAndroidRestoreError
): Promise<T> {
  const session = await startAndroidAwakeSession(runCommand, reportRestoreError);
  try {
    return await automation();
  } finally {
    await session.restore();
  }
}
