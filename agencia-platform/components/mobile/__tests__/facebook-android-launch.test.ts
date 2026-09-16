import { describe, expect, it, vi } from "vitest";
import { launchFacebookForAutomation, resolveLaunchableFacebookPackage } from "@/components/mobile/facebook-android-launch";

const screen = (pkg: string) => `<hierarchy><node package="${pkg}" bounds="[0,0][1080,2340]" /></hierarchy>`;
const setup = () => ({
  runCommand: vi.fn(async (command: readonly string[]): Promise<string> => command[0] === "cmd" ? "com.facebook.katana/.LoginActivity" : "Status: ok"),
  readHierarchy: vi.fn(async () => screen("com.facebook.katana")).mockResolvedValueOnce(screen("com.miui.home")),
  wait: vi.fn(async () => {})
});

describe("verified Facebook launch", () => {
  it("launches the current user's Facebook without force-stopping it", async () => {
    const dependencies = setup();
    await launchFacebookForAutomation("com.facebook.katana", dependencies);
    expect(dependencies.runCommand).toHaveBeenLastCalledWith(
      ["timeout", "20", "am", "start", "-W", "--user", "current", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", "com.facebook.katana/.LoginActivity"]
    );
  });
  it("does not mistake a successful command for a launched app", async () => {
    const dependencies = setup();
    dependencies.readHierarchy.mockResolvedValue(screen("com.miui.home"));
    await expect(launchFacebookForAutomation("com.facebook.katana", dependencies)).rejects.toThrow("no ha dejado Facebook en pantalla");
    expect(dependencies.readHierarchy).toHaveBeenCalledTimes(5);
  });
  it("allows the launcher transition to finish", async () => {
    const dependencies = setup();
    dependencies.readHierarchy.mockResolvedValueOnce(screen("com.miui.home"));
    await launchFacebookForAutomation("com.facebook.katana", dependencies);
    expect(dependencies.readHierarchy).toHaveBeenCalledTimes(3);
  });
  it("surfaces ActivityManager errors even when the shell exits successfully", async () => {
    const dependencies = setup();
    dependencies.runCommand.mockResolvedValueOnce("com.facebook.katana/.LoginActivity").mockResolvedValueOnce("Error: Activity not started, unable to resolve Intent");
    await expect(launchFacebookForAutomation("com.facebook.katana", dependencies)).rejects.toThrow("unable to resolve Intent");
    expect(dependencies.readHierarchy).toHaveBeenCalledOnce();
  });
  it("preserves accessibility errors instead of reporting a missing search box", async () => {
    const dependencies = setup();
    dependencies.readHierarchy.mockRejectedValue(new Error("estructura accesible no disponible"));
    await expect(launchFacebookForAutomation("com.facebook.katana", dependencies)).rejects.toThrow("estructura accesible");
  });
  it("rejects other applications", async () => {
    const dependencies = setup();
    await expect(launchFacebookForAutomation("com.android.chrome", dependencies)).rejects.toThrow("no es Facebook");
    expect(dependencies.runCommand).not.toHaveBeenCalled();
  });

  it("keeps the active Facebook screen even when its launcher is unavailable", async () => {
    const dependencies = setup();
    dependencies.readHierarchy.mockReset().mockResolvedValue(screen("com.facebook.lite"));
    await launchFacebookForAutomation("com.facebook.lite", dependencies);
    expect(dependencies.runCommand).not.toHaveBeenCalled();
  });
});

describe("launchable Facebook selection", () => {
  it("uses the actual foreground version instead of a preinstalled stub", async () => {
    const dependencies = setup();
    dependencies.readHierarchy.mockReset().mockResolvedValue(screen("com.facebook.lite"));
    await expect(resolveLaunchableFacebookPackage(dependencies)).resolves.toBe("com.facebook.lite");
    expect(dependencies.runCommand).not.toHaveBeenCalled();
  });
  it("skips a package without an enabled launcher and selects Lite", async () => {
    const dependencies = setup();
    dependencies.runCommand.mockResolvedValueOnce("No activity found").mockResolvedValueOnce("com.facebook.lite/.MainActivity");
    await expect(resolveLaunchableFacebookPackage(dependencies)).resolves.toBe("com.facebook.lite");
    expect(dependencies.runCommand).toHaveBeenCalledTimes(2);
  });
  it("does not treat nonempty error output as an installed application", async () => {
    const dependencies = setup();
    dependencies.runCommand.mockResolvedValue("No activity found");
    await expect(resolveLaunchableFacebookPackage(dependencies)).rejects.toThrow("No hay una versión de Facebook");
  });
});
