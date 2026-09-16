import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "@/lib/ai/crypto";
import { mobileFacebookAccountRequestSchema } from "../facebook-accounts";
import { accountForDisplay, accountsForDevice, updateMobileFacebookAccounts, type MobileFacebookAccountStore } from "../facebook-accounts-server";
const id = "a0000000-0000-4000-8000-000000000001";
const mutationId = "b0000000-0000-4000-8000-000000000001";
const request = { action: "save" as const, deviceSerial: "phone-one", id, mutationId, version: 0, name: "Perfil de prueba", username: "example@example.test", password: "  test-password  ", savedOnDevice: false };
let previousKey: string | undefined;
beforeEach(() => { previousKey = process.env.SECRETS_ENC_KEY; process.env.SECRETS_ENC_KEY = "isolated-test-encryption-key"; });
afterEach(() => { if (previousKey === undefined) delete process.env.SECRETS_ENC_KEY; else process.env.SECRETS_ENC_KEY = previousKey; });
describe("cuentas de Facebook por móvil", () => {
  it("cifra usuario y contraseña sin exponer el secreto en el listado", () => {
    const store = updateMobileFacebookAccounts({}, request);
    expect(JSON.stringify(store)).not.toContain(request.password);
    expect(JSON.stringify(store)).not.toContain(request.username);
    const stored = accountsForDevice(store, request.deviceSerial)[0]!;
    expect(decryptSecret(stored.passwordCipher!)).toBe(request.password);
    const visible = accountForDisplay(stored);
    expect(visible.username).toBe(request.username);
    expect(visible.hasPassword).toBe(true);
    expect(JSON.stringify(visible)).not.toContain("password");
    expect(visible).not.toHaveProperty("passwordCipher");
  });
  it("conserva la contraseña al editar y permite sustituirla explícitamente", () => {
    let store = updateMobileFacebookAccounts({}, request);
    const original = store[request.deviceSerial]![0]!.passwordCipher;
    store = updateMobileFacebookAccounts(store, { ...request, version: 1, mutationId: "changed", password: undefined, name: "Nombre editado" });
    expect(store[request.deviceSerial]![0]!.passwordCipher).toBe(original);
    store = updateMobileFacebookAccounts(store, { ...request, version: 2, mutationId: "changed-again", password: "new-test-password" });
    expect(decryptSecret(store[request.deviceSerial]![0]!.passwordCipher!)).toBe("new-test-password");
  });
  it("un reintento idéntico no duplica ni cambia la versión", () => {
    const store = updateMobileFacebookAccounts({}, request);
    expect(updateMobileFacebookAccounts(store, request)).toBe(store);
    expect(store[request.deviceSerial]).toHaveLength(1);
  });
  it("impide duplicados por usuario en el mismo móvil, incluso inactivos", () => {
    let store = updateMobileFacebookAccounts({}, request);
    store = updateMobileFacebookAccounts(store, { action: "setActive", deviceSerial: request.deviceSerial, id, mutationId: "disable", version: 1, active: false });
    expect(() => updateMobileFacebookAccounts(store, { ...request, id: "other", mutationId: "other", username: request.username.toUpperCase() })).toThrow("ya está guardado");
    const restored = updateMobileFacebookAccounts(store, { action: "setActive", deviceSerial: request.deviceSerial, id, mutationId: "restore", version: 2, active: true });
    expect(restored[request.deviceSerial]![0]!.active).toBe(true);
  });
  it("mantiene independientes los teléfonos y rechaza ediciones cruzadas o antiguas", () => {
    const store = updateMobileFacebookAccounts({}, request);
    const second = updateMobileFacebookAccounts(store, { ...request, deviceSerial: "phone-two" });
    expect(second["phone-one"]).toEqual(store["phone-one"]);
    expect(accountsForDevice(second, "unknown")).toEqual([]);
    expect(() => updateMobileFacebookAccounts(store, { ...request, mutationId: "stale" })).toThrow("otra pestaña");
    expect(() => updateMobileFacebookAccounts(store, { action: "setActive", deviceSerial: "phone-two", id, mutationId: "disable", version: 1, active: false })).toThrow();
  });
  it("no reutiliza la contraseña de un usuario distinto", () => {
    const store = updateMobileFacebookAccounts({}, request);
    expect(() => updateMobileFacebookAccounts(store, { ...request, version: 1, mutationId: "edit", username: "another@example.test", password: undefined })).toThrow("Al cambiar el usuario");
  });
  it("permite omitir la contraseña solo si se declara guardada en Facebook", () => {
    expect(() => updateMobileFacebookAccounts({}, { ...request, password: undefined })).toThrow("contraseña");
    const store = updateMobileFacebookAccounts({}, { ...request, password: undefined, savedOnDevice: true });
    expect(accountForDisplay(store[request.deviceSerial]![0]!).hasPassword).toBe(false);
  });
  it("valida identificadores, límites y conserva espacios de la contraseña", () => {
    expect(mobileFacebookAccountRequestSchema.parse(request)).toMatchObject({ password: request.password });
    expect(mobileFacebookAccountRequestSchema.safeParse({ ...request, password: "" }).success).toBe(false);
    expect(mobileFacebookAccountRequestSchema.safeParse({ ...request, unexpected: true }).success).toBe(false);
    expect(mobileFacebookAccountRequestSchema.safeParse({ ...request, username: " " }).success).toBe(false);
  });
  it("rechaza un secreto ilegible sin devolver datos incompletos", () => {
    const store: MobileFacebookAccountStore = updateMobileFacebookAccounts({}, request);
    expect(() => accountForDisplay({ ...store[request.deviceSerial]![0]!, usernameCipher: "corrupt" })).toThrow("cifrados");
  });
});
