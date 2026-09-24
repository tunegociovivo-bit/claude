import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  editorialPost: { findFirst: vi.fn(), update: vi.fn() },
  editorialMetaProfile: { findFirst: vi.fn() },
  editorialPublication: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), upsert: vi.fn(), count: vi.fn() }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/meta/connection", () => ({ readMetaTokenByConnection: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/storage/resign", () => ({ resignUrlLong: vi.fn(async (value) => value) }));
import { prepareEditorialPublications, publishEditorialPublication } from "../meta-publishing";

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe("Meta publishing safeguards", () => {
  it("blocks ambiguous publish timeouts instead of enabling a duplicate retry", async () => {
    db.editorialPublication.findFirst.mockResolvedValue({ id: "dest", workspaceId: "w", status: "PENDING", network: "facebook", profile: { workspaceId: "w", clientId: "c", active: true, metaConnectionId: "conn", facebookPageId: "page" }, post: { workspaceId: "w", clientId: "c", status: "APPROVED", mediaUrls: "[]", content: "Hola" } });
    db.editorialPublication.updateMany.mockResolvedValue({ count: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "page-token" }) }).mockRejectedValueOnce(new Error("network timeout")));
    await expect(publishEditorialPublication("w", "dest")).rejects.toThrow("no confirmó");
    expect(db.editorialPublication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "UNKNOWN" }) }));
  });
  it("requires explicitly selected carousel assets instead of all historic versions", async () => {
    db.editorialPost.findFirst.mockResolvedValue({ id: "p", clientId: "c", status: "APPROVED", format: "carrusel", mediaUrls: '["https://example.com/old.jpg","https://example.com/new.jpg"]' });
    await expect(prepareEditorialPublications({ workspaceId: "w", postId: "p" })).rejects.toThrow("Selecciona entre");
  });
  it("requires approval instead of silently approving drafts", async () => {
    db.editorialPost.findFirst.mockResolvedValue({ id: "p", clientId: "c", status: "DRAFT" });
    await expect(prepareEditorialPublications({ workspaceId: "w", postId: "p" })).rejects.toThrow("Aprueba");
    expect(db.editorialPublication.upsert).not.toHaveBeenCalled();
  });
  it("rejects scheduling without a future date", async () => {
    db.editorialPost.findFirst.mockResolvedValue({ id: "p", clientId: "c", status: "APPROVED", scheduledFor: new Date(0) });
    await expect(prepareEditorialPublications({ workspaceId: "w", postId: "p", schedule: true })).rejects.toThrow("futura");
  });
  it("never resets published destinations when retrying a partial publication", async () => {
    const published = { id: "dest", status: "PUBLISHED" };
    db.editorialPost.findFirst.mockResolvedValue({ id: "p", clientId: "c", status: "PUBLISHED" });
    db.editorialMetaProfile.findFirst.mockResolvedValue({ id: "profile", facebookPageId: "page" });
    db.editorialPublication.findUnique.mockResolvedValue(published);
    const rows = await prepareEditorialPublications({ workspaceId: "w", postId: "p", networks: ["facebook"] });
    expect(rows).toEqual([published]);
    expect(db.editorialPublication.upsert).not.toHaveBeenCalled();
  });
  it("claims a destination atomically and skips concurrent workers", async () => {
    const publication = { id: "dest", workspaceId: "w", updatedAt: new Date("2026-09-24T10:00:00Z"), status: "PENDING", profile: { workspaceId: "w", clientId: "c", active: true }, post: { workspaceId: "w", clientId: "c", updatedAt: new Date("2026-09-24T09:00:00Z"), status: "APPROVED" } };
    db.editorialPublication.findFirst.mockResolvedValue(publication);
    db.editorialPublication.updateMany.mockResolvedValue({ count: 0 });
    expect(await publishEditorialPublication("w", "dest")).toEqual(publication);
    expect(db.editorialPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "dest", workspaceId: "w", status: { in: ["PENDING", "FAILED"] }, profile: { is: { workspaceId: "w", clientId: "c", active: true } } }) }));
    expect(db.editorialPublication.update).not.toHaveBeenCalled();
    expect(db.editorialPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ updatedAt: publication.updatedAt, post: { is: expect.objectContaining({ updatedAt: publication.post.updatedAt }) } }) }));
  });
  it("does not publish after a client account has been disconnected", async () => {
    db.editorialPublication.findFirst.mockResolvedValue({ status: "SCHEDULED", profile: { active: false } });
    await expect(publishEditorialPublication("w", "dest")).rejects.toThrow("desconectado");
    expect(db.editorialPublication.updateMany).not.toHaveBeenCalled();
  });
  it("blocks old destinations after a publication changes client", async () => {
    db.editorialPublication.findFirst.mockResolvedValue({ workspaceId: "w", status: "SCHEDULED", profile: { active: true, workspaceId: "w", clientId: "previous-client" }, post: { workspaceId: "w", clientId: "new-client", status: "SCHEDULED" } });
    await expect(publishEditorialPublication("w", "dest")).rejects.toThrow("ya no corresponde");
    expect(db.editorialPublication.updateMany).not.toHaveBeenCalled();
  });
  it("blocks a destination from a different workspace", async () => {
    db.editorialPublication.findFirst.mockResolvedValue({ workspaceId: "w", status: "PENDING", profile: { active: true, workspaceId: "other", clientId: "c" }, post: { workspaceId: "w", clientId: "c", status: "APPROVED" } });
    await expect(publishEditorialPublication("w", "dest")).rejects.toThrow("ya no corresponde");
    expect(db.editorialPublication.updateMany).not.toHaveBeenCalled();
  });
  it("skips a stale due row after the post has been moved into the future", async () => {
    const publication = { workspaceId: "w", status: "SCHEDULED", scheduledFor: new Date(0), profile: { active: true, workspaceId: "w", clientId: "c" }, post: { workspaceId: "w", clientId: "c", status: "SCHEDULED", scheduledFor: new Date(Date.now() + 86400000) } };
    db.editorialPublication.findFirst.mockResolvedValue(publication);
    expect(await publishEditorialPublication("w", "dest")).toEqual(publication);
    expect(db.editorialPublication.updateMany).not.toHaveBeenCalled();
  });
});
