import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";
import { FacebookNavigationError } from "@/components/mobile/facebook-android-launch";
import { findFacebookSearchEntryTarget } from "@/components/mobile/facebook-android-ui";

type Dependencies = {
  readHierarchy: () => Promise<string>;
  runCommand: (command: readonly string[]) => Promise<unknown>;
  relaunch: () => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  summarize: () => Promise<string>;
};

export async function waitForFacebookSearchEntry(
  knownQueries: readonly string[],
  dependencies: Dependencies
): Promise<AndroidUiPoint> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const hierarchy = await dependencies.readHierarchy();
      const target = findFacebookSearchEntryTarget(hierarchy, knownQueries);
      if (target) return target.point;
      const nodes = parseAndroidUiNodes(hierarchy).filter((node) => /^com\.facebook\.(katana|lite)$/.test(node.packageName));
      const isFeed = nodes.some((node) => /^(¿Qué estás pensando\?|What's on your mind\?|Bandeja de historias)$/i.test(node.text || node.contentDescription));
      if (isFeed && (attempt === 1 || attempt === 3)) {
        const screen = nodes.reduce<typeof nodes[number] | undefined>((largest, node) =>
          !largest || (node.bounds.right - node.bounds.left) * (node.bounds.bottom - node.bounds.top)
            > (largest.bounds.right - largest.bounds.left) * (largest.bounds.bottom - largest.bounds.top) ? node : largest, undefined);
        if (screen) {
          const { left, right, top, bottom } = screen.bounds;
          const x = String(Math.round((left + right) / 2));
          await dependencies.runCommand(["input", "swipe", x, String(Math.round(top + (bottom - top) * 0.3)), x, String(Math.round(top + (bottom - top) * 0.8)), "400"]);
        }
      } else if (nodes.length && !isFeed && [1, 3, 6, 8].includes(attempt)) {
        // Reopening an already foreground Facebook app preserves its group or
        // post page. Return through its navigation stack before searching.
        // A fresh hierarchy on every attempt bounds recovery to Facebook.
        await dependencies.runCommand(["input", "keyevent", "KEYCODE_BACK"]);
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt === 4) await dependencies.relaunch();
    await dependencies.wait(900);
  }
  if (lastError instanceof Error && /estructura accesible/i.test(lastError.message)) throw lastError;
  throw new FacebookNavigationError(`Facebook no muestra un buscador accesible. Pantalla detectada: ${await dependencies.summarize()}`);
}
