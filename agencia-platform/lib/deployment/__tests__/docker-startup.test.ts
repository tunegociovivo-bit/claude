import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production container startup", () => {
  it("does not start the application when the database schema sync fails", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "npx prisma db push --accept-data-loss=false --skip-generate && node server.js",
    );
    expect(dockerfile).not.toContain(
      "npx prisma db push --accept-data-loss=false --skip-generate; node server.js",
    );
  });
});
