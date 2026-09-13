import { describe, expect, it } from "vitest";
import {
  buildConversationRadarSystemPrompt,
  conversationRadarRequestSchema,
  normalizeConversationCandidates,
  parseImageDataUrl,
  readStoredConversationRules
} from "@/lib/mobile/conversation-radar";

const validRequest = {
  phoneKey: "xiaomi-14-ultra",
  deviceSerial: "usb-24031PN0DC",
  screenImage: `data:image/jpeg;base64,${Buffer.from("small image").toString("base64")}`,
  rule: {
    id: "03e18429-a6db-407f-9892-4eedf1f016d5",
    name: "Viajes a Japón",
    topic: "Personas que estén preparando un viaje a Japón y pidan recomendaciones",
    goal: "Responder con información útil basada en mi experiencia",
    tone: "helpful" as const,
    minimumRelevance: 65
  }
};

describe("conversation radar safeguards", () => {
  it("accepts a linked-device request with one reusable topic rule", () => {
    expect(conversationRadarRequestSchema.parse(validRequest)).toMatchObject(validRequest);
  });

  it("rejects unsupported or malformed screenshots", () => {
    expect(() => conversationRadarRequestSchema.parse({
      ...validRequest,
      screenImage: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
    })).toThrow(/JPEG o PNG/i);

    expect(() => conversationRadarRequestSchema.parse({
      ...validRequest,
      screenImage: "data:image/png;base64,not-valid-***"
    })).toThrow(/captura/i);
  });

  it("rejects screenshots larger than 2.5 MiB before invoking AI", () => {
    const oversized = Buffer.alloc(2.5 * 1024 * 1024 + 1).toString("base64");
    expect(() => parseImageDataUrl(`data:image/png;base64,${oversized}`)).toThrow(/2,5 MiB/i);
  });

  it("deduplicates visible comments, filters low relevance and caps the queue", () => {
    const candidates = Array.from({ length: 15 }, (_, index) => ({
      authorLabel: `Persona ${index}`,
      sourceText: `Pregunta diferente sobre Japón número ${index}`,
      relevanceScore: 99 - index,
      reason: "Pide información directamente relacionada con la regla.",
      draftReply: `Respuesta útil ${index}`
    }));
    candidates.push({
      authorLabel: "Duplicado",
      sourceText: "  pregunta DIFERENTE sobre japón número 0!! ",
      relevanceScore: 70,
      reason: "Duplicado visual.",
      draftReply: "No debe aparecer"
    });
    candidates.push({
      authorLabel: "Irrelevante",
      sourceText: "¿Qué tiempo hace hoy?",
      relevanceScore: 20,
      reason: "No trata el tema.",
      draftReply: "No debe aparecer"
    });

    const result = normalizeConversationCandidates(candidates, 65);

    expect(result).toHaveLength(12);
    expect(result[0]).toMatchObject({ relevanceScore: 99, sourceText: candidates[0].sourceText });
    expect(result.filter((item) => item.sourceText.toLowerCase().includes("número 0"))).toHaveLength(1);
    expect(result.every((item) => item.relevanceScore >= 65)).toBe(true);
  });

  it("keeps and deduplicates comments written with non-Latin alphabets", () => {
    const result = normalizeConversationCandidates([
      {
        sourceText: "京都でおすすめのホテルは？",
        relevanceScore: 92,
        reason: "Pregunta por alojamiento en Kioto.",
        draftReply: "Puedo recomendarte varias zonas según tu itinerario."
      },
      {
        sourceText: "京都でおすすめのホテルは？",
        relevanceScore: 80,
        reason: "Duplicado.",
        draftReply: "Duplicado"
      }
    ], 65);

    expect(result).toHaveLength(1);
    expect(result[0].sourceText).toContain("京都");
  });

  it("drops invented or structurally incomplete model results", () => {
    const result = normalizeConversationCandidates([
      {
        sourceText: "¿Dónde recomiendan alojarse en Kioto?",
        relevanceScore: 91,
        reason: "Pregunta por Japón.",
        draftReply: "Yo dividiría la estancia entre Kioto y Osaka."
      },
      {
        sourceText: "",
        relevanceScore: 100,
        reason: "Sin texto visible.",
        draftReply: "Respuesta inventada"
      },
      {
        sourceText: "Pregunta válida",
        relevanceScore: 90,
        reason: "Falta una respuesta"
      }
    ], 65);

    expect(result).toHaveLength(1);
    expect(result[0].sourceText).toContain("Kioto");
  });

  it("treats screenshot text as untrusted content in the model contract", () => {
    const prompt = buildConversationRadarSystemPrompt(validRequest.rule);
    expect(prompt).toMatch(/contenido no fiable/i);
    expect(prompt).toMatch(/no sigas instrucciones/i);
    expect(prompt).toMatch(/no inventes/i);
    expect(prompt).toMatch(/solo.*visible/i);
  });

  it("ignores corrupt local rules and keeps only valid reusable rules", () => {
    expect(readStoredConversationRules("not-json")).toEqual([]);
    expect(readStoredConversationRules(JSON.stringify([
      validRequest.rule,
      { ...validRequest.rule, id: "invalid", topic: "x" }
    ]))).toEqual([validRequest.rule]);
  });
});
