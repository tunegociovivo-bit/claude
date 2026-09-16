import { describe, expect, it, vi } from "vitest";
import { launchFacebookForAutomation } from "@/components/mobile/facebook-android-launch";

const screen = (pkg: string) => `<hierarchy><node package="${pkg}" bounds="[0,0][1080,2340]" /></hierarchy>`;
const setup = () => ({
  runCommand: vi.fn(async () => "Status: ok"),
  readHierarchy: vi.fn(async () => screen("com.facebook.katana")),
  wait: vi.fn(async () => {})
});

describe("verified Facebook launch", () => {
  it("launches the current user's Facebook without force-stopping it", async () => {
    const dependencies = setup();
    await launchFacebookForAutomation("com.facebook.katana", dependencies);
    expect(dependencies.runCommand.mock.calls).toEqual([[
      ["timeout", "20", "am", "start", "-W", "--user", "current", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-p", "com.facebook.katana"]
    ]]);
  });
  it("does not mistake a successful command for a launched app", async () => {
    const dependencies = setup();
    dependencies.readHierarchy.mockResolvedValue(screen("com.miui.home"));
    await expect(launchFacebookForAutomation("com.facebook.katana", dependencies)).rejects.toThrow("no ha dejado Facebook en pantalla");
    expect(dependencies.readHierarchy).toHaveBeenCalledTimes(4);
  });
  it("allows the launcher transition to finish", async () => {
    const dependencies = setup();
    dependencies.readHierarchy.mockResolvedValueOnce(screen("com.miui.home"));
    await launchFacebookForAutomation("com.facebook.katana", dependencies);
    expect(dependencies.readHierarchy).toHaveBeenCalledTimes(2);
  });
  it("surfaces ActivityManager errors even when the shell exits successfully", async () => {
    const dependencies = setup();
    dependencies.runCommand.mockResolvedValue("Error: Activity not started, unable to resolve Intent");
    await expect(launchFacebookForAutomation("com.facebook.katana", dependencies)).rejects.toThrow("unable to resolve Intent");
    expect(dependencies.readHierarchy).not.toHaveBeenCalled();
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
});
