import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

describe("interfaz del agente de control horario", () => {
  it("no expone configuración administrativa ni secretos al trabajador", () => {
    const html = readFileSync(resolve(root, "src/settings.html"), "utf8");

    for (const forbidden of [
      "Dirección del Hub",
      "Token personal del agente",
      "Captura cada (minutos)",
      "Conservar (días)",
      "Capturas periódicas activadas",
      "Difuminar completamente las capturas",
      "Aplicaciones o títulos excluidos",
      "Guardar configuración",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("solo permite guardar una credencial de vinculación y no política local", () => {
    const main = readFileSync(resolve(root, "src/main.js"), "utf8");
    const preload = readFileSync(resolve(root, "src/preload.js"), "utf8");

    expect(preload).not.toContain("saveConfig");
    expect(main).not.toContain('ipcMain.handle("config:set"');
    expect(main).toContain('ipcMain.handle("enrollment:set"');
  });

  it("incluye metadatos de Windows y no desactiva la edición y firma del ejecutable", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

    expect(pkg.build.win.signAndEditExecutable).toBe(true);
    expect(pkg.build.win.requestedExecutionLevel).toBe("asInvoker");
    expect(pkg.build.win.publisherName).toBe("Negocio Vivo Marketing");
  });

  it("limita la pantalla vinculada a iniciar, pausar y finalizar la jornada", () => {
    const html = readFileSync(resolve(root, "src/settings.html"), "utf8");
    const main = readFileSync(resolve(root, "src/main.js"), "utf8");

    expect(html).toContain('id="start"');
    expect(html).toContain('id="pause"');
    expect(html).toContain('id="stop"');
    expect(main).toContain('ipcMain.handle("shift:set"');
    expect(main).toContain('if (!store.get("shiftActive") || store.get("paused")) return;');
  });
});
