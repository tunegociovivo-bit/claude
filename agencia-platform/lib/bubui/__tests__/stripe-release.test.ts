import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cancelSubscriptionImmediately, createPushAdCheckout } from "../stripe";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("BUBUI_STRIPE_SECRET_KEY", "fictional-test-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("cancels immediately and waits for Stripe success", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "sub_fake", status: "canceled" }));
  await cancelSubscriptionImmediately("sub_fake");
  expect(fetchMock).toHaveBeenCalledWith("https://api.stripe.com/v1/subscriptions/sub_fake", expect.objectContaining({ method: "DELETE" }));
});
it("allows retry when Stripe confirms that the subscription no longer exists", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: { code: "resource_missing" } }, { status: 404 }));
  await expect(cancelSubscriptionImmediately("sub_fake")).resolves.toBeUndefined();
});
it.each([401, 429, 500, 503])("propagates Stripe failure %s so account deletion cannot continue", async status => {
  fetchMock.mockResolvedValue(Response.json({ error: { code: "unavailable" } }, { status }));
  await expect(cancelSubscriptionImmediately("sub_fake")).rejects.toThrow(`Stripe ${status}`);
});
it("does not confuse an unrelated 404 with a cancelled subscription", async () => {
  fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
  await expect(cancelSubscriptionImmediately("sub_fake")).rejects.toThrow("Stripe 404");
});
it("binds checkout and payment intent to the exact ad with a stable retry key", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "cs_fake", url: "https://example.test/checkout" }));
  await createPushAdCheckout({ customerId: "cus_fake", businessId: "business-test", adId: "paid-ad", priceEur: 10, reach: 100, radiusKm: 1, successUrl: "https://example.test/success", cancelUrl: "https://example.test/cancel" });
  const init = fetchMock.mock.calls[0][1];
  expect(init.body.get("metadata[bubui_ad_id]")).toBe("paid-ad");
  expect(init.body.get("payment_intent_data[metadata][bubui_ad_id]")).toBe("paid-ad");
  expect(init.headers["Idempotency-Key"]).toBe("bubui-push-ad-paid-ad");
  expect(init.body.get("line_items[0][price_data][unit_amount]")).toBe("1000");
});
