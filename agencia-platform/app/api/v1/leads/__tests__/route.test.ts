/**
 * GET /api/v1/leads — la lista debe SERIALIZAR la vista compacta del titular de franquicia
 * (`franchiseOwner` + `franchiseOwnerState`) para que la tabla la muestre, sin filtrar esos campos
 * en el mapeo y SIN devolver el `rawData` completo. Tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const rows: any[] = [];
  const prismaObj: any = {
    _rows: rows,
    lead: {
      count: vi.fn(async () => rows.length),
      findMany: vi.fn(async () => rows.map((r) => ({ ...r })))
    }
  };
  return { authenticateMock: vi.fn(), prisma: prismaObj };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
// send-queue arrastra ranking-card.tsx (JSX) por la cadena de imports; en el test solo hace falta
// la constante SENT_STATUSES que usa el where de mensajes.
vi.mock("@/lib/leads/send-queue", () => ({ SENT_STATUSES: ["sent", "delivered", "read"] }));

import { GET } from "../route";

const ENRICHED_OWNER = {
  status: "done",
  classification: "franchise",
  confidence: "high",
  operatorName: "SUPERMERCADOS DEL SUR SL",
  taxId: "B12345678",
  ownerName: "Juan Pérez",
  emails: ["info@delsur.es"],
  phones: ["952 12 34 56"],
  sources: [{ url: "https://borme.es/x", title: "BORME" }],
  explanation: "Franquiciado local confirmado."
};

function row(over: any) {
  return {
    id: "x", name: "Tienda", province: "Málaga", category: null, searchId: "s1",
    phone: "600", website: null, rating: 4, reviewsCount: 2, position: 1, score: 10,
    urgency: null, ticketScore: null, ticketTier: null, contactStatus: "new", aiOpener: null,
    hasWhatsapp: true, latitude: null, longitude: null, placeId: "p", rawData: null,
    search: { keyword: "Eroski", location: "Málaga", source: "brand_locations" },
    _count: { messages: 0 }, messages: [], ...over
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma._rows.length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

const get = (qs = "") => GET(new NextRequest(`https://hub.example/api/v1/leads?${qs}`), { params: {} });

describe("GET /api/v1/leads — serialización del titular", () => {
  it("un lead con rawData.franchiseOwner enriquecido llega como franchiseOwner + state", async () => {
    prisma._rows.push(row({ id: "l1", rawData: { source: "brand_locations", franchiseOwner: ENRICHED_OWNER } }));
    const body = await (await get()).json();
    const item = body.items.find((i: any) => i.id === "l1");
    expect(item.franchiseOwnerState).toBe("done_data");
    expect(item.franchiseOwner).toMatchObject({
      state: "done_data",
      hasEvidence: true,
      operatorName: "SUPERMERCADOS DEL SUR SL",
      taxId: "B12345678",
      confidence: "high"
    });
    expect(item.franchiseOwner.sources[0].url).toBe("https://borme.es/x");
    // NUNCA se filtra el rawData completo al cliente.
    expect(item).not.toHaveProperty("rawData");
  });

  it("un 'done' sin evidencia se marca done_empty (sin resultado), no éxito", async () => {
    prisma._rows.push(row({ id: "l2", rawData: { franchiseOwner: { status: "done", classification: "unconfirmed", explanation: "sin datos" } } }));
    const body = await (await get()).json();
    const item = body.items.find((i: any) => i.id === "l2");
    expect(item.franchiseOwnerState).toBe("done_empty");
    expect(item.franchiseOwner.hasEvidence).toBe(false);
  });

  it("un lead nunca investigado no infla el payload (franchiseOwner null, state none)", async () => {
    prisma._rows.push(row({ id: "l3", rawData: { source: "maps" } }));
    const body = await (await get()).json();
    const item = body.items.find((i: any) => i.id === "l3");
    expect(item.franchiseOwner).toBeNull();
    expect(item.franchiseOwnerState).toBe("none");
    expect(item).not.toHaveProperty("rawData");
  });
});
