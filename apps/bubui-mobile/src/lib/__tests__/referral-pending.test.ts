/**
 * Tests de la captura/aplicación del código de referido (auditoría PR #284).
 * RN, AsyncStorage, api y session mockeados; cada test re-importa el módulo
 * (vi.resetModules) para partir de estado limpio, como un arranque de app.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    asyncStorage: {
      getItem: vi.fn(async (k: string) => store.get(k) ?? null),
      setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: vi.fn(async (k: string) => void store.delete(k))
    },
    linking: { getInitialURL: vi.fn(async () => null as string | null), addEventListener: vi.fn() },
    platform: { OS: "android" },
    api: { applyReferral: vi.fn() },
    session: { CheckSession: vi.fn(async () => null as any) },
    pir: { getInstallReferrerInfo: vi.fn() }
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({ default: H.asyncStorage }));
vi.mock("react-native", () => ({ Linking: H.linking, Platform: H.platform }));
vi.mock("../api", () => ({ api: H.api }));
vi.mock("../session", () => ({ CheckSession: H.session.CheckSession }));
vi.mock("react-native-play-install-referrer", () => ({ PlayInstallReferrer: H.pir }));

const flush = () => new Promise((r) => setTimeout(r, 20));
async function freshModule() {
  vi.resetModules();
  const m = await import("../referral-pending");
  m._setPirLoaderForTests(() => ({ PlayInstallReferrer: H.pir }));
  return m;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.store.clear();
  H.linking.getInitialURL.mockResolvedValue(null);
  H.session.CheckSession.mockResolvedValue(null);
  H.api.applyReferral.mockResolvedValue({ ok: true, linked: true, terminal: true, reason: "linked" });
});

describe("parseo (flujo WhatsApp→Play y variantes web)", () => {
  it("extrae el código del referrer de Play, del deep link y de la URL web", async () => {
    const m = await freshModule();
    expect(m.parseRefFromString("ref_ABC123")).toBe("ABC123"); // Install Referrer
    expect(m.parseRefFromString("https://play.google.com/store/apps/details?id=x&referrer=ref_ABC123")).toBe("ABC123");
    expect(m.parseRefFromString("bubui://r/xyz789")).toBe("XYZ789");
    expect(m.parseRefFromString("https://bubui.app/bubui/app?ref=Q2W3E4")).toBe("Q2W3E4");
    expect(m.parseRefFromString("sin nada")).toBeNull();
  });
});

describe("Install Referrer", () => {
  it("referrer ANTES del registro: captura, resuelve la espera acotada y el alta lee el código", async () => {
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => cb({ installReferrer: "ref_ABC123" }, null));
    const m = await freshModule();
    m.initReferralCapture();
    await m.waitForReferrerCapture(); // debe resolver por señal, no por timeout
    expect(await m.getPendingRef()).toBe("ABC123");
    // Ya NO se persiste ningún flag "ya comprobado" (Auto Backup lo restauraba).
    expect(H.store.get("bubui.installReferrerChecked")).toBeUndefined();
  });

  it("referrer DESPUÉS del registro (tardío): con sesión ya iniciada se aplica al momento", async () => {
    let fire: any = null;
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => { fire = cb; });
    H.session.CheckSession.mockResolvedValue({ customerId: "cust-1", token: "t" });
    const m = await freshModule();
    m.initReferralCapture();
    await flush();
    expect(H.api.applyReferral).not.toHaveBeenCalled();
    fire({ installReferrer: "ref_ABC123" }, null); // el API de Play responde tarde
    await flush();
    expect(H.api.applyReferral).toHaveBeenCalledWith("cust-1", "ABC123");
  });

  it("error transitorio: se reintenta en el siguiente arranque y la espera no bloquea", async () => {
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => cb(null, new Error("SERVICE_UNAVAILABLE")));
    const m = await freshModule();
    m.initReferralCapture();
    await m.waitForReferrerCapture();
    await flush();
    expect(await m.getPendingRef()).toBeNull();
    // "siguiente arranque": vuelve a consultar (no hay flag que lo bloquee) y funciona
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => cb({ installReferrer: "ref_ABC123" }, null));
    const m2 = await freshModule();
    m2.initReferralCapture();
    await flush();
    expect(await m2.getPendingRef()).toBe("ABC123");
  });

  it("REGRESIÓN Auto Backup: flag antiguo restaurado NO bloquea un referrer nuevo", async () => {
    // Simula lo que restaura Android Auto Backup tras reinstalar: el flag antiguo.
    H.store.set("bubui.installReferrerChecked", "1");
    H.session.CheckSession.mockResolvedValue(null);
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => cb({ installReferrer: "ref_XYZ789" }, null));
    const m = await freshModule();
    m.initReferralCapture();
    await m.waitForReferrerCapture();
    await flush();
    // ANTES: el flag restaurado hacía saltar la lectura → getPendingRef null.
    expect(await m.getPendingRef()).toBe("XYZ789");
  });
});

describe("deep link (app ya instalada)", () => {
  it("captura el código de la URL inicial y, con sesión, lo aplica inmediatamente", async () => {
    H.linking.getInitialURL.mockResolvedValue("bubui://r/XYZ789");
    H.session.CheckSession.mockResolvedValue({ customerId: "cust-2", token: "t" });
    const m = await freshModule();
    m.initReferralCapture();
    await flush();
    expect(H.api.applyReferral).toHaveBeenCalledWith("cust-2", "XYZ789");
  });
});

describe("applyPendingRef — el pendiente solo se descarta con resultado TERMINAL", () => {
  it("2xx transitorio (linked sin cupón) NO borra el pendiente", async () => {
    const m = await freshModule();
    await m.storePendingRef("ABC123");
    H.api.applyReferral.mockResolvedValue({ ok: true, linked: true, terminal: false, reason: "welcome_offer_failed" });
    await m.applyPendingRef("cust-1");
    expect(await m.getPendingRef()).toBe("ABC123"); // conserva → reintento
  });

  it("resultado terminal (linked completo o no-op definitivo) SÍ borra el pendiente", async () => {
    const m = await freshModule();
    await m.storePendingRef("ABC123");
    H.api.applyReferral.mockResolvedValue({ ok: true, linked: true, terminal: true, reason: "linked" });
    await m.applyPendingRef("cust-1");
    expect(await m.getPendingRef()).toBeNull();
    await m.storePendingRef("BAD999");
    H.api.applyReferral.mockResolvedValue({ ok: true, linked: false, terminal: true, reason: "invalid_code" });
    await m.applyPendingRef("cust-1");
    expect(await m.getPendingRef()).toBeNull();
  });

  it("error de red → conserva el pendiente para reintentar", async () => {
    const m = await freshModule();
    await m.storePendingRef("ABC123");
    H.api.applyReferral.mockRejectedValue(new Error("network"));
    await m.applyPendingRef("cust-1");
    expect(await m.getPendingRef()).toBe("ABC123");
  });
});
