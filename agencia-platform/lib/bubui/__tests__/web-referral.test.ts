import { describe, expect, it, vi } from "vitest";
import { applyPendingWebReferral, referralAppUrl, rememberWebReferral } from "../web-referral";
import { friendChallengeMessage } from "../friend-challenge-message";

function storage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}

describe("web challenge invitation", () => {
  it("keeps the exact challenge through the desktop redirect", () => {
    expect(referralAppUrl("TEST01", "challenge-2")).toBe("/bubui/app?ref=TEST01&offer=challenge-2");
  });
  it("clears an older challenge when a generic invitation replaces it", () => {
    const s = storage();
    rememberWebReferral(s, "TEST01", "challenge-1");
    rememberWebReferral(s, "TEST02");
    expect(s.getItem("bubui.ref")).toBe("TEST02");
    expect(s.getItem("bubui.refOffer")).toBeNull();
  });
  it("sends the exact challenge and only clears the invitation once confirmed", async () => {
    const s = storage();
    rememberWebReferral(s, "TEST01", "challenge-2");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ linked: true, terminal: true })));
    expect(await applyPendingWebReferral("customer", s, { Authorization: "Bearer test" }, request)).toBe(true);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ customerId: "customer", code: "TEST01", offerId: "challenge-2" });
    expect(s.getItem("bubui.ref")).toBeNull();
  });
  it.each([503, 401])("keeps the pending invitation on HTTP %i", async status => {
    const s = storage();
    rememberWebReferral(s, "TEST01", "challenge-2");
    await expect(applyPendingWebReferral("customer", s, {}, vi.fn().mockResolvedValue(new Response("{}", { status })))).rejects.toThrow();
    expect(s.getItem("bubui.refOffer")).toBe("challenge-2");
  });
  it("keeps a partially applied invitation for retry", async () => {
    const s = storage();
    rememberWebReferral(s, "TEST01", "challenge-2");
    await expect(applyPendingWebReferral("customer", s, {}, vi.fn().mockResolvedValue(new Response(JSON.stringify({ linked: true, terminal: false }))))).rejects.toThrow();
    expect(s.getItem("bubui.ref")).toBe("TEST01");
  });
  it("does not erase a newer invitation opened in another tab", async () => {
    const s = storage();
    rememberWebReferral(s, "TEST01", "challenge-2");
    const request = vi.fn().mockImplementation(async () => {
      rememberWebReferral(s, "TEST02", "challenge-3");
      return new Response(JSON.stringify({ linked: true, terminal: true }));
    });
    await applyPendingWebReferral("customer", s, {}, request);
    expect(s.getItem("bubui.refOffer")).toBe("challenge-3");
  });
  it("includes a verified phone and correct prices in the message", () => {
    const message = friendChallengeMessage({ business: { name: "Negocio ficticio" }, contact: { name: "Amiga ficticia", phone: "+34600000000" }, challengeServicePrice: 250, discountPct: 20 });
    expect(message).toContain("Mi teléfono: +34600000000");
    expect(message).toContain("50,00 €");
    expect(message).toContain("200,00 €");
  });
});
