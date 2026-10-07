import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gmbReviewFunnel: { findUnique: vi.fn() },
  gmbReviewFunnelEvent: { create: vi.fn(async () => ({})) },
  gmbReviewFunnelFeedback: { create: vi.fn(async () => ({ id: "fb1" })), updateMany: vi.fn(async () => ({ count: 1 })) }
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ id: "m1" })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/integrations/email", () => mail);
vi.mock("@/lib/leads/google-places", () => ({ getGoogleApiKeyForWorkspace: vi.fn(), placesTextSearch: vi.fn() }));

import { slugify, complaintEmailHtml } from "../review-funnel";

const funnel = { id: "f1", workspaceId: "ws1", slug: "bar-pepe", active: true, businessName: "Bar Pepe", ownerEmail: "dueno@bar.es", reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJabcdefghijklmnopqrst" };

function post(body: unknown) {
  return new Request("https://hub.test/api/v1/gmb/public/funnel/bar-pepe/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body)
  }) as any;
}
const params = { params: Promise.resolve({ slug: "bar-pepe" }) };

describe("embudo de reseñas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.gmbReviewFunnel.findUnique.mockResolvedValue(funnel);
  });

  it("genera slugs limpios", () => {
    expect(slugify("Clínica March · Marbella")).toBe("clinica-march-marbella");
    expect(slugify("¡¡!!")).toBe("negocio");
  });

  it("escapa el HTML de la queja en el email", () => {
    const html = complaintEmailHtml({ businessName: "A&B" }, { stars: 2, name: "<b>x</b>", email: "", phone: "", message: "<script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B");
  });

  it("guarda la queja y la envía al dueño con reply-to del cliente", async () => {
    const { POST } = await import("@/app/api/v1/gmb/public/funnel/[slug]/feedback/route");
    const r = await POST(post({ stars: 2, message: "El servicio fue lento", email: "cli@mail.com" }), params);
    expect((await r.json()).ok).toBe(true);
    expect(db.gmbReviewFunnelFeedback.create).toHaveBeenCalled();
    expect(mail.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "dueno@bar.es", replyTo: "cli@mail.com" }));
  });

  it("rechaza mensajes vacíos y descarta el honeypot", async () => {
    const { POST } = await import("@/app/api/v1/gmb/public/funnel/[slug]/feedback/route");
    expect((await POST(post({ stars: 1, message: "" }), params)).status).toBe(400);
    const r = await POST(post({ stars: 1, message: "spam spam", website: "http://spam" }), params);
    expect(r.status).toBe(200);
    expect(db.gmbReviewFunnelFeedback.create).not.toHaveBeenCalled();
  });

  it("el enlace a Google funciona con cualquier valoración (sin review gating)", async () => {
    const { GET } = await import("@/app/api/v1/gmb/public/funnel/[slug]/go/route");
    for (const s of [1, 3, 5]) {
      const r = await GET(new Request(`https://hub.test/api/v1/gmb/public/funnel/bar-pepe/go?s=${s}`, { headers: { "x-forwarded-for": "10.1.1.1" } }) as any, params);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe(funnel.reviewUrl);
    }
  });
});
