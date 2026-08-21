type LeadMeta = {
  phone?: unknown;
  leadId?: unknown;
} | null | undefined;

type TaskCustomData = {
  source?: unknown;
  leadPhone?: unknown;
  leadId?: unknown;
} | null | undefined;

export function isLeadTaskCustomData(customData: TaskCustomData): boolean {
  return customData?.source === "leads" || customData?.source === "lead-commercial-handoff";
}

export function commercialLeadCustomData(lead: { id: string; name: string; phone: string | null }) {
  if (!lead.phone?.trim()) return null;
  const phone = lead.phone.trim();
  return {
    source: "lead-commercial-handoff",
    leadId: lead.id,
    leadName: lead.name,
    leadPhone: phone,
    leadInboxUrl: `/admin/leads?tab=inbox&phone=${encodeURIComponent(phone)}`
  };
}

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

  if (!isLeadTaskCustomData(customData)) return null;

  const phone = nonEmptyString(customData?.leadPhone);
  if (!phone) return null;
  return { phone, leadId: nonEmptyString(customData?.leadId) };
}
