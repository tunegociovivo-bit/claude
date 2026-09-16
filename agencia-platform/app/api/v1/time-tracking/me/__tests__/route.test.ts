import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ sessions: vi.fn(), activities: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { timeTrackerSession: { findMany: db.sessions }, timeTrackerActivity: { findMany: db.activities } } }));
vi.mock("@/lib/api/handler", () => ({ withApi: (_options: unknown, handler: unknown) => handler }));
vi.mock("@/lib/api/auth", () => ({ ApiError: class extends Error { constructor(public status: number, code: string, message: string) { super(message); } } }));
import { GET } from "../route";
const context = { api: { userId: "worker", workspaceId: "workspace" } };
const call = (query: string) => (GET as any)(new Request(`https://example.test/api/v1/time-tracking/me${query}`), context);
describe("daily desktop summary", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-16T08:00:00Z")); db.activities.mockResolvedValue([]); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
  it("counts only today's portion of an overnight session and excludes a pause", async () => {
    db.sessions.mockResolvedValue([
      { startedAt: new Date("2026-09-15T21:00:00Z"), endedAt: new Date("2026-09-15T23:00:00Z") },
      { startedAt: new Date("2026-09-16T07:00:00Z"), endedAt: null }
    ]);
    const response = await call("?dayStart=2026-09-15T22:00:00Z&dayEnd=2026-09-16T22:00:00Z");
    expect(await response.json()).toMatchObject({ workedSec: 7200, active: true, startedAt: "2026-09-15T21:00:00.000Z" });
    expect(db.sessions.mock.calls[0][0].where).toMatchObject({ userId: "worker", workspaceId: "workspace", OR: [{ endedAt: null }, { endedAt: { gt: new Date("2026-09-15T22:00:00Z") } }] });
  });
  it("returns a zero total before the first entry", async () => {
    db.sessions.mockResolvedValue([]);
    expect(await (await call("")).json()).toMatchObject({ workedSec: 0, active: false, startedAt: null });
  });
  it("rejects invalid day boundaries", async () => {
    await expect(call("?dayStart=invalid&dayEnd=invalid")).rejects.toThrow("Intervalo del día inválido");
    expect(db.sessions).not.toHaveBeenCalled();
  });
});
