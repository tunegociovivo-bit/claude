/**
 * Tests de captura/reclamo del RETO (custom-deal) — reproducen la PRUEBA REAL
 * del 9-ago que falló pese a que los tests de #283/#284 (solo referidos) pasaban.
 *
 * Escenario reproducido de extremo a extremo (con RN/AsyncStorage/api/session
 * mockeados, re-importando el módulo en cada test como un arranque de app):
 *   app desinstalada → WhatsApp → Play (Install Referrer reto_<token>) →
 *   primer arranque (sin sesión) → captura → alta (waitForDealCapture) → claim.
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
    api: { claimDeal: vi.fn(), traceDeal: vi.fn(async () => ({ ok: true })) },
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
  const m = await import("../deal-pending");
  m._setPirLoaderForTests(() => ({ PlayInstallReferrer: H.pir }));
  return m;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.store.clear();
  H.linking.getInitialURL.mockResolvedValue(null);
  H.session.CheckSession.mockResolvedValue(null);
  H.api.claimDeal.mockResolvedValue({ ok: true, shareUrl: "https://bubui.app/r/ABC123" });
  H.api.traceDeal.mockResolvedValue({ ok: true });
});

const TOKEN = "60df921bb7bdeb5d"; // el token real de la incidencia

describe("parseo (WhatsApp→Play y variantes)", () => {
  it("extrae el token del Install Referrer, del deep link y de la URL ?deal=", async () => {
    const m = await freshModule();
    expect(m.parseDealFromString(`reto_${TOKEN}`)).toBe(TOKEN); // Install Referrer de Play
    expect(m.parseDealFromString(`https://play.google.com/store/apps/details?id=com.negociovivo.bubui&referrer=reto_${TOKEN}`)).toBe(TOKEN);
    expect(m.parseDealFromString(`bubui://reto/${TOKEN}`)).toBe(TOKEN);
    expect(m.parseDealFromString(`https://bubui.app/reto/${TOKEN}`)).toBe(TOKEN);
    expect(m.parseDealFromString(`https://bubui.app/x?deal=${TOKEN}`)).toBe(TOKEN);
    expect(m.parseDealFromString("nada")).toBeNull();
  });
});

describe("CASO REAL: desinstalada → Play → primer arranque → alta → claim", () => {
  it("Install Referrer ANTES del alta: captura, resuelve la espera y el alta puede reclamar", async () => {
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => cb({ installReferrer: `reto_${TOKEN}` }, null));
    const m = await freshModule();
    m.initDealCapture();
    await m.waitForDealCapture(); // resuelve por SEÑAL (no por timeout)
    expect(await m.getPendingDeal()).toBe(TOKEN);
    // El alta ya tiene sesión y reclama:
    await m.claimPendingDeal("cust-1");
    expect(H.api.claimDeal).toHaveBeenCalledWith(TOKEN, "cust-1");
    expect(await m.getPendingDeal()).toBeNull(); // limpiado tras claim OK
  });

  it("REGRESIÓN del bug real: error transitorio del Install Referrer NO marca IR_DONE → se reintenta al siguiente arranque", async () => {
    // Este era el fallo: deal-pending marcaba IR_DONE ANTES del callback, así que
    // un error puntual perdía el token para siempre y el reto nunca aparecía.
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => cb(null, new Error("SERVICE_UNAVAILABLE")));
    const m = await freshModule();
    m.initDealCapture();
    await m.waitForDealCapture();
    await flush();
    expect(H.store.get("bubui.installReferrerDealChecked")).toBeUndefined(); // NO marcado
    expect(await m.getPendingDeal()).toBeNull();
    // Siguiente arranque: ahora Play responde bien → captura el token.
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => cb({ installReferrer: `reto_${TOKEN}` }, null));
    const m2 = await freshModule();
    m2.initDealCapture();
    await flush();
    expect(await m2.getPendingDeal()).toBe(TOKEN);
  });

  it("Install Referrer TARDÍO con sesión ya iniciada: reclama al momento (sin esperar a otro arranque)", async () => {
    let fire: any = null;
    H.pir.getInstallReferrerInfo.mockImplementation((cb: any) => { fire = cb; });
    H.session.CheckSession.mockResolvedValue({ customerId: "cust-2", token: "t" });
    const m = await freshModule();
    m.initDealCapture();
    await flush();
    expect(H.api.claimDeal).not.toHaveBeenCalled();
    fire({ installReferrer: `reto_${TOKEN}` }, null); // Play responde tarde
    await flush();
    expect(H.api.claimDeal).toHaveBeenCalledWith(TOKEN, "cust-2");
  });
});

describe("deep link (app ya instalada)", () => {
  it("captura el token de la URL inicial y, con sesión, reclama de inmediato", async () => {
    H.linking.getInitialURL.mockResolvedValue(`bubui://reto/${TOKEN}`);
    H.session.CheckSession.mockResolvedValue({ customerId: "cust-3", token: "t" });
    const m = await freshModule();
    m.initDealCapture();
    await flush();
    expect(H.api.claimDeal).toHaveBeenCalledWith(TOKEN, "cust-3");
  });
});

describe("claimPendingDeal — semántica de reintento", () => {
  it("sin token pendiente no llama al API", async () => {
    const m = await freshModule();
    await m.claimPendingDeal("cust-x");
    expect(H.api.claimDeal).not.toHaveBeenCalled();
  });

  it("fallo de red → conserva el pendiente para reintentar", async () => {
    const m = await freshModule();
    await m.storePendingDeal(TOKEN);
    H.api.claimDeal.mockRejectedValue(new Error("network"));
    await m.claimPendingDeal("cust-1");
    expect(await m.getPendingDeal()).toBe(TOKEN); // no se pierde
  });

  it("claim OK → limpia el pendiente y notifica a los listeners (Feed)", async () => {
    const m = await freshModule();
    await m.storePendingDeal(TOKEN);
    const listener = vi.fn();
    const off = m.onDealClaimed(listener);
    await m.claimPendingDeal("cust-1");
    expect(await m.getPendingDeal()).toBeNull();
    expect(listener).toHaveBeenCalled();
    off();
  });
});

describe("observabilidad", () => {
  it("emite trazas seguras por etapa (captura y claim)", async () => {
    H.linking.getInitialURL.mockResolvedValue(`bubui://reto/${TOKEN}`);
    const m = await freshModule();
    m.initDealCapture();
    await flush();
    await m.claimPendingDeal("cust-1");
    const stages = H.api.traceDeal.mock.calls.map((c: any[]) => c[1]);
    expect(stages).toContain("app_capture_deeplink");
    expect(stages).toContain("app_claim_ok");
  });
});
