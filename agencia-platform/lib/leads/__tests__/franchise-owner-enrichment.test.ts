/**
 * researchFranchiseOwner (arreglo del "no salen datos, sin logs"): un fallo del proveedor/
 * herramienta ahora SE PROPAGA (FranchiseOwnerProviderError) en vez de enmascararse como un
 * resultado "unconfirmed" vacío → la cola lo marca "error" visible/reintentable. Un modelo que
 * SÍ responde devuelve el resultado normalizado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getClientMock } = vi.hoisted(() => ({ getClientMock: vi.fn() }));
vi.mock("@/lib/ai/anthropic", () => ({ getAnthropicForWorkspace: getClientMock }));

import { researchFranchiseOwner, FranchiseOwnerProviderError } from "../franchise-owner-enrichment";

const OPTS = { workspaceId: "w1", brand: "Eroski", storeName: "Eroski Málaga", address: "C/ X", province: "Málaga", centralWebsite: "eroski.es" };
beforeEach(() => vi.clearAllMocks());

describe("researchFranchiseOwner — errores VISIBLES, no enmascarados", () => {
  it("si el modelo/web_search falla → LANZA FranchiseOwnerProviderError (no 'done' vacío)", async () => {
    getClientMock.mockResolvedValue({ messages: { create: vi.fn(async () => { throw new Error("web_search tool not available"); }) } });
    await expect(researchFranchiseOwner(OPTS)).rejects.toBeInstanceOf(FranchiseOwnerProviderError);
  });
  it("si no hay cliente Anthropic → LANZA FranchiseOwnerProviderError", async () => {
    getClientMock.mockRejectedValue(new Error("No hay API key de Anthropic"));
    await expect(researchFranchiseOwner(OPTS)).rejects.toBeInstanceOf(FranchiseOwnerProviderError);
  });
  it("si el modelo responde con JSON → devuelve el resultado normalizado (done)", async () => {
    getClientMock.mockResolvedValue({
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: "text", text: '{"classification":"corporate","operatorName":null,"emails":[],"phones":[],"sources":[],"explanation":"Tienda propia de la cadena."}' }]
        }))
      }
    });
    const out = await researchFranchiseOwner(OPTS);
    expect(out.classification).toBe("corporate");
    expect(out.researchedAt).toBeTruthy();
  });
});
