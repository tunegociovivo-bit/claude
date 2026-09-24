import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, regenerateDraftMock, deleteCommentMock, syncCommentsMock, replyCommentMock, MetaDeletionErrorMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  regenerateDraftMock: vi.fn(),
  deleteCommentMock: vi.fn(),
  syncCommentsMock: vi.fn(),
  replyCommentMock: vi.fn(),
  MetaDeletionErrorMock: class MetaDeletionError extends Error {},
  prisma: {
    metaCommentFeed: { findMany: vi.fn().mockResolvedValue([]) },
    metaCommentAlertRecipient: { findMany: vi.fn().mockResolvedValue([]) },
    metaAdComment: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));
vi.mock("@/lib/meta/comments", () => ({
  blockMetaCommentAuthor: vi.fn(),
  deleteMetaComment: deleteCommentMock,
  MetaDeletionError: MetaDeletionErrorMock,
  notifyMetaOperational: vi.fn(),
  regenerateMetaCommentDraft: regenerateDraftMock,
  replyToMetaComment: replyCommentMock,
  syncMetaCampaignComments: syncCommentsMock
}));
vi.mock("@/lib/audit/log", () => ({ auditFromReq: vi.fn() }));
vi.mock("@/lib/integrations/meta-ads", () => ({ metaAdsListAdAccounts: vi.fn(), metaAdsListCampaigns: vi.fn() }));
vi.mock("@/lib/meta/connection", () => ({
  listWorkspaceMetaTokens: vi.fn(),
  readMetaTokenByConnection: vi.fn()
}));

import { GET, POST } from "../route";

const call = (body: unknown) => POST(new NextRequest("https://hub.example/api/v1/meta-comments", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
}), { params: {} });

describe("POST /api/v1/meta-comments regenerate_draft", () => {
  it("paginates beyond 300 with a stable workspace-scoped cursor", async () => {
    authenticateMock.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
    const timestamp = new Date("2026-09-21T10:00:00Z");
    prisma.metaAdComment.findMany.mockResolvedValue(Array.from({ length: 301 }, (_, i) => ({ id: `c-${i}`, commentCreatedAt: timestamp })));
    const response = await GET(new NextRequest("https://hub.example/api/v1/meta-comments"), { params: {} });
    const data = await response.json();
    expect(data.items).toHaveLength(300);
    expect(data.nextCursor).toEqual({ before: timestamp.toISOString(), beforeId: "c-299" });
    prisma.metaAdComment.findMany.mockResolvedValue([]);
    await GET(new NextRequest(`https://hub.example/api/v1/meta-comments?${new URLSearchParams(data.nextCursor)}`), { params: {} });
    expect(prisma.metaAdComment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace-1", OR: [{ commentCreatedAt: { lt: timestamp } }, { commentCreatedAt: timestamp, id: { lt: "c-299" } }] }) }));
  });

  it("permite forzar IDs concretos de anuncio al importar comentarios", async () => {
    authenticateMock.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
    syncCommentsMock.mockResolvedValue({ discovered: 3, created: 3, remaining: 0, complete: true, diagnostics: { explicitAds: 1 } });

    const response = await call({
      action: "sync",
      campaignId: "120247270045340145",
      clientName: "Eroski",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-24T23:59:59.999Z",
      extraAdIds: ["120224999030870524"]
    });

    expect(response.status).toBe(200);
    expect(syncCommentsMock).toHaveBeenCalledWith(
      "workspace-1",
      "120247270045340145",
      "Eroski",
      { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-09-24T23:59:59.999Z") },
      { extraAdIds: ["120224999030870524"] }
    );
  });
  it("forwards the dynamic publication association without accepting arbitrary URLs", async () => {
    syncCommentsMock.mockResolvedValue({ discovered: 1, created: 1, complete: true });
    const extraPosts = [{ adId: "120224999030870524", postId: "1409934984491916" }];
    expect((await call({ action: "sync", campaignId: "120221155176020524", clientName: "Eroski", extraPosts })).status).toBe(200);
    expect(syncCommentsMock).toHaveBeenLastCalledWith("workspace-1", "120221155176020524", "Eroski", undefined, { extraAdIds: undefined, extraPosts });
    expect((await call({ action: "sync", campaignId: "120221155176020524", clientName: "Eroski", extraPosts: [{ adId: "123", postId: "https://example.org" }] })).status).toBe(400);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
    prisma.metaAdComment.findFirst.mockResolvedValue({
      id: "comment-1",
      workspaceId: "workspace-1",
      message: "¿Cuál es el horario?",
      feed: { clientName: "ESAEM", displayName: "ESAEM", campaignName: "Grado", aiContext: "Horario de 9 a 18" }
    });
    regenerateDraftMock.mockResolvedValue("Nuestro horario es de 9 a 18. ¿Te ayudamos?");
    prisma.metaAdComment.update.mockImplementation(async ({ data }: any) => ({ id: "comment-1", ...data }));
  });

  it("explica el error real cuando Meta rechaza eliminar un comentario", async () => {
    prisma.metaAdComment.findFirst.mockResolvedValue({ id: "comment-1", externalCommentId: "meta-1", postId: "page_post", platform: "facebook", feed: { metaConnectionId: "connection-1" } });
    deleteCommentMock.mockRejectedValue(new MetaDeletionErrorMock("Meta 400 en meta-1: el comentario no admite eliminación"));

    const response = await call({ action: "delete_comment", commentId: "comment-1" });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "meta_delete_failed", message: expect.stringContaining("Meta 400") } });
    expect(prisma.metaAdComment.update).not.toHaveBeenCalled();
  });

  it("no expone detalles internos inesperados al navegador", async () => {
    prisma.metaAdComment.findFirst.mockResolvedValue({ id: "comment-1", externalCommentId: "meta-1", postId: null, platform: "instagram", feed: { metaConnectionId: "connection-1" } });
    deleteCommentMock.mockRejectedValue(new Error("DATABASE_URL=secreto host=interno"));
    const response = await call({ action: "delete_comment", commentId: "comment-1" });
    const body = await response.json();
    expect(body.error.message).not.toContain("DATABASE_URL");
    expect(body.error.message).toContain("Reinténtalo");
  });

  it("distingue cuando Meta oculta el comentario porque no permite borrarlo", async () => {
    prisma.metaAdComment.findFirst.mockResolvedValue({ id: "comment-1", externalCommentId: "meta-1", postId: "page_post", platform: "facebook", feed: { metaConnectionId: "connection-1" } });
    deleteCommentMock.mockResolvedValue("hidden");
    const response = await call({ action: "delete_comment", commentId: "comment-1" });
    expect(await response.json()).toMatchObject({ ok: true, moderationMode: "hidden", confirmedByMeta: true });
    expect(prisma.metaAdComment.update).toHaveBeenCalledWith({ where: { id: "comment-1" }, data: expect.objectContaining({ status: "hidden" }) });
  });

  it("genera y persiste otro borrador con aislamiento por workspace", async () => {
    const response = await call({ action: "regenerate_draft", commentId: "comment-1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, draft: "Nuestro horario es de 9 a 18. ¿Te ayudamos?" });
    expect(prisma.metaAdComment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "comment-1", workspaceId: "workspace-1", deletedAt: null }
    }));
    expect(prisma.metaAdComment.update).toHaveBeenCalledWith({
      where: { id: "comment-1" },
      data: { aiDraft: "Nuestro horario es de 9 a 18. ¿Te ayudamos?" }
    });
  });

  it("no permite regenerar un comentario ajeno o inexistente", async () => {
    prisma.metaAdComment.findFirst.mockResolvedValue(null);
    const response = await call({ action: "regenerate_draft", commentId: "comment-other" });
    expect(response.status).toBe(404);
    expect(regenerateDraftMock).not.toHaveBeenCalled();
  });

  it("regenera una selección grande en una sola petición sin perder el aislamiento", async () => {
    const comments = Array.from({ length: 22 }, (_, index) => ({
      id: `comment-${index + 1}`,
      workspaceId: "workspace-1",
      message: `Mensaje ${index + 1}`,
      feed: { clientName: "Eroski", displayName: "Eroski", campaignName: "Franquicias", aiContext: "Contexto" }
    }));
    prisma.metaAdComment.findMany.mockResolvedValue(comments);
    regenerateDraftMock.mockImplementation(async (_workspaceId: string, comment: any) => `Respuesta ${comment.id}`);

    const response = await call({ action: "regenerate_drafts", commentIds: comments.map((comment) => comment.id) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, drafts: expect.any(Object), failedIds: [] });
    expect(prisma.metaAdComment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: comments.map((comment) => comment.id) }, workspaceId: "workspace-1", deletedAt: null }
    }));
    expect(regenerateDraftMock).toHaveBeenCalledTimes(22);
  });

  it("bloquea publicar explicaciones internas de no respuesta", async () => {
    prisma.metaAdComment.findFirst.mockResolvedValue({ id: "comment-1", externalCommentId: "meta-1", postId: "page_post", platform: "facebook", feed: { metaConnectionId: "connection-1" } });
    const response = await call({ action: "reply", commentId: "comment-1", message: "No se responderá a este comentario ya que carece de sentido coherente y no se relaciona con el anuncio de franquicia Eroski." });

    expect(response.status).toBe(400);
    expect(replyCommentMock).not.toHaveBeenCalled();
  });

  it("sustituye placeholders de usuario antes de publicar respuestas", async () => {
    prisma.metaAdComment.findFirst.mockResolvedValue({ id: "comment-1", authorName: "_bxn.chnn_", externalCommentId: "ig-comment-1", postId: null, platform: "instagram", feed: { metaConnectionId: "connection-1" } });
    replyCommentMock.mockResolvedValue("reply-1");

    const response = await call({ action: "reply", commentId: "comment-1", message: "@nombredeusuario Gracias por escribirnos." });

    expect(response.status).toBe(200);
    expect(replyCommentMock).toHaveBeenCalledWith("workspace-1", "ig-comment-1", "@_bxn.chnn_ Gracias por escribirnos.", null, "instagram", "connection-1");
  });

  it("muestra el motivo de Meta cuando rechaza publicar una respuesta", async () => {
    prisma.metaAdComment.findFirst.mockResolvedValue({ id: "comment-1", authorName: "_bxn.chnn_", externalCommentId: "ig-comment-1", postId: null, platform: "instagram", feed: { metaConnectionId: "connection-1" } });
    replyCommentMock.mockRejectedValue(new Error("Meta 400 en ig-comment-1/replies: Unsupported post request"));

    const response = await call({ action: "reply", commentId: "comment-1", message: "Gracias por escribirnos." });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "meta_reply_failed", message: expect.stringContaining("Unsupported post request") } });
    expect(prisma.metaAdComment.update).not.toHaveBeenCalled();
  });
});
