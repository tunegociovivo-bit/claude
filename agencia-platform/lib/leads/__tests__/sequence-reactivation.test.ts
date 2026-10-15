import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("../send-queue", () => ({ SENT_STATUSES: ["sent", "delivered", "read"], enqueueMessage: vi.fn() }));

import { classifyReactivationLead, isHumanOutbound, nicheKey, templatePattern, type ReactivationLeadFacts } from "../sequence-reactivation";

const now = new Date("2026-10-15T10:00:00Z");
const DAY = 86_400_000;
const opts = { fromIndex: 1, stepCount: 3, minDaysSinceContact: 2, includeUnanswered: false, now };
const facts = (over: Partial<ReactivationLeadFacts> = {}): ReactivationLeadFacts => ({
  contactStatus: "contacted",
  isClient: false,
  handedToCommercial: false,
  emailOnly: false,
  hasPhone: true,
  blocked: false,
  firstGenuineInboundAt: null,
  humanReplyAfterInbound: false,
  conversationStatus: null,
  lastSentAt: new Date(now.getTime() - 30 * DAY),
  hasPendingMessage: false,
  inActiveCadence: false,
  inOtherActiveSequence: false,
  thisSequence: null,
  ...over
});
const reason = (f: ReactivationLeadFacts, o = opts) => {
  const verdict = classifyReactivationLead(f, o);
  return verdict.eligible ? "eligible" : verdict.reason;
};

describe("quién entra en la reactivación", () => {
  it("entra quien recibió el primer mensaje y no contestó (o solo saltó la autorrespuesta)", () => {
    expect(reason(facts())).toBe("eligible");
  });

  it("deja fuera a quien ya habla con el comercial", () => {
    const inbound = new Date(now.getTime() - 20 * DAY);
    expect(reason(facts({ contactStatus: "responded", firstGenuineInboundAt: inbound, humanReplyAfterInbound: true }))).toBe("conversation");
    expect(reason(facts({ handedToCommercial: true }))).toBe("conversation");
    expect(reason(facts({ conversationStatus: "followup" }))).toBe("conversation");
    // Aunque se incluyan los no contestados, la conversación en marcha sigue fuera.
    expect(reason(facts({ contactStatus: "responded", firstGenuineInboundAt: inbound, humanReplyAfterInbound: true }), { ...opts, includeUnanswered: true })).toBe("conversation");
  });

  it("deja fuera a bloqueados y no interesados", () => {
    expect(reason(facts({ blocked: true }))).toBe("blocked");
    expect(reason(facts({ contactStatus: "excluded" }))).toBe("blocked");
    expect(reason(facts({ conversationStatus: "not_interested" }))).toBe("blocked");
  });

  it("los que escribieron sin respuesta del equipo quedan fuera salvo que se pidan", () => {
    const f = facts({ contactStatus: "responded", firstGenuineInboundAt: new Date(now.getTime() - 10 * DAY) });
    expect(reason(f)).toBe("unanswered");
    expect(reason(f, { ...opts, includeUnanswered: true })).toBe("eligible");
  });

  it("no duplica: cola, cadencia, otra secuencia activa, pasos ya hechos o contacto reciente", () => {
    expect(reason(facts({ lastSentAt: null }))).toBe("neverContacted");
    expect(reason(facts({ hasPendingMessage: true }))).toBe("pending");
    expect(reason(facts({ inActiveCadence: true }))).toBe("inCadence");
    expect(reason(facts({ inOtherActiveSequence: true }))).toBe("inSequence");
    expect(reason(facts({ thisSequence: { status: "active", currentStep: 0 } }))).toBe("inSequence");
    expect(reason(facts({ thisSequence: { status: "completed", currentStep: 2 } }))).toBe("alreadyDone");
    expect(reason(facts({ lastSentAt: new Date(now.getTime() - DAY) }))).toBe("recent");
    expect(reason(facts({ hasPhone: false }))).toBe("noPhone");
    expect(reason(facts({ contactStatus: "client" }))).toBe("client");
  });

  it("retoma las secuencias que el fallo anterior dejó en pausa tras el primer mensaje", () => {
    expect(reason(facts({ thisSequence: { status: "paused", currentStep: 0 } }))).toBe("eligible");
  });
});

describe("respuestas humanas frente a envíos automáticos", () => {
  const automated = { externalIds: new Set(["wamid.auto"]), bodies: new Set(["hola clínica sol, soy david de negocio vivo."]), patterns: [templatePattern("Gracias {{nombre}}, te escribimos enseguida.")!] };

  it("cuenta las respuestas del panel y del móvil, no la cola ni la autorrespuesta", () => {
    expect(isHumanOutbound({ meta: { source: "human_reply" }, externalMessageId: null, body: "Claro, te llamo" }, automated)).toBe(true);
    expect(isHumanOutbound({ meta: { source: "phone_outbound" }, externalMessageId: "wamid.x", body: "Te mando la info" }, automated)).toBe(true);
    expect(isHumanOutbound({ meta: { source: "phone_outbound" }, externalMessageId: "wamid.auto", body: "x" }, automated)).toBe(false);
    expect(isHumanOutbound({ meta: { source: "phone_outbound" }, externalMessageId: null, body: "Hola Clínica Sol,  soy David de Negocio Vivo." }, automated)).toBe(false);
    expect(isHumanOutbound({ meta: { autoFollowup: true }, externalMessageId: null, body: "¿Pudiste verlo?" }, automated)).toBe(false);
    expect(isHumanOutbound({ meta: null, externalMessageId: null, body: "Gracias Clínica Sol, te escribimos enseguida." }, automated)).toBe(false);
    // En la duda, humano: mejor no meter un recordatorio en mitad de una conversación.
    expect(isHumanOutbound({ meta: null, externalMessageId: null, body: "Perfecto, mañana te llamo" }, automated)).toBe(true);
  });

  it("agrupa nichos sin tildes ni mayúsculas", () => {
    expect(nicheKey("  Clínica de  Fisioterapia ")).toBe("clinica de fisioterapia");
  });
});
