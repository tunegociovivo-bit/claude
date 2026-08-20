import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production container startup", () => {
  it("applies the commercial handoff schema before starting the application", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "npx prisma db execute --file prisma/migrations/20260820103500_lead_commercial_handoff/migration.sql --schema prisma/schema.prisma",
    );
    expect(dockerfile.indexOf("db execute")).toBeLessThan(dockerfile.indexOf("node server.js"));
  });
});
