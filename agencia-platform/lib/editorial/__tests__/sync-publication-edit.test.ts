import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/api/auth", () => ({ ApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } } }));
import { lockEditorialEdit, syncPublicationEdit } from "../sync-publication-edit";

const channel = (status: string) => ({ id: status, status, metaJson: { history: [{ status: "PENDING" }], mediaUrls: ["image"] } });
const locked = (...states: string[]) => ({ post: { id: "p", clientId: "client" }, channels: states.map(channel) }) as any;
const client = () => ({ editorialPublication: { update: vi.fn().mockResolvedValue({}) } }) as any;

describe("synchronizing queued publications on edits", () => {
  it("moves pending/scheduled channels atomically to the new time, retaining history and media", async () => {
    const tx = client();
    const scheduledFor = new Date(Date.now() + 100000);
    await syncPublicationEdit(tx, locked("PENDING", "SCHEDULED", "PUBLISHED", "FAILED"), { scheduledFor }, "u");
    expect(tx.editorialPublication.update).toHaveBeenCalledTimes(2);
    expect(tx.editorialPublication.update.mock.calls[0][0].data).toMatchObject({ status: "SCHEDULED", scheduledFor, metaJson: { mediaUrls: ["image"] } });
    expect(tx.editorialPublication.update.mock.calls[0][0].data.metaJson.history).toHaveLength(2);
  });
  it.each([{ clientId: "other" }, { status: "DRAFT" }, { status: "REVIEW" }, { status: "ARCHIVED" }, { status: "PUBLISHED" }])("cancels all unsent attempts for %o", async (change) => {
    const tx = client();
    await syncPublicationEdit(tx, locked("PENDING", "SCHEDULED", "FAILED", "PUBLISHED"), change);
    expect(tx.editorialPublication.update).toHaveBeenCalledTimes(3);
    expect(tx.editorialPublication.update.mock.calls.every(([arg]: any[]) => arg.data.status === "CANCELLED" && arg.data.scheduledFor === null)).toBe(true);
  });
  it("rejects past or cleared live schedules, while permitting past draft calendar dates", async () => {
    await expect(syncPublicationEdit(client(), locked("SCHEDULED"), { scheduledFor: null })).rejects.toThrow("fecha futura");
    await expect(syncPublicationEdit(client(), locked("PENDING"), { scheduledFor: new Date(0) })).rejects.toThrow("fecha futura");
    await expect(syncPublicationEdit(client(), locked(), { scheduledFor: new Date(0) })).resolves.toBeUndefined();
  });
  it("rejects edits when a channel is publishing after acquiring scoped locks", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), editorialPost: { findFirst: vi.fn().mockResolvedValue({ id: "p" }) }, editorialPublication: { findMany: vi.fn().mockResolvedValue([channel("PUBLISHING")]) } } as any;
    await expect(lockEditorialEdit(tx, "p", "w")).rejects.toThrow("se está enviando");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.editorialPublication.findMany).toHaveBeenCalledWith({ where: { postId: "p", workspaceId: "w" } });
  });
});
