import { afterEach, describe, expect, it } from "vitest";
import { signGoogleAdsState, verifyGoogleAdsState } from "@/lib/integrations/google-ads-oauth";

describe("Google Ads OAuth state", () => {
  const old = process.env.NEXTAUTH_SECRET;
  afterEach(() => { process.env.NEXTAUTH_SECRET = old; });
  it("firma y valida la cuenta y el administrador", () => {
    process.env.NEXTAUTH_SECRET = "test-secret";
    const payload = { userId: "u1", workspaceId: "w1", accountEmail: "a@example.com", managerId: "123", label: "Cuenta", ts: Date.now() };
    expect(verifyGoogleAdsState(signGoogleAdsState(payload))).toEqual(payload);
  });
  it("rechaza estados manipulados", () => {
    process.env.NEXTAUTH_SECRET = "test-secret";
    const state = signGoogleAdsState({ userId: "u1", workspaceId: "w1", accountEmail: "a@example.com", managerId: "123", label: "Cuenta", ts: Date.now() });
    expect(verifyGoogleAdsState(`${state.slice(0, -1)}x`)).toBeNull();
  });
});
