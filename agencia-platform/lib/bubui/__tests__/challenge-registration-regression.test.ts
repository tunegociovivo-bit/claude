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
    expect(byPhone).toMatch(/await linkReferral\(updated\.id, d\.ref, req\.headers\)/);
  });

  it("sends the concrete offer id to the IP fallback endpoint", () => {
    const redirect = read("app/bubui/r/[code]/ReferralRedirect.tsx");
    expect(redirect).toMatch(/JSON\.stringify\(\{ code, offerId \}\)/);
  });

  it("persists the concrete offer id with referral clicks", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model BubuiReferralClick"), schema.indexOf("model BubuiCustomDeal"));
    expect(model).toMatch(/offerId\s+String\?/);
  });
});
