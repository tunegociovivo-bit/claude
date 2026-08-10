export type DailyCostInput = {
  calls: Array<{ durationSec: number | null; providerCost: number | null }>;
  inboundWhatsappMessages: number;
  callMinuteRate: number;
  whatsappMessageRate: number;
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

export function calculateDailyCost(input: DailyCostInput) {
  const callCost = input.calls.reduce((total, call) => {
    if (typeof call.providerCost === "number") return total + call.providerCost;
    return total + ((call.durationSec ?? 0) / 60) * input.callMinuteRate;
  }, 0);
  const whatsappCost = input.inboundWhatsappMessages * input.whatsappMessageRate;
  return {
    callCost: money(callCost),
    whatsappCost: money(whatsappCost),
    totalCost: money(callCost + whatsappCost),
  };
}

export function normalizeGlobalPrompt(value: unknown) {
  return String(value ?? "").trim().slice(0, 12_000);
}

export function normalizeAdminNotes(value: unknown) {
  return String(value ?? "").trim().slice(0, 4_000);
}

export function normalizeClientName(value: unknown) {
  return String(value ?? "").trim().slice(0, 120);
}

export function composeAgentPrompt(globalPrompt: string, clientPrompt: string) {
  const common = normalizeGlobalPrompt(globalPrompt);
  return [
    common ? `INSTRUCCIONES GENERALES DE NEGOCIO VIVO (obligatorias para todos los clientes):\n${common}` : "",
    clientPrompt ? `INSTRUCCIONES ESPECÍFICAS DE ESTE NEGOCIO:\n${clientPrompt}` : "",
  ].filter(Boolean).join("\n\n");
}
