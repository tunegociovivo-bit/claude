import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { promptConfigSchema, validatePromptSources } from "../prompt-config";

const ai = vi.hoisted(() => ({ completeJson: vi.fn() }));
const wrapper = vi.hoisted(() => ({ options: [] as any[] }));
vi.mock("@/lib/ai/anthropic", () => ({
  completeJson: ai.completeJson,
  AIDisabledError: class AIDisabledError extends Error {}
}));
vi.mock("@/lib/api/handler", () => ({
  withApi: (options: any, handler: any) => {
    wrapper.options.push(options);
    return (req: NextRequest) => handler(req, { api: { workspaceId: "workspace-a", userId: "user-a" } });
  }
}));
import { AIDisabledError } from "@/lib/ai/anthropic";
import { POST } from "@/app/api/v1/instagram-prospector/configure/route";

const draft = {
  campaign: "Franquiciados alimentacion", sourceType: "followers" as const,
  target: "@mundofranquiciaconsultora", country: "Espana" as const, limit: 100,
  minScore: 70 as const, requiredSignalCount: 3, requireIntentSignal: true, requireContact: true,
  emailKeywords: "", intentSignals: "busco franquicia\ninvertir en", negativeFilters: "sorteos\ncupones"
};
function request(prompt: string) {
  return new NextRequest("https://hub.test/api/v1/instagram-prospector/configure", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt })
  });
}
beforeEach(() => ai.completeJson.mockReset());

it("requires admin and AI scope and rate limiting", () => {
  expect(wrapper.options).toContainEqual({ scope: "ai", admin: true, rate: "ai" });
});

it("returns all questionnaire fields using the authenticated workspace, without starting a scan", async () => {
  ai.completeJson.mockResolvedValue(draft);
  const response = await POST(request("Busca 100 franquiciados de supermercados con contacto publico"), {} as any);
  expect((await response.json()).config).toEqual(draft);
  expect(ai.completeJson).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-a", userId: "user-a", feature: "instagram_prospector_configure" }));
});

it("rejects empty and oversized prompts before using AI", async () => {
  await expect(POST(request("  "), {} as any)).rejects.toThrow(/10 y 4000/);
  await expect(POST(request("x".repeat(4001)), {} as any)).rejects.toThrow(/10 y 4000/);
  expect(ai.completeJson).not.toHaveBeenCalled();
});

it("rejects missing fields, out-of-range numbers and fabricated accounts", async () => {
  for (const bad of [{ campaign: "Incomplete" }, { ...draft, limit: 100000 }, { ...draft, requireContact: "yes" }, { ...draft, target: "@invented_supermarket_leads" }]) {
    ai.completeJson.mockResolvedValue(bad);
    await expect(POST(request("Busco franquiciados de supermercados"), {} as any)).rejects.toThrow(/configuracion valida/);
  }
});

it("preserves explicit user sources and permits thematic hashtags without claiming verified accounts", () => {
  expect(validatePromptSources({ ...draft, target: "@retail" }, "Seguidores de @retail en Espana")).toBe(true);
  expect(validatePromptSources({ ...draft, sourceType: "hashtag", target: "#restaurantes\n#hosteleria" }, "Busco restaurantes con email")).toBe(true);
  expect(validatePromptSources({ ...draft, target: "@mundofranquiciaconsultora" }, "Busco clases de yoga")).toBe(false);
  expect(validatePromptSources({ ...draft, target: "@gmail.com" }, "Emails que contengan persona@gmail.com")).toBe(false);
  expect(validatePromptSources({ ...draft, target: "https://instagram.com.evil.test/profile/" }, "Busco franquiciados")).toBe(false);
});

it("accepts post and location URLs only when supplied and matching the selected source", () => {
  const post = "https://www.instagram.com/p/ABC123/";
  expect(validatePromptSources({ ...draft, sourceType: "comments", target: post }, `Comentaristas de ${post}`)).toBe(true);
  expect(validatePromptSources({ ...draft, sourceType: "comments", target: post }, "Busco comentaristas de franquicias")).toBe(false);
  expect(validatePromptSources({ ...draft, sourceType: "location", target: post }, `Buscar en ${post}`)).toBe(false);
});

it("leaves a missing post URL empty and returns an actionable notice", async () => {
  ai.completeJson.mockResolvedValue({ ...draft, sourceType: "comments", target: "" });
  const response = await POST(request("Busca personas que comentan sobre franquicias"), {} as any);
  const body = await response.json();
  expect(body.config.target).toBe("");
  expect(body.notice).toMatch(/Falta indicar/);
});

it("reports AI unavailability and hides provider diagnostics", async () => {
  ai.completeJson.mockRejectedValueOnce(new AIDisabledError("IA no configurada"));
  await expect(POST(request("Busco franquiciados con email publico"), {} as any)).rejects.toThrow("IA no configurada");
  ai.completeJson.mockRejectedValueOnce(new Error("provider debug secret"));
  await expect(POST(request("Busco franquiciados con email publico"), {} as any)).rejects.toThrow("No se pudo preparar el formulario con IA");
});

it("validates all fields as structured data rather than trusting generated JSON", () => {
  expect(promptConfigSchema.safeParse({ ...draft, country: "Atlantis" }).success).toBe(false);
  expect(promptConfigSchema.safeParse({ ...draft, execute: true }).success).toBe(false);
});
