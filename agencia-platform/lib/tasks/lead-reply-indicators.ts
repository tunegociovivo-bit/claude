type LeadTask = { id: string; customData: unknown };
type InboundReply = { leadId: string | null; phoneNormalized: string | null; fromPhone: string };

function normalizedPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/@.*$/, "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

export function leadReferenceFromTask(task: LeadTask) {
  const data = task.customData && typeof task.customData === "object" && !Array.isArray(task.customData)
    ? task.customData as Record<string, unknown>
    : null;
  if (!data || !["leads", "lead-commercial-handoff"].includes(String(data.source ?? ""))) return null;
  return {
    taskId: task.id,
    leadId: typeof data.leadId === "string" && data.leadId ? data.leadId : null,
    phone: normalizedPhone(data.leadPhone)
  };
}

export function buildUnreadLeadReplyCounts(tasks: LeadTask[], replies: InboundReply[]) {
  const references = tasks.map(leadReferenceFromTask).filter((reference): reference is NonNullable<typeof reference> => !!reference);
  const counts: Record<string, number> = {};
  for (const reply of replies) {
    const replyPhone = normalizedPhone(reply.phoneNormalized) ?? normalizedPhone(reply.fromPhone);
    for (const reference of references) {
      const matchesLead = !!reference.leadId && reference.leadId === reply.leadId;
      const matchesPhone = !!reference.phone && reference.phone === replyPhone;
      if (matchesLead || matchesPhone) counts[reference.taskId] = (counts[reference.taskId] ?? 0) + 1;
    }
  }
  return counts;
}
