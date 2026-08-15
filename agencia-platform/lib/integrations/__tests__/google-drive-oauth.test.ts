import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { driveAuthorizeUrl, driveOAuthConfigured, signDriveState, verifyDriveState } from "../google-drive-oauth";

describe("Google Drive OAuth", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-with-enough-entropy";
    process.env.NEXTAUTH_URL = "https://hub.example.com";
    process.env.GOOGLE_CLIENT_ID = "client.apps.googleusercontent.com";
  });
  afterEach(() => {
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_URL;
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it("firma y valida un state ligado a usuario y workspace", () => {
    const payload = { userId: "u1", workspaceId: "w1", ts: 123 };
    expect(verifyDriveState(signDriveState(payload))).toEqual(payload);
  });

  it("rechaza state manipulado", () => {
    const signed = signDriveState({ userId: "u1", workspaceId: "w1", ts: 123 });
    expect(verifyDriveState(`${signed.slice(0, -1)}x`)).toBeNull();
  });

  it("falla cerrado si falta NEXTAUTH_SECRET", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(() => signDriveState({ userId: "u1", workspaceId: "w1", ts: 123 })).toThrow("NEXTAUTH_SECRET");
  });

  it("pide permiso offline de Drive y usa el callback propio", () => {
    const url = new URL(driveAuthorizeUrl("state"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("auth/drive.file");
    expect(url.searchParams.get("redirect_uri")).toBe("https://hub.example.com/api/integrations/google-drive/callback");
  });

  it("detecta la configuración incompleta antes de iniciar OAuth", () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(driveOAuthConfigured()).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(driveOAuthConfigured()).toBe(true);
  });
});
