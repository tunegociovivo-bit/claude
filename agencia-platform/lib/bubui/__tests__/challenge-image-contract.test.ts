import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

describe("business challenge image contract", () => {
  it("persists and exposes a custom challenge image", () => {
    const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const profile = fs.readFileSync(path.join(root, "app/api/bubui/business/[id]/profile/route.ts"), "utf8");
    const dashboard = fs.readFileSync(path.join(root, "app/api/bubui/business/[id]/dashboard/route.ts"), "utf8");
    expect(schema).toContain("challengeImageUrl");
    expect(profile).toContain("challengeImageUrl");
    expect(dashboard).toContain("challengeImageUrl");
  });

  it("shows the default preview and a custom upload control in the business portal", () => {
    const page = fs.readFileSync(path.join(root, "app/bubui/negocio/page.tsx"), "utf8");
    expect(page).toContain("/bubui/challenge-default.png");
    expect(page).toContain("Imagen personalizada del reto");
    expect(page).toContain("challengeImageUrl");
    expect(page).not.toContain('challengeImageUrl || business.logoUrl || "/bubui/challenge-default.png"');
  });
});
