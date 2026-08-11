/**
 * Contrato Slice 2a — priorización/partición/clustering/secciones.
 * Incluye una regresión del "flood" real de producción (cientos de tareas
 * antiquísimas + pocas recientes accionables) SIN datos reales (sin PII).
 */
import { describe, it, expect } from "vitest";
import { fromTasks, fromInvoices, type ExceptionItem } from "../engine";
import { scoreItem, sortByPriority, isHistorical, partition, clusterHistorical, buildSections, fromDoneRuns } from "../priority";

const NOW = new Date("2026-08-11T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const task = (id: string, days: number, clientId: string | null = null, clientName: string | null = null): ExceptionItem =>
  fromTasks([{ id, title: `T${id}`, dueDate: daysAgo(days), completedAt: null, clientId, clientName }], NOW)[0];

describe("scoreItem / sortByPriority (recencia por encima de la edad)", () => {
  it("una tarea fresca puntúa MÁS que una antiquísima de igual base", () => {
    const fresh = task("a", 2); // high, reciente
    const ancient = task("b", 1400); // low, histórica
    expect(scoreItem(fresh)).toBeGreaterThan(scoreItem(ancient));
  });
  it("ordena lo accionable-ahora primero (no lo más antiguo)", () => {
    const items = [task("old", 1400), task("fresh", 1), task("mid", 20)];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe("task:fresh");
    expect(sorted[sorted.length - 1].id).toBe("task:old");
  });
});

describe("partición actual/histórico", () => {
  it("task/invoice >ventana = histórico; drafts/runs nunca", () => {
    expect(isHistorical(task("x", 200), 90)).toBe(true);
    expect(isHistorical(task("y", 30), 90)).toBe(false);
  });
  it("partition separa activos de históricos", () => {
    const { active, historical } = partition([task("a", 5), task("b", 120), task("c", 400)], 90);
    expect(active.map((i) => i.id)).toEqual(["task:a"]);
    expect(historical.map((i) => i.id).sort()).toEqual(["task:b", "task:c"]);
  });
});

describe("clusterHistorical", () => {
  it("agrupa por (source,kind,cliente) con conteo y etiqueta", () => {
    const hist = [task("1", 200, "c1", "Acme"), task("2", 300, "c1", "Acme"), task("3", 250, null)];
    const clusters = clusterHistorical(hist, 90);
    const acme = clusters.find((c) => c.clientName === "Acme");
    expect(acme?.count).toBe(2);
    expect(acme?.label).toContain("2 tareas vencidas");
    expect(acme?.label).toContain("Acme");
    // el más grande primero
    expect(clusters[0].count).toBeGreaterThanOrEqual(clusters[clusters.length - 1].count);
  });
});

describe("buildSections (inicio ejecutivo)", () => {
  it("hoy / cobros / clientes en riesgo", () => {
    const inv = fromInvoices([{ id: "i1", number: "F1", status: "ISSUED", totalCents: 300000, paidCents: 0, dueDate: daysAgo(0.5), clientId: "c1", clientName: "Acme" }], NOW)[0];
    const t1 = task("t1", 0.5, "c1", "Acme"); // hoy (12h), cliente Acme
    const t2 = task("t2", 3, "c1", "Acme"); // cliente Acme (2ª incidencia → riesgo)
    const s = buildSections([inv, t1, t2], NOW);
    expect(s.today.length).toBeGreaterThanOrEqual(2); // inv(0d) + t1(0d)
    expect(s.billingSla.map((i) => i.id)).toContain("invoice:i1");
    const acme = s.clientsAtRisk.find((r) => r.clientId === "c1");
    expect(acme?.count).toBeGreaterThanOrEqual(2);
  });
});

describe("fromDoneRuns", () => {
  it("mapea runs SUCCEEDED a evidencia de valor", () => {
    const done = fromDoneRuns([{ id: "r1", taskId: "t9", summary: "Publiqué el post", finishedAt: daysAgo(1), createdAt: daysAgo(1) }], NOW);
    expect(done[0]).toMatchObject({ id: "done:r1", taskId: "t9", link: "/tareas?task=t9" });
    expect(done[0].title).toContain("Publiqué");
  });
});

describe("REGRESIÓN flood real: 500 tareas antiquísimas + 3 recientes", () => {
  it("las recientes encabezan; las antiguas quedan como histórico agrupado, no inundan", () => {
    const ancient: ExceptionItem[] = Array.from({ length: 500 }, (_, i) => task(`old${i}`, 1400 + i));
    const recent = [task("r1", 1, "c1", "Acme"), task("r2", 4, "c2", "Beta"), task("r3", 6)];
    const all = [...ancient, ...recent];

    const { active, historical } = partition(all, 90);
    expect(active).toHaveLength(3);
    expect(historical).toHaveLength(500);

    const top = sortByPriority(active);
    expect(top.map((i) => i.id)).toEqual(["task:r1", "task:r2", "task:r3"]);
    // Ninguna activa marcada por edad como grave incorrectamente:
    expect(active.every((i) => i.ageMs <= 90 * 86_400_000)).toBe(true);

    const clusters = clusterHistorical(historical, 90);
    // 500 antiguas sin cliente → 1 cluster grande
    expect(clusters[0].count).toBe(500);
    expect(clusters[0].label).toContain("tareas vencidas hace más de 90 días");
  });
});
