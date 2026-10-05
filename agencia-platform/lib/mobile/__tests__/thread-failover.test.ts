import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    mobileAutomationJob: { findMany: vi.fn(), updateMany: vi.fn() },
    mobileAutomationJobEvent: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() }
  } as any
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { failoverBlockedThreadMessages, markDeviceSeen, resetFailoverStateForTests } from "../thread-failover";

const now = new Date("2026-10-05T18:00:00Z");
const threadId = "22222222-2222-4222-8222-222222222222";
const message = (over: Record<string, unknown> = {}) => JSON.stringify({ kind: "comment_thread", version: 1, threadId, order: 1, total: 2,
  postUrl: "https://www.facebook.com/reel/1", guide: "g", author: "A", mode: "comment", replyToOrder: null, replyToAuthor: null,
  replyToText: null, parentJobId: null, previousJobId: null, text: "Hola", outcome: "pending", detail: null, ...over });
const job = (over: Record<string, unknown> = {}) => ({ id: "j1", status: "QUEUED", deviceSerial: "AAA", idempotencyKey: `thread:${threadId}:1`,
  text: message(), scheduledAt: new Date(now.getTime() - 60_000), createdAt: new Date(now.getTime() - 3_600_000), leaseUntil: null, ...over });
const phone = (key: string, serial: string) => ({ key, sessionName: key, label: `+34 ${key}`, phone: key, deviceSerial: serial, active: true, principal: false, proxyConfigured: false, androidProxy: null });
const phones = [phone("a", "AAA"), phone("b", "BBB"), phone("c", "CCC"), phone("d", "DDD")];

function setup(candidates: unknown[], failures: number, threadSerials: string[], busySerials: string[] = []) {
  prisma.mobileAutomationJob.findMany.mockImplementation(async (args: any) => {
    if (args.where?.idempotencyKey) return threadSerials.map((deviceSerial) => ({ deviceSerial }));
    if (args.where?.OR) return busySerials.map((deviceSerial) => ({ deviceSerial }));
    return candidates;
  });
  prisma.mobileAutomationJobEvent.findFirst.mockResolvedValue(null);
  prisma.mobileAutomationJobEvent.count.mockResolvedValue(failures);
  prisma.mobileAutomationJob.updateMany.mockResolvedValue({ count: 1 });
}

beforeEach(() => { vi.clearAllMocks(); resetFailoverStateForTests(); });

describe("reasignar mensajes bloqueados a otro móvil", () => {
  it("tras 3 fallos pasa el mensaje a un móvil conectado, libre y sin mensajes en la conversación", async () => {
    setup([job()], 3, ["AAA", "BBB"], ["CCC"]);
    for (const serial of ["AAA", "BBB", "CCC", "DDD"]) markDeviceSeen("w", serial, now.getTime());
    const moved = await failoverBlockedThreadMessages("w", phones, now);
    expect(moved).toEqual([{ jobId: "j1", from: "AAA", to: "DDD" }]);
    const update = prisma.mobileAutomationJob.updateMany.mock.calls[0][0];
    expect(update.data).toMatchObject({ deviceSerial: "DDD", phoneKey: "d", status: "QUEUED", attempts: 0 });
    expect(JSON.parse(update.data.text).author).toBe("+34 d");
  });
  it("no mueve con menos fallos si el móvil está conectado", async () => {
    setup([job()], 2, ["AAA"]);
    for (const serial of ["AAA", "DDD"]) markDeviceSeen("w", serial, now.getTime());
    expect(await failoverBlockedThreadMessages("w", phones, now)).toEqual([]);
  });
  it("mueve un mensaje cuyo móvil lleva 15 minutos sin conectarse", async () => {
    setup([job({ scheduledAt: new Date(now.getTime() - 20 * 60_000) })], 0, ["AAA"]);
    markDeviceSeen("w", "BBB", now.getTime());
    expect((await failoverBlockedThreadMessages("w", phones, now))[0]?.to).toBe("BBB");
  });
  it("nunca mueve un envío pendiente de comprobar (podría duplicarse)", async () => {
    setup([job({ text: message({ outcome: "review" }) })], 5, ["AAA"]);
    markDeviceSeen("w", "BBB", now.getTime());
    expect(await failoverBlockedThreadMessages("w", phones, now)).toEqual([]);
  });
  it("si no hay ningún móvil libre y conectado, lo deja donde está", async () => {
    setup([job()], 4, ["AAA", "BBB"], ["CCC"]);
    markDeviceSeen("w", "BBB", now.getTime()); markDeviceSeen("w", "CCC", now.getTime());
    expect(await failoverBlockedThreadMessages("w", phones, now)).toEqual([]);
  });
});
