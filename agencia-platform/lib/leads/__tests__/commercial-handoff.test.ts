import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commercialLeadDescription, findCommercialColumnId } from "../commercial-handoff";

describe("commercial lead handoff", () => {
  it("resolves LEADS GMB by stable id even when its visual order changes", () => {
    const before = [
      { id: "NEW_CLIENTS", label: "NUEVOS CLIENTES 2022", order: 0 },
      { id: "GMB_LEADS", label: "LEADS GMB", order: 1 }
    ];
    const after = [before[1], before[0]];

    expect(findCommercialColumnId(before)).toBe("GMB_LEADS");
    expect(findCommercialColumnId(after)).toBe("GMB_LEADS");
  });

  it("returns null instead of silently using the first column", () => {
    expect(findCommercialColumnId([{ id: "TODO", label: "Pendiente" }])).toBeNull();
  });

  it("includes the business details in the task description", () => {
    const text = commercialLeadDescription({
      name: "Clínica Ejemplo",
      phone: "+34 600 000 000",
      website: "https://example.com",
      province: "Málaga",
      rating: 4.2,
      reviewsCount: 37,
      score: 82,
      urgency: "alta",
      gmbUrl: "https://maps.google.com/example",
      notes: "Llamar por la tarde",
      createdAt: new Date("2026-08-20T08:49:00.000Z"),
    });

    expect(text).toContain("Clínica Ejemplo");
    expect(text).toContain("+34 600 000 000");
    expect(text).toContain("Llamar por la tarde");
    expect(text).toContain("Fecha de entrada del lead: 20/08/2026, 10:49");
  });

  it("executes the PostgreSQL advisory lock without deserializing its void result", () => {
    const route = readFileSync(
      resolve(process.cwd(), "app/api/v1/leads/[id]/send-to-commercial/route.ts"),
      "utf8",
    );

    expect(route).toContain("tx.$executeRaw`SELECT pg_advisory_xact_lock");
    expect(route).not.toContain("tx.$queryRaw`SELECT pg_advisory_xact_lock");
  });
});
