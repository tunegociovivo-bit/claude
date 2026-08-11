/**
 * Android App Links: el assetlinks.json debe emitir las huellas configuradas
 * (una o varias) con el paquete correcto. Antes: solo aceptaba UNA huella; con
 * Play App Signing hacen falta al menos dos (clave de firma de la app + clave de
 * subida) para que verifiquen tanto Play como los APK de prueba interna.
 */
import { describe, it, expect } from "vitest";
import { parseFingerprints, buildAssetlinks } from "../assetlinks.json/route";

const APP_SIGNING = "84:E7:40:5A:C8:E1:E7:BA:61:6C:E7:93:68:42:08:EA:53:AB:30:BB:11:22:33:44:55:66:77:88:99:AA:BB:CC";
const UPLOAD = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

describe("parseFingerprints", () => {
  it("acepta UNA huella válida", () => {
    expect(parseFingerprints(APP_SIGNING)).toEqual([APP_SIGNING]);
  });
  it("acepta VARIAS separadas por coma (app-signing + upload) y normaliza a mayúsculas", () => {
    const raw = `${APP_SIGNING.toLowerCase()} , ${UPLOAD}`;
    expect(parseFingerprints(raw)).toEqual([APP_SIGNING, UPLOAD]);
  });
  it("descarta valores con formato inválido", () => {
    expect(parseFingerprints("no-es-una-huella")).toEqual([]);
    expect(parseFingerprints("84:E7:40")).toEqual([]); // demasiado corta
    expect(parseFingerprints("")).toEqual([]);
    expect(parseFingerprints(undefined)).toEqual([]);
  });
});

describe("buildAssetlinks", () => {
  it("vacío si no hay huellas (→ el route responde 404)", () => {
    expect(buildAssetlinks([])).toEqual([]);
  });
  it("incluye el paquete y TODAS las huellas para handle_all_urls", () => {
    const body: any = buildAssetlinks([APP_SIGNING, UPLOAD]);
    expect(body).toHaveLength(1);
    expect(body[0].relation).toContain("delegate_permission/common.handle_all_urls");
    expect(body[0].target.namespace).toBe("android_app");
    expect(body[0].target.package_name).toBe("com.negociovivo.bubui");
    expect(body[0].target.sha256_cert_fingerprints).toEqual([APP_SIGNING, UPLOAD]);
  });
});
