import { describe, it, expect, beforeEach } from "vitest";
import {
  signGbpState,
  verifyGbpState,
  newNonce,
  gbpAuthorizeUrl,
  gbpRedirectUri,
  hasBusinessScope,
  gbpOAuthConfigurationIssue,
  exchangeGbpCode,
  refreshGbpToken,
  revokeGoogleToken,
  emailFromIdToken,
  STATE_TTL_MS,
  GBP_SCOPE,
} from "../gbp-oauth";

// Entorno fake: credenciales de test, sin red real.
beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-abc";
  process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  process.env.NEXTAUTH_URL = "https://hub.negociovivo.app";
});

describe("configuración", () => {
  it("null cuando todo presente", () => {
    expect(gbpOAuthConfigurationIssue()).toBeNull();
  });
  it("'server' si falta NEXTAUTH_SECRET", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(gbpOAuthConfigurationIssue()).toBe("server");
  });
  it("'google_credentials' si faltan client id/secret", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(gbpOAuthConfigurationIssue()).toBe("google_credentials");
  });
});

describe("state firmado (one-time nonce + expiración)", () => {
  const base = { workspaceId: "ws1", userId: "u1", nonce: "n-123" };

  it("firma y verifica ida y vuelta", () => {
    const now = 1_000_000;
    const state = signGbpState({ ...base, ts: now });
    const p = verifyGbpState(state, now + 1000);
    expect(p).toMatchObject(base);
  });

  it("rechaza firma manipulada (anti-tamper)", () => {
    const state = signGbpState({ ...base, ts: 1_000_000 });
    const [body] = state.split(".");
    const forged = `${body}.deadbeef`;
    expect(verifyGbpState(forged, 1_000_100)).toBeNull();
  });

  it("rechaza si cambia el payload manteniendo la firma vieja", () => {
    const state = signGbpState({ ...base, ts: 1_000_000 });
    const sig = state.split(".")[1];
    const otherBody = Buffer.from(JSON.stringify({ ...base, workspaceId: "otro", ts: 1_000_000 })).toString("base64url");
    expect(verifyGbpState(`${otherBody}.${sig}`, 1_000_100)).toBeNull();
  });

  it("rechaza state caducado (> TTL)", () => {
    const now = 5_000_000;
    const state = signGbpState({ ...base, ts: now });
    expect(verifyGbpState(state, now + STATE_TTL_MS + 1)).toBeNull();
  });

  it("rechaza state del futuro (reloj adelantado > 60s)", () => {
    const now = 5_000_000;
    const state = signGbpState({ ...base, ts: now + 120_000 });
    expect(verifyGbpState(state, now)).toBeNull();
  });

  it("un secreto distinto invalida la firma (aislamiento por servidor)", () => {
    const state = signGbpState({ ...base, ts: 1_000_000 });
    process.env.NEXTAUTH_SECRET = "otro-secreto";
    expect(verifyGbpState(state, 1_000_100)).toBeNull();
  });

  it("newNonce genera valores únicos y no vacíos", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe("authorize url + scope", () => {
  it("incluye scope business.manage y prompt=consent, sin mezclar scopes", () => {
    const url = new URL(gbpAuthorizeUrl("STATE123"));
    expect(url.searchParams.get("scope")).toBe(GBP_SCOPE);
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("state")).toBe("STATE123");
    expect(url.searchParams.get("redirect_uri")).toBe(gbpRedirectUri());
  });
  it("redirect_uri apunta al callback .app", () => {
    expect(gbpRedirectUri()).toBe("https://hub.negociovivo.app/api/integrations/gmb-google/callback");
  });
  it("hasBusinessScope detecta el permiso", () => {
    expect(hasBusinessScope("openid email https://www.googleapis.com/auth/business.manage")).toBe(true);
    expect(hasBusinessScope("openid email")).toBe(false);
    expect(hasBusinessScope(null)).toBe(false);
  });
});

describe("intercambio/refresh/revoke con fetch inyectado (sin red)", () => {
  it("exchangeGbpCode devuelve tokens en 200", async () => {
    const fake = async () => new Response(JSON.stringify({ refresh_token: "rt", access_token: "at", scope: GBP_SCOPE, id_token: "x" }), { status: 200 });
    const t = await exchangeGbpCode("code123", undefined, { fetch: fake as any });
    expect(t.refresh_token).toBe("rt");
    expect(t.access_token).toBe("at");
  });

  it("exchangeGbpCode lanza en error HTTP", async () => {
    const fake = async () => new Response("nope", { status: 400 });
    await expect(exchangeGbpCode("bad", undefined, { fetch: fake as any })).rejects.toThrow(/token_exchange_400/);
  });

  it("refreshGbpToken lanza revoked_or_expired en 400/401", async () => {
    const fake400 = async () => new Response("invalid_grant", { status: 400 });
    await expect(refreshGbpToken("rt", { fetch: fake400 as any })).rejects.toThrow("revoked_or_expired");
    const fake401 = async () => new Response("unauth", { status: 401 });
    await expect(refreshGbpToken("rt", { fetch: fake401 as any })).rejects.toThrow("revoked_or_expired");
  });

  it("refreshGbpToken devuelve access_token en 200", async () => {
    const fake = async () => new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 });
    const r = await refreshGbpToken("rt", { fetch: fake as any });
    expect(r.access_token).toBe("fresh");
  });

  it("revokeGoogleToken best-effort: no lanza aunque falle la red", async () => {
    const boom = async () => { throw new Error("network"); };
    await expect(revokeGoogleToken("tok", { fetch: boom as any })).resolves.toBe(false);
    const ok = async () => new Response("", { status: 200 });
    await expect(revokeGoogleToken("tok", { fetch: ok as any })).resolves.toBe(true);
  });
});

describe("emailFromIdToken", () => {
  it("extrae email del payload del id_token", () => {
    const payload = Buffer.from(JSON.stringify({ email: "dueño@negocio.es" })).toString("base64url");
    const idToken = `header.${payload}.sig`;
    expect(emailFromIdToken(idToken)).toBe("dueño@negocio.es");
  });
  it("devuelve '' si no hay id_token o es inválido", () => {
    expect(emailFromIdToken(undefined)).toBe("");
    expect(emailFromIdToken("no-es-jwt")).toBe("");
  });
});
