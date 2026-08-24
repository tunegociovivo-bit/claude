import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, regenerateDraftMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  regenerateDraftMock: vi.fn(),
  prisma: {
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
  deleteMetaComment: vi.fn(),
  notifyMetaOperational: vi.fn(),
  regenerateMetaCommentDraft: regenerateDraftMock,
  replyToMetaComment: vi.fn(),
  syncMetaCampaignComments: vi.fn()
}));
vi.mock("@/lib/audit/log", () => ({ auditFromReq: vi.fn() }));
vi.mock("@/lib/integrations/meta-ads", () => ({ metaAdsListAdAccounts: vi.fn(), metaAdsListCampaigns: vi.fn() }));
vi.mock("@/lib/meta/connection", () => ({
  listWorkspaceMetaTokens: vi.fn(),
  readMetaTokenByConnection: vi.fn()
}));

import { POST } from "../route";

const call = (body: unknown) => POST(new NextRequest("https://hub.example/api/v1/meta-comments", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
}), { params: {} });

describe("POST /api/v1/meta-comments regenerate_draft", () => {
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
});
