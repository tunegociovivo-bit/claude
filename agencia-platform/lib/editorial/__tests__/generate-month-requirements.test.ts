import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findClient: vi.fn(), findUsed: vi.fn(), createPost: vi.fn(), transaction: vi.fn(), ai: vi.fn(), references: vi.fn(), storageKey: vi.fn(), download: vi.fn(), sign: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { client: { findFirst: mocks.findClient }, editorialPost: { findMany: mocks.findUsed, create: mocks.createPost }, $transaction: mocks.transaction } }));
vi.mock("@/lib/ai/anthropic", () => ({ DEFAULT_MODEL: "test", completeJson: mocks.ai }));
vi.mock("../media", () => ({ editorialStorageKey: mocks.storageKey }));
vi.mock("@/lib/storage/r2", () => ({ downloadBuffer: mocks.download, signedDownloadUrl: mocks.sign }));
vi.mock("../month-context", async (original) => ({ ...await original<typeof import("../month-context")>(), loadMonthlyReferences: mocks.references }));
import { generateMonth } from "../generate-month";

const opts = { workspaceId: "w1", clientId: "c1", month: "2026-10", count: 1, networks: ["instagram"], generateImages: false };
const post = (title: string, content: string) => ({ title, content, format: "imagen", dayOfMonth: 12, hourOfDay: 10, headlineLines: [], textPlacement: "bottom", imagePrompt: "photo" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findClient.mockResolvedValue({ id: "c1", name: "Clínica", referenceImages: [] });
  mocks.findUsed.mockResolvedValue([]);
  mocks.references.mockResolvedValue([]);
  mocks.storageKey.mockReturnValue("w1/editorial-references/c1/ref.jpg");
  mocks.download.mockResolvedValue(Buffer.from("image"));
  mocks.sign.mockResolvedValue("https://storage.example/fresh.jpg");
  mocks.createPost.mockImplementation(async ({ data }) => ({ id: "new-post", ...data }));
  mocks.transaction.mockImplementation((operations) => Promise.all(operations));
});

describe("monthly generation integration", () => {
  it("loads actual reference content and sends visual references before recording coverage", async () => {
    mocks.references.mockResolvedValue([{ url: "https://menu.example", text: "Lubina con patatas" }]);
    mocks.ai.mockResolvedValue({ posts: [post("Lubina", "Prueba nuestra lubina con patatas")] });
    const result = await generateMonth({ ...opts, referenceLinks: ["https://menu.example"], extraReferenceUrls: ["https://storage.example/old.jpg"], requiredTopics: ["lubina"] });
    expect(mocks.ai.mock.calls[0][0]).toMatchObject({ imageUrls: ["https://storage.example/fresh.jpg"], requireAllImages: true });
    expect(mocks.ai.mock.calls[0][0].user).toContain("Lubina con patatas");
    expect(result.topicCoverage).toEqual([{ topic: "lubina", postIds: ["new-post"] }]);
    expect(mocks.createPost.mock.calls[0][0].data.metaJson.editorialGeneration.coveredTopics).toEqual(["lubina"]);
    expect(mocks.createPost.mock.calls[0][0].data.revisions.create.changeSummary).toBe("Publicación generada con IA");
  });
  it("does not save incomplete mandatory topic coverage even after retry", async () => {
    mocks.ai.mockResolvedValue({ posts: [post("Tratamiento", "Consulta nuestras opciones")] });
    await expect(generateMonth({ ...opts, requiredTopics: ["bótox"] })).rejects.toThrow("Faltan estos temas");
    expect(mocks.ai).toHaveBeenCalledTimes(2);
    expect(mocks.createPost).not.toHaveBeenCalled();
  });
  it("rejects reuse against all used history and scopes the query to the client/workspace", async () => {
    mocks.findUsed.mockResolvedValue([{ title: "Utilizado", content: "Contenido original" }]);
    mocks.ai.mockResolvedValue({ posts: [post("Utilizado", "Contenido original")] });
    await expect(generateMonth(opts)).rejects.toThrow("repiten contenido utilizado");
    expect(mocks.findUsed.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", clientId: "c1" });
    expect(mocks.findUsed.mock.calls[0][0]).not.toHaveProperty("take");
    expect(mocks.createPost).not.toHaveBeenCalled();
  });
  it("allows explicit reuse without querying exclusions", async () => {
    mocks.ai.mockResolvedValue({ posts: [post("Utilizado", "Contenido original")] });
    await generateMonth({ ...opts, allowReuseUsed: true });
    expect(mocks.findUsed).not.toHaveBeenCalled();
    expect(mocks.createPost).toHaveBeenCalledOnce();
  });
  it("rejects reference images outside workspace storage", async () => {
    mocks.storageKey.mockReturnValue(null);
    await expect(generateMonth({ ...opts, extraReferenceUrls: ["http://127.0.0.1/private"] })).rejects.toThrow("Sube las imágenes");
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});
