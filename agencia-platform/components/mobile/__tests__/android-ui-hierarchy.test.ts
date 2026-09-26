import { describe, expect, it, vi } from "vitest";
import {
  findAndroidUiNodeCenter,
  readAndroidUiHierarchySafely
} from "@/components/mobile/android-ui-hierarchy";

const hierarchy = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node text="" resource-id="" class="android.view.View" content-desc="Buscar" clickable="true" bounds="[630,60][710,140]" />
  <node text="Buscar en Facebook" class="android.widget.EditText" content-desc="" focused="true" bounds="[70,60][610,140]" />
  <node text="Grupos" class="android.view.View" content-desc="" clickable="true" bounds="[250,160][430,230]" />
</hierarchy>`;

describe("jerarquía accesible de Android", () => {
  it("localiza controles por texto o descripción y calcula el centro", () => {
    expect(findAndroidUiNodeCenter(hierarchy, { labels: ["Buscar", "Search"] })).toEqual({ x: 670, y: 100 });
    expect(findAndroidUiNodeCenter(hierarchy, { labels: ["Grupos", "Groups"] })).toEqual({ x: 340, y: 195 });
  });

  it("localiza el campo enfocado por clase", () => {
    expect(findAndroidUiNodeCenter(hierarchy, {
      className: "android.widget.EditText",
      focused: true
    })).toEqual({ x: 340, y: 100 });
  });

  it("devuelve null cuando Facebook no expone el control", () => {
    expect(findAndroidUiNodeCenter(hierarchy, { labels: ["Unirme"] })).toBeNull();
  });

  it("limita dentro de Android el volcado de accesibilidad para que no bloquee el worker", async () => {
    const runCommand = vi.fn(async () => hierarchy);

    await expect(readAndroidUiHierarchySafely(runCommand)).resolves.toBe(hierarchy);
    expect(runCommand.mock.calls).toEqual([
      [[
        "sh",
        "-c",
        "rm -f /sdcard/nv-mobile-window.xml && timeout 25 uiautomator dump /sdcard/nv-mobile-window.xml >/dev/null && cat /sdcard/nv-mobile-window.xml"
      ]]
    ]);
  });

  it("no reutiliza un XML anterior cuando el nuevo volcado agota el tiempo", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      expect(command[2]).toContain("rm -f /sdcard/nv-mobile-window.xml && timeout 10");
      expect(command[2]).toContain("&& cat /sdcard/nv-mobile-window.xml");
      return "";
    });

    await expect(readAndroidUiHierarchySafely(runCommand))
      .rejects.toThrow("estructura accesible");
  });

  it("rechaza un XML truncado aunque contenga la etiqueta inicial", async () => {
    const runCommand = vi.fn(async () => '<hierarchy rotation="0"><node text="Buscar" />');

    await expect(readAndroidUiHierarchySafely(runCommand))
      .rejects.toThrow("estructura accesible");
  });
  it("recovers from a transient MIUI accessibility failure", async () => {
    const runCommand = vi.fn().mockRejectedValueOnce(new Error("MIUI accessibility failed")).mockResolvedValueOnce(hierarchy);
    await expect(readAndroidUiHierarchySafely(runCommand)).resolves.toBe(hierarchy);
    expect(runCommand).toHaveBeenCalledTimes(2);
  });
});
