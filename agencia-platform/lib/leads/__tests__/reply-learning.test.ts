import { describe, expect, it } from "vitest";
import { selectReplyExamples } from "../reply-learning";

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("selectReplyExamples", () => {
  it("prefers same-sector human replies and excludes automation", () => {
    const messages: any[] = [
      { direction: "in", body: "¿Cuánto cuesta gestionar las redes?", phoneNormalized: "1", fromPhone: "1", leadId: "a", classification: "info_request", meta: null, receivedAt: at(30), lead: { category: "restaurante" } },
      { direction: "out", body: "Depende del punto de partida. ¿Te llamo y lo vemos en 10 minutos?", phoneNormalized: "1", fromPhone: "1", leadId: "a", classification: null, meta: { source: "human_reply" }, receivedAt: at(29), lead: { category: "restaurante" } },
      { direction: "in", body: "¿Cuánto cuesta?", phoneNormalized: "2", fromPhone: "2", leadId: "b", classification: "info_request", meta: null, receivedAt: at(20), lead: { category: "piscinas" } },
      { direction: "out", body: "Respuesta automática", phoneNormalized: "2", fromPhone: "2", leadId: "b", classification: null, meta: { source: "auto_reply" }, receivedAt: at(19), lead: { category: "piscinas" } }
    ];
    const result = selectReplyExamples(messages, { phone: "current", text: "¿Qué precio tiene llevar redes?", category: "restaurante", classification: "info_request" });
    expect(result).toHaveLength(1);
    expect(result[0].reply).toContain("10 minutos");
  });
});
