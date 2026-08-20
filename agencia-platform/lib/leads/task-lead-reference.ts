type LeadMeta = {
  phone?: unknown;
  leadId?: unknown;
} | null | undefined;

type TaskCustomData = {
  source?: unknown;
  leadPhone?: unknown;
  leadId?: unknown;
} | null | undefined;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function taskLeadReference(
  leadMeta: LeadMeta,
  customData: TaskCustomData,
): { phone: string; leadId: string | null } | null {
  const livePhone = nonEmptyString(leadMeta?.phone);
  if (livePhone) {
    return { phone: livePhone, leadId: nonEmptyString(leadMeta?.leadId) };
  }

  const supportedSource = customData?.source === "leads" || customData?.source === "lead-commercial-handoff";
  if (!supportedSource) return null;

  const phone = nonEmptyString(customData?.leadPhone);
  if (!phone) return null;
  return { phone, leadId: nonEmptyString(customData?.leadId) };
}
