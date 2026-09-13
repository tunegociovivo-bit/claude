export type AndroidAutomationCommandRunner = (command: readonly string[]) => Promise<unknown>;

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
  const storedValue = String(
    await runCommand(["settings", "get", "global", "stay_on_while_plugged_in"])
  ).trim();
  const parsedValue = /^\d+$/.test(storedValue) ? Number(storedValue) : null;
  const temporaryValue = (parsedValue ?? 0) | 2;

  try {
    await runCommand([
      "settings",
      "put",
      "global",
      "stay_on_while_plugged_in",
      String(temporaryValue)
    ]);
    return await automation();
  } finally {
    try {
      if (parsedValue === null) {
        await runCommand(["settings", "delete", "global", "stay_on_while_plugged_in"]);
      } else {
        await runCommand([
          "settings",
          "put",
          "global",
          "stay_on_while_plugged_in",
          String(parsedValue)
        ]);
      }
    } catch (restoreError) {
      try {
        reportRestoreError(restoreError);
      } catch {
        // The automation result remains authoritative even if reporting fails.
      }
    }
  }
}
