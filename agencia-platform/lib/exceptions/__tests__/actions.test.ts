/**
 * Contrato Slice 2b — acciones sobre excepciones (lógica pura): validación,
 * vigencia (caducidad/revocación), y filtrado de la bandeja por severidad.
 */
import { describe, it, expect } from "vitest";
import { validateActionInput, isLive, applyHidden, liveHiddenKeys, hideKey, parseExceptionId, isActionType } from "../actions";
import { fromTasks, type ExceptionItem } from "../engine";

const NOW = new Date("2026-08-11T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const item = (id: string, days: number): ExceptionItem => fromTasks([{ id, title: id, dueDate: daysAgo(days), completedAt: null, clientId: null }], NOW)[0];

describe("parseExceptionId / isActionType", () => {
  it("parsea source:rowId y rechaza basura", () => {
    expect(parseExceptionId("task:t1")).toEqual({ source: "task", rowId: "t1" });
    expect(parseExceptionId("nope")).toBeNull();
    expect(parseExceptionId(":x")).toBeNull();
    expect(parseExceptionId("task:")).toBeNull();
    expect(isActionType("archive")).toBe(true);
    expect(isActionType("nuke")).toBe(false);
  });
});

describe("validateActionInput", () => {
  it("acepta payload válido y normaliza", () => {
    const r = validateActionInput({ exceptionId: "task:t1", action: "archive", reason: "ya no aplica", severity: "high" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.exceptionId).toBe("task:t1");
      expect(r.value.dedupeKey).toBe("task:t1"); // fallback al id
      expect(r.value.source).toBe("task");
    }
  });
  it("rechaza exceptionId/acción inválidos y expiresAt no fecha", () => {
    expect(validateActionInput({ exceptionId: "bad", action: "archive" }).ok).toBe(false);
    expect(validateActionInput({ exceptionId: "task:t1", action: "nuke" }).ok).toBe(false);
    expect(validateActionInput({ exceptionId: "task:t1", action: "snooze", expiresAt: "no-fecha" }).ok).toBe(false);
  });
});

describe("isLive", () => {
  it("revocada → no viva; caducada → no viva; vigente → viva", () => {
    expect(isLive({ exceptionId: "x", action: "archive", revokedAt: daysAgo(1) }, NOW)).toBe(false);
    expect(isLive({ exceptionId: "x", action: "snooze", expiresAt: daysAgo(1) }, NOW)).toBe(false);
    expect(isLive({ exceptionId: "x", action: "snooze", expiresAt: new Date(NOW.getTime() + 86_400_000) }, NOW)).toBe(true);
    expect(isLive({ exceptionId: "x", action: "archive" }, NOW)).toBe(true); // sin caducidad
  });
});

describe("applyHidden (filtra por id+severidad; re-aparece al escalar)", () => {
  it("oculta la severidad archivada, pero NO si la incidencia escala", () => {
    const t = item("t1", 3); // high
    const hiddenHigh = [{ exceptionId: "task:t1", action: "archive", severity: "high" as string }];
    expect(applyHidden([t], hiddenHigh, NOW)).toHaveLength(0);
    // si estaba archivada como 'medium' y ahora es 'high' → re-aparece
    const hiddenMedium = [{ exceptionId: "task:t1", action: "archive", severity: "medium" as string }];
    expect(applyHidden([t], hiddenMedium, NOW)).toHaveLength(1);
  });
  it("una acción caducada no oculta", () => {
    const t = item("t1", 3);
    const expired = [{ exceptionId: "task:t1", action: "snooze", severity: "high", expiresAt: daysAgo(1) }];
    expect(applyHidden([t], expired, NOW)).toHaveLength(1);
  });
  it("acciones no-ocultadoras (reschedule) no filtran", () => {
    const t = item("t1", 3);
    const resched = [{ exceptionId: "task:t1", action: "reschedule", severity: "high" }];
    expect(applyHidden([t], resched, NOW)).toHaveLength(1);
  });
});

describe("liveHiddenKeys / hideKey", () => {
  it("solo cuenta acciones de ocultar vivas", () => {
    const keys = liveHiddenKeys(
      [
        { exceptionId: "task:a", action: "archive", severity: "high" },
        { exceptionId: "task:b", action: "reschedule", severity: "high" }, // no oculta
        { exceptionId: "task:c", action: "snooze", severity: "low", expiresAt: daysAgo(1) } // caducada
      ],
      NOW
    );
    expect(keys.has(hideKey("task:a", "high"))).toBe(true);
    expect(keys.has(hideKey("task:b", "high"))).toBe(false);
    expect(keys.has(hideKey("task:c", "low"))).toBe(false);
  });
});
