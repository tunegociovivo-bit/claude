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
    db.editorialPublication.findFirst.mockResolvedValue({ id: "dest", status: "PENDING", network: "facebook", profile: { active: true, metaConnectionId: "conn", facebookPageId: "page" }, post: { status: "APPROVED", mediaUrls: "[]", content: "Hola" } });
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
    const publication = { id: "dest", status: "PENDING", profile: { active: true }, post: { status: "APPROVED" } };
    db.editorialPublication.findFirst.mockResolvedValue(publication);
    db.editorialPublication.updateMany.mockResolvedValue({ count: 0 });
    expect(await publishEditorialPublication("w", "dest")).toEqual(publication);
    expect(db.editorialPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dest", status: { in: ["PENDING", "SCHEDULED", "FAILED"] } } }));
    expect(db.editorialPublication.update).not.toHaveBeenCalled();
  });
  it("does not publish after a client account has been disconnected", async () => {
    db.editorialPublication.findFirst.mockResolvedValue({ status: "SCHEDULED", profile: { active: false } });
    await expect(publishEditorialPublication("w", "dest")).rejects.toThrow("desconectado");
    expect(db.editorialPublication.updateMany).not.toHaveBeenCalled();
  });
});
