import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("challenge registration regressions", () => {
  it("applies a referral when OTP resolves to an existing phone account", () => {
    const route = read("app/api/bubui/customer/verify-otp/route.ts");
    const byPhone = route.slice(route.indexOf("if (byPhone)"), route.indexOf("// 2)"));
    expect(byPhone).toMatch(/await ensureReferralCode\(updated\.id\)/);
    expect(byPhone).toMatch(/await linkReferral\(updated\.id, d\.ref, d\.refOfferId, req\.headers\)/);
  });

  it("sends the concrete offer id to the IP fallback endpoint", () => {
    const redirect = read("app/bubui/r/[code]/ReferralRedirect.tsx");
    expect(redirect).toMatch(/JSON\.stringify\(\{ code, offerId \}\)/);
  });

  it("persists the fallback click before leaving WhatsApp for the app or Play", () => {
    const redirect = read("app/bubui/r/[code]/ReferralRedirect.tsx");
    expect(redirect).toMatch(/keepalive:\s*true/);
    expect(redirect).toMatch(/await persistReferralClick\(code, offerId\)/);
    expect(redirect.indexOf("await persistReferralClick(code, offerId)")).toBeLessThan(
      redirect.indexOf("tryOpenApp();")
    );
  });

  it("persists the concrete offer id with referral clicks", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model BubuiReferralClick"), schema.indexOf("model BubuiCustomDeal"));
    expect(model).toMatch(/offerId\s+String\?/);
  });

  it("passes the concrete offer id through OTP registration", () => {
    const onboarding = read("../apps/bubui-mobile/src/screens/Onboarding.tsx");
    const route = read("app/api/bubui/customer/verify-otp/route.ts");
    expect(onboarding).toMatch(/refOfferId:\s*offerId/);
    expect(route).toMatch(/refOfferId:\s*z\.string/);
    expect(route).toMatch(/linkReferral\(updated\.id, d\.ref, d\.refOfferId, req\.headers\)/);
  });
});
