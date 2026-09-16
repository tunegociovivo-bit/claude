import { parseAndroidUiNodes } from "@/components/mobile/android-ui-hierarchy";

export class FacebookNavigationError extends Error {}

type LaunchDependencies = {
  runCommand: (command: readonly string[]) => Promise<unknown>;
  readHierarchy: () => Promise<string>;
  wait: (milliseconds: number) => Promise<void>;
};

const FACEBOOK_PACKAGES = ["com.facebook.katana", "com.facebook.lite"] as const;

export async function resolveLaunchableFacebookPackage(
  dependencies: Pick<LaunchDependencies, "runCommand" | "readHierarchy">
): Promise<string> {
  const hierarchy = await dependencies.readHierarchy().catch(() => "");
  const foreground = parseAndroidUiNodes(hierarchy)
    .find((node) => FACEBOOK_PACKAGES.some((pkg) => pkg === node.packageName));
  if (foreground) return foreground.packageName;

  for (const packageName of FACEBOOK_PACKAGES) {
    const resolved = String(await dependencies.runCommand([
      "cmd", "package", "resolve-activity", "--brief", "--user", "current",
      "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
      "-p", packageName
    ]));
    if (resolved.split(/\r?\n/).some((line) => line.trim().startsWith(`${packageName}/`))) {
      return packageName;
    }
  }
  throw new FacebookNavigationError("No hay una versión de Facebook disponible para abrir en este usuario de Android. Abre Facebook o Facebook Lite en el móvil y vuelve a intentarlo.");
}

export async function launchFacebookForAutomation(
  packageName: string,
  dependencies: LaunchDependencies
): Promise<void> {
  if (!/^com\.facebook\.(katana|lite)$/.test(packageName)) {
    throw new FacebookNavigationError("La aplicación seleccionada no es Facebook.");
  }
  const current = await dependencies.readHierarchy().catch(() => "");
  if (parseAndroidUiNodes(current).some((node) => node.packageName === packageName)) return;
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
