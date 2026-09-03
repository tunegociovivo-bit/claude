export type ConversationItem = {
  id: string;
  direction: "in" | "out";
  body: string;
  at: string;
};

export type PendingConversationReply = ConversationItem & {
  deliveryState: "sending" | "failed";
  deliveryError?: string;
};

export function failPendingReply(pending: PendingConversationReply[], id: string, error: string) {
  return pending.map(reply => reply.id === id
    ? { ...reply, deliveryState: "failed" as const, deliveryError: error }
    : reply);
}

export function visibleConversationItems<T extends ConversationItem>(server: T[], pending: PendingConversationReply[]) {
  const serverIds = new Set(server.map(item => item.id));
  return [...server, ...pending.filter(item => !serverIds.has(item.id))];
}

export function whatsappAckLabel(ack: number | null | undefined) {
  if (typeof ack !== "number" || ack < 1) return "Pendiente de confirmación";
  if (ack >= 3) return "Leído";
  if (ack >= 2) return "Entregado";
  return "Enviado";
}
