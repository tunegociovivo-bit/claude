import { parseAndroidUiNodes } from "@/components/mobile/android-ui-hierarchy";

export class FacebookNavigationError extends Error {}

type LaunchDependencies = {
  runCommand: (command: readonly string[]) => Promise<unknown>;
  readHierarchy: () => Promise<string>;
  wait: (milliseconds: number) => Promise<void>;
};

export async function launchFacebookForAutomation(
  packageName: string,
  dependencies: LaunchDependencies
): Promise<void> {
  if (!/^com\.facebook\.(katana|lite)$/.test(packageName)) {
    throw new FacebookNavigationError("La aplicación seleccionada no es Facebook.");
  }
  // ActivityManager resolves the launcher for the active Android user. Monkey
  // can finish without launching an activity (especially on vendor ROMs).
  const output = String(await dependencies.runCommand([
    "timeout", "20", "am", "start", "-W", "--user", "current",
    "-a", "android.intent.action.MAIN",
    "-c", "android.intent.category.LAUNCHER", "-p", packageName
  ]));
  if (/Error:|Exception|Permission Denial|Status:\s*(?:timeout|error)/i.test(output)) {
    throw new FacebookNavigationError(`Android no ha podido abrir Facebook: ${output.trim().slice(0, 500)}`);
  }

  let lastReadError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dependencies.wait(600);
    try {
      const nodes = parseAndroidUiNodes(await dependencies.readHierarchy());
      if (nodes.some((node) => node.packageName === packageName)) return;
    } catch (error) {
      lastReadError = error;
    }
  }
  throw new FacebookNavigationError(lastReadError instanceof Error
    ? `No se ha podido comprobar la pantalla de Facebook: ${lastReadError.message}`
    : "Android no ha dejado Facebook en pantalla. Abre Facebook en el móvil y comprueba que la sesión está iniciada antes de reintentar el lote.");
}
