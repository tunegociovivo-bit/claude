import { describe, expect, it, vi } from "vitest";
import { waitForFacebookSearchEntry } from "@/components/mobile/facebook-search-navigation";

const screen = (text: string, pkg = "com.facebook.katana") => `<hierarchy><node package="${pkg}" text="${text}" bounds="[0,0][1080,2340]" /></hierarchy>`;
const group = screen("Unirse al grupo Franquicias y Negocios rentables en España para emprender");
const search = '<hierarchy><node package="com.facebook.katana" text="Buscar en Facebook" bounds="[900,70][1000,170]" /></hierarchy>';
const setup = () => ({
  readHierarchy: vi.fn(async () => group),
  runCommand: vi.fn(async (_command: readonly string[]) => ""),
  relaunch: vi.fn(async () => {}),
  wait: vi.fn(async () => {}),
  summarize: vi.fn(async () => "grupo sin buscador")
});

describe("Facebook search recovery", () => {
  it("returns from an open group to the search header", async () => {
    const deps = setup();
    deps.runCommand.mockImplementation(async () => { deps.readHierarchy.mockResolvedValue(search); return ""; });
    await expect(waitForFacebookSearchEntry(["Franquicias"], deps)).resolves.toEqual({ x: 950, y: 120 });
    expect(deps.runCommand).toHaveBeenCalledExactlyOnceWith(["input", "keyevent", "KEYCODE_BACK"]);
    expect(deps.relaunch).not.toHaveBeenCalled();
  });
  it("preserves an already available search screen", async () => {
    const deps = setup();
    deps.readHierarchy.mockResolvedValue(search);
    await waitForFacebookSearchEntry([], deps);
    expect(deps.runCommand).not.toHaveBeenCalled();
  });
  it("recovers the hidden feed header with a swipe", async () => {
    const deps = setup();
    deps.readHierarchy.mockResolvedValue(screen("¿Qué estás pensando?"));
    deps.runCommand.mockImplementation(async () => { deps.readHierarchy.mockResolvedValue(search); return ""; });
    await waitForFacebookSearchEntry([], deps);
    expect(deps.runCommand).toHaveBeenCalledExactlyOnceWith(["input", "swipe", "540", "702", "540", "1872", "400"]);
  });
  it("does not press Back in another application", async () => {
    const deps = setup();
    deps.readHierarchy.mockResolvedValue(screen("Inicio", "com.miui.home"));
    await expect(waitForFacebookSearchEntry([], deps)).rejects.toThrow("no muestra un buscador");
    expect(deps.runCommand).not.toHaveBeenCalled();
  });
  it("stops recovery if Facebook never exposes a search control", async () => {
    const deps = setup();
    await expect(waitForFacebookSearchEntry([], deps)).rejects.toThrow("grupo sin buscador");
    expect(deps.runCommand).toHaveBeenCalledTimes(4);
    expect(deps.readHierarchy).toHaveBeenCalledTimes(10);
  });
});
