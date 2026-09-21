import { existsSync, readFileSync } from "node:fs";
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
    expect(main).toContain("click: () => { togglePause()");
    expect(main).not.toContain('click: () => { store.set("paused", !paused)');
  });

  it("vincula el equipo solo con el código generado por el administrador", () => {
    const html = readFileSync(resolve(root, "src/settings.html"), "utf8");
    const preload = readFileSync(resolve(root, "src/preload.js"), "utf8");
    const main = readFileSync(resolve(root, "src/main.js"), "utf8");

    expect(html).toContain('id="enrollmentCode"');
    expect(html).toContain('id="link"');
    expect(html).toContain("Pide al administrador un codigo individual");
    expect(preload).toContain("enroll");
    expect(main).toContain('ipcMain.handle("enrollment:set"');
    expect(main).not.toContain('ipcMain.handle("enrollment:request"');
  });

  it("protege en servidor los límites de la jornada del agente", () => {
    const shiftRoute = readFileSync(resolve(root, "../app/api/v1/time-tracking/route.ts"), "utf8");
    const meRoute = readFileSync(resolve(root, "../app/api/v1/time-tracking/me/route.ts"), "utf8");
    const activityRoute = readFileSync(resolve(root, "../app/api/v1/time-tracking/activity/route.ts"), "utf8");
    const screenshotRoute = readFileSync(resolve(root, "../app/api/v1/time-tracking/screenshots/route.ts"), "utf8");

    expect(shiftRoute).toContain('withApi({ scope: "time_tracking:write" }');
    expect(meRoute).toContain('withApi({scope:"time_tracking:write"}');
    expect(shiftRoute).toContain('source: api.apiKeyId ? "AGENT" : "WEB"');
    expect(activityRoute).not.toContain("if (!session) session = await prisma.timeTrackerSession.create");
    expect(activityRoute).toContain('"shift_not_active"');
    expect(screenshotRoute).toContain('"shift_not_active"');
  });

  it("publica el certificado interno antes del instalador de Windows", () => {
    const dashboard = readFileSync(resolve(root, "../components/time-tracking/TimeTrackingClient.tsx"), "utf8");

    expect(dashboard).toContain("Negocio-Vivo-Editor-Confiable.cer");
    expect(dashboard).toContain('label="Certificado"');
    expect(dashboard).toContain('label="Descargar instalador MSI"');
    expect(dashboard).toContain("Windows · instalador MSI nativo");
    expect(dashboard).toContain("8929964F66C44D5CDB1E35426E737EFE2A845B6F86962C38728F290EA7019576");
    expect(dashboard).toContain("7BD7D8745253F281D6A47A61CC396437257D2C7C");
  });

  it("no publica comandos técnicos para instalar Windows desde el navegador", () => {
    const dashboard = readFileSync(resolve(root, "../components/time-tracking/TimeTrackingClient.tsx"), "utf8");

    expect(dashboard).not.toContain("Copiar comando técnico");
    expect(dashboard).not.toContain("Get-AuthenticodeSignature");
    expect(dashboard).not.toContain("Unblock-File -LiteralPath $installerPath");
  });

  it("no ofrece un bootstrap descargable sin autenticar y explica el único aviso manual", () => {
    const dashboard = readFileSync(resolve(root, "../components/time-tracking/TimeTrackingClient.tsx"), "utf8");

    expect(existsSync(resolve(root, "../public/downloads/Instalar-Control-Horario-Negocio-Vivo.cmd"))).toBe(false);
    expect(dashboard).not.toContain("WIN_EASY_INSTALL_URL");
    expect(dashboard).toContain("Tras instalar, abre Control horario");
    expect(dashboard).toContain("pega la credencial individual");
  });
});
