/**
 * Fase 6b rutas: campañas UTM, compliance de reseñas, contactos (consentimiento/supresión), opt-out,
 * y tracker público (dedup + redirect). Prisma y auth mockeados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const db: any = { gmbClient: [], gmbCampaign: [], gmbReviewCampaign: [], gmbReviewContact: [], gmbSuppression: [], gmbAttributionEvent: [] };
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]: any) => (v && typeof v === "object" && "in" in v) ? v.in.includes(r[k]) : r[k] === v);
  const coll = (name: string) => ({
    findFirst: vi.fn(async ({ where }: any) => db[name].find((r: any) => match(r, where)) ?? null),
    findUnique: vi.fn(async ({ where }: any) => db[name].find((r: any) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null),
    findMany: vi.fn(async ({ where }: any) => db[name].filter((r: any) => !where || match(r, where))),
    count: vi.fn(async ({ where }: any) => db[name].filter((r: any) => !where || match(r, where)).length),
    create: vi.fn(async ({ data }: any) => { const r = { id: `${name}${db[name].length + 1}`, trackId: `t${db[name].length + 1}`, publicSlug: `s${db[name].length + 1}`, optOutToken: `o${db[name].length + 1}`, ...data }; db[name].push(r); return r; }),
    createMany: vi.fn(async ({ data, skipDuplicates }: any) => { let n = 0; for (const d of data) { const dup = db[name].some((r: any) => r.dedupKey && r.dedupKey === d.dedupKey) || db[name].some((r: any) => r.contactHash && r.contactHash === d.contactHash && r.workspaceId === d.workspaceId); if (skipDuplicates && dup) continue; db[name].push({ id: `${name}${db[name].length + 1}`, ...d }); n++; } return { count: n }; }),
    updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db[name]) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    deleteMany: vi.fn(async () => ({ count: 1 }))
  });
  const p: any = { _db: db };
  for (const n of Object.keys(db)) p[n] = coll(n);
  return { authenticateMock: vi.fn(), prisma: p };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { POST as campaignPost } from "../clients/[id]/campaigns/route";
import { POST as reviewCampaignPost } from "../clients/[id]/review-campaigns/route";
import { POST as contactsPost } from "../review-campaigns/[cid]/contacts/route";
import { POST as optOutPost } from "../public/optout/[token]/route";
import { GET as track } from "../public/track/[trackId]/route";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});
const post = (fn: any, id: string, body: any, key = "id") => fn(new NextRequest("https://hub.example/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: { [key]: id } });

describe("campaigns UTM", () => {
  beforeEach(() => prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", name: "Café", placeId: "ChIJXXXXXXXXXXXXXXXXXXXXXXX" }));
  it("UTM incompleto → 400", async () => {
    expect((await post(campaignPost, "cl1", { name: "C", landingUrl: "https://x.es", utmSource: "", utmMedium: "cpc", utmCampaign: "v" })).status).toBe(400);
  });
  it("crea campaña con utmUrl + trackUrl", async () => {
    const body = await (await post(campaignPost, "cl1", { name: "C", landingUrl: "https://x.es/o", utmSource: "google", utmMedium: "cpc", utmCampaign: "verano" })).json();
    expect(body.campaign.utmUrl).toContain("utm_source=google");
    expect(body.campaign.trackUrl).toContain("/track/");
  });
});

describe("review campaign compliance", () => {
  beforeEach(() => prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", name: "Café", placeId: "ChIJXXXXXXXXXXXXXXXXXXXXXXX" }));
  it("mensaje con incentivo → 422", async () => {
    expect((await post(reviewCampaignPost, "cl1", { name: "R", message: "Deja reseña y te damos un descuento" })).status).toBe(422);
  });
  it("mensaje conforme → crea con reviewUrl a Google", async () => {
    const body = await (await post(reviewCampaignPost, "cl1", { name: "R", message: "Gracias por tu confianza, deja tu opinión: {enlace}" })).json();
    expect(body.ok).toBe(true);
    expect(body.reviewUrlReady).toBe(true);
  });
});

describe("contactos: consentimiento + supresión + dedup", () => {
  beforeEach(() => { prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", name: "Café" }); prisma._db.gmbReviewCampaign.push({ id: "rc1", workspaceId: "w1", clientId: "cl1" }); });
  it("añade con consentimiento, salta suprimidos y duplicados", async () => {
    const { contactHash } = await import("@/lib/gmb/review-acquisition");
    prisma._db.gmbSuppression.push({ workspaceId: "w1", contactHash: contactHash("no@x.com") });
    const body = await (await post(contactsPost, "rc1", { contacts: [{ email: "si@x.com", consent: true }, { email: "no@x.com", consent: true }, { email: "si@x.com", consent: true }] }, "cid")).json();
    expect(body.added).toBe(1); // si@ una vez; no@ suprimido; si@ dup
    expect(body.skipped).toBe(2);
  });
});

describe("opt-out suprime", () => {
  it("POST marca opted_out + suppression", async () => {
    prisma._db.gmbReviewContact.push({ id: "ct1", workspaceId: "w1", campaignId: "rc1", contactHash: "h1", optOutToken: "tok", status: "sent" });
    const res = await optOutPost(new Request("https://h/x"), { params: { token: "tok" } });
    expect((await res.json()).optedOut).toBe(true);
    expect(prisma._db.gmbReviewContact[0].status).toBe("opted_out");
    expect(prisma._db.gmbSuppression.length).toBe(1);
  });
});

describe("tracker público", () => {
  it("registra evento (dedup) y redirige 302", async () => {
    prisma._db.gmbCampaign.push({ id: "cp1", trackId: "trk", workspaceId: "w1", clientId: "cl1", landingUrl: "https://x.es", utmSource: "google", utmMedium: "cpc", utmCampaign: "v" });
    const res = await track(new Request("https://h/api/v1/gmb/public/track/trk?type=click&to=https://x.es/o"), { params: { trackId: "trk" } });
    expect(res.status).toBe(302);
    expect(prisma._db.gmbAttributionEvent.length).toBe(1);
  });
});
