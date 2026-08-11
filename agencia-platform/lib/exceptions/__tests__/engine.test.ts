/**
 * Contrato FASE 4a — motor de excepciones: collectors, dedupe, orden, filtros.
 */
import { describe, it, expect } from "vitest";
import {
  fromAiDrafts,
  fromAiRuns,
  fromInvoices,
  fromTasks,
  dedupe,
  sortExceptions,
  applyFilters,
  summarize,
  coerceFilters,
  type ExceptionItem
} from "../engine";

const NOW = new Date("2026-08-11T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("fromAiDrafts", () => {
  it("PENDING → aprobación (money/msg high), FAILED → automation_failed", () => {
    const items = fromAiDrafts(
      [
        { id: "d1", kind: "STRIPE_PAYMENT_LINK", status: "PENDING", taskId: null, reviewedById: null, createdAt: daysAgo(1) },
        { id: "d2", kind: "EDITORIAL_POST", status: "PENDING", taskId: null, reviewedById: "u1", createdAt: daysAgo(1) },
        { id: "d3", kind: "WHATSAPP", status: "FAILED", taskId: null, reviewedById: null, createdAt: daysAgo(2) }
      ],
      NOW
    );
    expect(items.find((i) => i.id === "ai_draft:d1")?.severity).toBe("high");
    expect(items.find((i) => i.id === "ai_draft:d2")?.kind).toBe("approval_pending");
    expect(items.find((i) => i.id === "ai_draft:d2")?.severity).toBe("medium");
    expect(items.find((i) => i.id === "ai_draft:d3")?.kind).toBe("automation_failed");
    // explicabilidad presente
    expect(items[0].why).toBeTruthy();
    expect(items[0].needsFromMe).toBeTruthy();
  });
});

describe("fromAiRuns", () => {
  it("REQUIRES_HUMAN reciente → message_unresolved; >2d → sla_breached", () => {
    const items = fromAiRuns(
      [
        { id: "r1", status: "REQUIRES_HUMAN", taskId: "t1", summary: "necesito ok", error: null, createdAt: daysAgo(1) },
        { id: "r2", status: "REQUIRES_HUMAN", taskId: "t2", summary: null, error: null, createdAt: daysAgo(3) },
        { id: "r3", status: "FAILED", taskId: "t3", summary: null, error: "boom", createdAt: daysAgo(1) }
      ],
      NOW
    );
    expect(items.find((i) => i.id === "ai_run:r1")?.kind).toBe("message_unresolved");
    expect(items.find((i) => i.id === "ai_run:r2")?.kind).toBe("sla_breached");
    expect(items.find((i) => i.id === "ai_run:r2")?.severity).toBe("high");
    expect(items.find((i) => i.id === "ai_run:r3")?.kind).toBe("automation_failed");
  });
});

describe("fromInvoices", () => {
  it("solo vencidas ISSUED con saldo; severidad por impacto (mora × importe)", () => {
    const items = fromInvoices(
      [
        // 40 días + importe alto (3000€) → critical
        { id: "i1", number: "F-1", status: "ISSUED", totalCents: 300000, paidCents: 0, dueDate: daysAgo(40), clientId: "c1", clientName: "Acme" },
        // 3 días + importe bajo (100€) → low
        { id: "i2", number: "F-2", status: "ISSUED", totalCents: 10000, paidCents: 0, dueDate: daysAgo(3), clientId: "c2" },
        { id: "i3", number: "F-3", status: "PAID", totalCents: 10000, paidCents: 10000, dueDate: daysAgo(40), clientId: "c3" },
        { id: "i4", number: "F-4", status: "DRAFT", totalCents: 10000, paidCents: 0, dueDate: daysAgo(40), clientId: "c4" }
      ],
      NOW
    );
    expect(items.map((i) => i.id)).toEqual(["invoice:i1", "invoice:i2"]);
    expect(items[0].severity).toBe("critical"); // 40d + alto
    expect(items[0].amountBand).toBe("alto");
    expect(items[0].clientName).toBe("Acme");
    expect(items[1].severity).toBe("low"); // 3d + bajo
  });
});

describe("fromTasks", () => {
  it("solo vencidas abiertas; severidad por recencia (fresca = urgente, no por edad)", () => {
    const items = fromTasks(
      [
        { id: "t1", title: "A", dueDate: daysAgo(3), completedAt: null, clientId: null }, // fresca sin cliente
        { id: "t2", title: "B", dueDate: daysAgo(10), completedAt: daysAgo(1), clientId: "c1" }, // hecha
        { id: "t3", title: "C", dueDate: new Date(NOW.getTime() + 86_400_000), completedAt: null, clientId: null }, // futura
        { id: "t4", title: "D", dueDate: daysAgo(400), completedAt: null, clientId: null } // antiquísima
      ],
      NOW
    );
    expect(items.map((i) => i.id)).toEqual(["task:t1", "task:t4"]);
    expect(items[0].severity).toBe("high"); // 3d fresca → urgente
    expect(items[1].severity).toBe("low"); // 400d → histórica, baja urgencia
    // "Qué hará SONIA" nunca es null (propone siguiente paso real)
    expect(items[0].soniaWillDo).toBeTruthy();
    expect(items[1].soniaWillDo).toBeTruthy();
  });

  it("tarea de cliente sube un tramo de severidad", () => {
    const items = fromTasks([{ id: "t1", title: "A", dueDate: daysAgo(20), completedAt: null, clientId: "c1", clientName: "Acme" }], NOW);
    // 20d sin cliente = medium; con cliente sube a high
    expect(items[0].severity).toBe("high");
    expect(items[0].clientName).toBe("Acme");
  });
});

describe("dedupe / sort / filtros / resumen", () => {
  const items: ExceptionItem[] = [
    // 40 días + importe alto → critical
    ...fromInvoices([{ id: "i1", number: "F", status: "ISSUED", totalCents: 300000, paidCents: 0, dueDate: daysAgo(40), clientId: "c1" }], NOW),
    ...fromTasks([{ id: "t1", title: "X", dueDate: daysAgo(2), completedAt: null, clientId: "c2" }], NOW)
  ];

  it("dedupe conserva el de mayor severidad por dedupeKey", () => {
    const dupHigh = { ...items[0], severity: "high" as const };
    const merged = dedupe([items[0], dupHigh]); // mismo dedupeKey
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe("critical"); // gana el más severo
  });

  it("sort: severidad desc luego más antiguo", () => {
    const sorted = sortExceptions(items);
    expect(sorted[0].severity).toBe("critical");
  });

  it("filtros por source/severity/cliente", () => {
    expect(applyFilters(items, { source: "invoice" })).toHaveLength(1);
    expect(applyFilters(items, { clientId: "c2" })[0].source).toBe("task");
    expect(applyFilters(items, { severity: "low" })).toHaveLength(0);
  });

  it("summarize cuenta por severidad", () => {
    const s = summarize(items);
    expect(s.total).toBe(2);
    expect(s.critical).toBe(1);
  });

  it("dedupe cross-source: draft FAILED + run FAILED de la MISMA tarea → 1 ítem", () => {
    const draftFail = fromAiDrafts([{ id: "d", kind: "WHATSAPP", status: "FAILED", taskId: "t9", reviewedById: null, createdAt: daysAgo(1) }], NOW);
    const runFail = fromAiRuns([{ id: "r", status: "FAILED", taskId: "t9", summary: null, error: "x", createdAt: daysAgo(1) }], NOW);
    expect(dedupe([...draftFail, ...runFail])).toHaveLength(1);
  });
});

describe("coerceFilters", () => {
  it("valores inválidos → undefined (sin filtro); válidos pasan", () => {
    expect(coerceFilters({ severity: "NOPE" }).severity).toBeUndefined();
    expect(coerceFilters({ severity: "high" }).severity).toBe("high");
    expect(coerceFilters({ source: "invoice", kind: "bad" })).toMatchObject({ source: "invoice", kind: undefined });
    expect(coerceFilters({ clientId: "  c1  " }).clientId).toBe("c1");
  });
});
