export type AndroidAutomationCommandRunner = (command: readonly string[]) => Promise<unknown>;
export type AndroidAwakeSession = {
  ready: Promise<void>;
  restore: () => Promise<void>;
};

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

export function createAndroidAwakeSession(
  runCommand: AndroidAutomationCommandRunner,
  reportRestoreError: (error: unknown) => void = reportAndroidRestoreError
): AndroidAwakeSession {
  let originalSettings: {
    stayAwakeValue: number | null;
    screenTimeoutValue: number | null;
  } | undefined;
  let settingsRestorePromise: Promise<void> | undefined;
  let restorePromise: Promise<void> | undefined;

  const restoreSettings = () => {
    settingsRestorePromise ??= (async () => {
      if (!originalSettings) return;
      const settingsToRestore = [
        ["system", "screen_off_timeout", originalSettings.screenTimeoutValue],
        ["global", "stay_on_while_plugged_in", originalSettings.stayAwakeValue]
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
    })();
    return settingsRestorePromise;
  };

  const ready = (async () => {
    const stayAwakeValue = parseAndroidIntegerSetting(
      await runCommand(["settings", "get", "global", "stay_on_while_plugged_in"])
    );
    const screenTimeoutValue = parseAndroidIntegerSetting(
      await runCommand(["settings", "get", "system", "screen_off_timeout"])
    );
    originalSettings = { stayAwakeValue, screenTimeoutValue };
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
    } catch (activationError) {
      await restoreSettings();
      throw activationError;
    }
  })();

  const restore = () => {
    restorePromise ??= (async () => {
      try {
        await ready;
      } catch {
        return;
      }
      await restoreSettings();
    })();
    return restorePromise;
  };

  return { ready, restore };
}

export async function startAndroidAwakeSession(
  runCommand: AndroidAutomationCommandRunner,
  reportRestoreError: (error: unknown) => void = reportAndroidRestoreError
): Promise<AndroidAwakeSession> {
  const session = createAndroidAwakeSession(runCommand, reportRestoreError);
  await session.ready;
  return session;
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
