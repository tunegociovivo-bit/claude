import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), linked: vi.fn(), find: vi.fn(), update: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/api/handler", () => ({ withApi: (_: unknown, handler: unknown) => handler }));
vi.mock("@/lib/mobile/automation-access", () => ({ loadMobileAutomationAccess: m.access, requireSerialLinkedToWorkspace: m.linked }));
vi.mock("@/lib/ai/crypto", () => ({ encryptSecret: m.encrypt, decryptSecret: m.decrypt }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ workspace: { findUnique: m.find, update: m.update } }) } }));
import { POST } from "../route";
const post = POST as unknown as (req: Request, context: unknown) => Promise<Response>;
const save = { action: "save", deviceSerial: "one", id: "a0000000-0000-4000-8000-000000000001", mutationId: "b0000000-0000-4000-8000-000000000001", version: 0, name: "Perfil", username: "user@example.test", password: "test-password", savedOnDevice: false };
const call = (body: object) => post(new Request("https://hub.test/api", { method: "POST", body: JSON.stringify(body) }), { api: { workspaceId: "authorized", userId: "admin" } });
describe("API de cuentas Facebook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.access.mockResolvedValue({ workspace: { settings: {} }, phones: [] });
    m.find.mockResolvedValue({ settings: { unrelated: "preserved", mobileUnlockPins: { one: "encrypted-pin" } } });
    m.encrypt.mockReturnValue("encrypted-value"); m.decrypt.mockReturnValue("user@example.test");
  });
  it("exige gestión y asociación del teléfono también dentro de la escritura", async () => {
    const response = await call(save);
    expect(m.access).toHaveBeenCalledWith("authorized", "admin", { manager: true });
    expect(m.linked).toHaveBeenCalledTimes(2);
    expect(m.find).toHaveBeenCalledWith({ where: { id: "authorized" }, select: { settings: true } });
    const body = await response.json();
    expect(body.accounts[0]).toMatchObject({ username: "user@example.test", hasPassword: true });
    expect(JSON.stringify(body)).not.toContain("test-password");
    expect(JSON.stringify(body)).not.toContain("encrypted-value");
    expect(m.update.mock.calls[0]![0].data.settings).toMatchObject({ unrelated: "preserved", mobileUnlockPins: { one: "encrypted-pin" } });
  });
  it("no deja leer ni guardar a usuarios sin permisos o en teléfonos ajenos", async () => {
    m.access.mockRejectedValueOnce(new Error("forbidden"));
    await expect(call({ action: "list", deviceSerial: "one" })).rejects.toThrow("forbidden");
    m.linked.mockImplementationOnce(() => { throw new Error("unlinked"); });
    await expect(call(save)).rejects.toThrow("unlinked");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("oculta detalles de errores de almacenamiento", async () => {
    m.update.mockRejectedValue(new Error("database error with test-password"));
    await expect(call(save)).rejects.toThrow("No se pudo guardar la cuenta");
  });
  it("solo lista las cuentas del teléfono solicitado", async () => {
    m.access.mockResolvedValue({ workspace: { settings: { mobileFacebookAccounts: { other: [{ id: "private" }] } } }, phones: [] });
    expect(await (await call({ action: "list", deviceSerial: "one" })).json()).toEqual({ accounts: [] });
    expect(m.decrypt).not.toHaveBeenCalled();
  });
});
