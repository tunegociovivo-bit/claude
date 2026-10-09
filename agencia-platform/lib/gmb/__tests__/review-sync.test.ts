import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gmbClient: { findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  gmbReview: { findMany: vi.fn(async () => [{ reviewId: "old" }]), upsert: vi.fn(async () => ({})) },
  gmbActivity: { findFirst: vi.fn() }
}));
const gbp = vi.hoisted(() => ({ gbpCall: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/integrations/gmb-hub", () => ({ logGmbActivity: vi.fn(async () => ({})), cleanReviewText: (t: any) => String(t ?? "") }));
vi.mock("@/lib/integrations/gmb", async () => {
  const real = await vi.importActual<any>("@/lib/integrations/gmb");
  return { ...real, gbpCall: gbp.gbpCall };
});

import { syncClientReviews } from "../review-sync";

describe("sincronización de reseñas", () => {
  it("importa las reseñas de Google por la conexión de Make de la ficha y actualiza la nota", async () => {
    db.gmbClient.findFirst.mockResolvedValue({ id: "c1", accountId: "accounts/1", locationId: "accounts/1/locations/2", connectionId: "11668617", googleConnectionId: "" });
    gbp.gbpCall
      .mockResolvedValueOnce({ title: "Clínica March", websiteUri: "https://clinicamarch.com/", metadata: { placeId: "ChIJx" } })
      .mockResolvedValueOnce({
        averageRating: 4.86,
        totalReviewCount: 3,
        nextPageToken: "p2",
        reviews: [
          { reviewId: "old", reviewer: { displayName: "Ana" }, starRating: "FIVE", comment: "Genial", createTime: "2026-09-01T00:00:00Z" },
          { reviewId: "new1", reviewer: { displayName: "Luis" }, starRating: "FOUR", reviewReply: { comment: "Gracias" } }
        ]
      })
      .mockResolvedValueOnce({ reviews: [{ name: "accounts/1/locations/2/reviews/new2", starRating: "ONE" }] });
    const r = await syncClientReviews("ws1", "c1");
    expect(r).toMatchObject({ imported: 2, updated: 1, total: 3, rating: 4.86, count: 3 });
    const calls = gbp.gbpCall.mock.calls as any[];
    expect(calls[0][1]).toEqual({ kind: "make", connId: 11668617 });
    expect(calls[0][2].path).toContain("/v1/locations/2?readMask=");
    expect(calls[1][2].path).toContain("/v4/accounts/1/locations/2/reviews?");
    expect(db.gmbClient.updateMany).toHaveBeenCalledWith({ where: { id: "c1", workspaceId: "ws1" }, data: { name: "Clínica March", website: "https://clinicamarch.com/", placeId: "ChIJx" } });
    expect(db.gmbClient.updateMany).toHaveBeenCalledWith({ where: { id: "c1", workspaceId: "ws1" }, data: { rating: 4.9, reviewCount: 3 } });
    const replied: any = (db.gmbReview.upsert.mock.calls as any[]).find((c: any) => c[0].where.clientId_reviewId.reviewId === "new1");
    expect(replied[0].create.reviewReply).toBe("Gracias");
  });
});
