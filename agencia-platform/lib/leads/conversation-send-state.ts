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
