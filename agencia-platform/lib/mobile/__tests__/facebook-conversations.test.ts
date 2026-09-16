import { describe, expect, it } from "vitest";
import { createConversationBatch, parseConversationBatch, serializeConversationBatch, validateConversationApproval, type ConversationReply } from "@/lib/mobile/facebook-conversations";
import { mobileAutomationDraftSchema } from "@/lib/mobile/automation-policy";

const config = { targetUrl: "", niche: "franquicias", criteria: "", replyGuidance: "Considero que los supermercados serán rentables", postsPerGroup: 5, commentScreensPerPost: 5 };
const reply: ConversationReply = { id: "1", groupName: "Franquicias", groupUrl: "", postAnchor: "Publicación original", author: "Ana", sourceText: "Qué franquicia recomiendas", sourceLabel: "Responder al comentario de Ana", reply: "Considero que…", selected: true, outcome: "pending", detail: "", reason: "Pregunta relevante" };
describe("Facebook conversation batch", () => {
  it("accepts blank destination and criteria for an account-wide scan", () => {
    expect(mobileAutomationDraftSchema.safeParse({ platform: "facebook", sourceKind: "COMMENT_DISCOVERY", idempotencyKey: "47d9c37e-54ef-44e1-80a8-f9d2a55b93f7", phoneKey: "phone", deviceSerial: "serial", targetUrl: "", facts: "", replyGuidance: config.replyGuidance }).success).toBe(true);
  });
  it("still requires a destination for other workflows", () => {
    expect(mobileAutomationDraftSchema.safeParse({ platform: "facebook", sourceKind: "COMMENT_REPLY", idempotencyKey: "47d9c37e-54ef-44e1-80a8-f9d2a55b93f7", phoneKey: "phone", deviceSerial: "serial", targetUrl: "", facts: "Texto suficiente para generar una respuesta real" }).success).toBe(false);
  });
  it("persists the review context and allows manual reply edits", () => {
    const original = { ...createConversationBatch(config), candidates: [reply] };
    const edited = parseConversationBatch(serializeConversationBatch(original));
    edited.candidates[0].reply = "Mi opinión editada";
    expect(validateConversationApproval(original, edited).candidates[0].reply).toBe("Mi opinión editada");
  });
  it("rejects changed comment destinations, including forged IDs", () => {
    const original = { ...createConversationBatch(config), candidates: [reply] };
    expect(() => validateConversationApproval(original, { ...original, candidates: [{ ...reply, groupName: "Otro grupo" }] })).toThrow("destinatario");
    expect(() => validateConversationApproval(original, { ...original, candidates: [{ ...reply, id: "2" }] })).toThrow("no válido");
  });
  it("requires at least one nonempty selected reply", () => {
    const original = { ...createConversationBatch(config), candidates: [reply] };
    expect(() => validateConversationApproval(original, { ...original, candidates: [{ ...reply, selected: false }] })).toThrow("Selecciona");
    expect(() => validateConversationApproval(original, { ...original, candidates: [{ ...reply, reply: " " }] })).toThrow("vacías");
  });
});
