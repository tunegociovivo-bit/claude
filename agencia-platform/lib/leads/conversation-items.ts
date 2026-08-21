export type LeadConversationItem = {
  id: string;
  externalMessageId: string | null;
  direction: "in" | "out";
  body: string;
  at: string;
  instanceName: string | null;
  kind: "inbox" | "campaign";
  classification?: string | null;
  status?: string;
  ack?: number | null;
};

/**
 * WAHA/Evolution can echo a campaign send back through the phone-history
 * webhook. Both database rows represent one WhatsApp message when their
 * provider identifier is identical. Keep the campaign bubble, but enrich it
 * with the strongest acknowledgement captured by the phone history.
 *
 * Legacy campaign rows sometimes lack that provider identifier. For those
 * rows only, an opposite-source row with identical text within 90 seconds is
 * the phone-history echo. Two rows with different provider IDs are always
 * retained, as are two rows from the same source.
 */
export function mergeLeadConversationItems(items: LeadConversationItem[]): LeadConversationItem[] {
  const merged: LeadConversationItem[] = [];
  const outboundByExternalId = new Map<string, number>();

  for (const item of [...items].sort((left, right) => left.at.localeCompare(right.at))) {
    const externalId = item.externalMessageId?.trim();
    if (item.direction !== "out") {
      merged.push(item);
      continue;
    }

    const legacyMatchIndex = merged.findLastIndex((candidate) => {
      if (candidate.direction !== "out" || candidate.kind === item.kind) return false;
      const candidateExternalId = candidate.externalMessageId?.trim();
      if (externalId && candidateExternalId) return false;
      if (candidate.body.trim() !== item.body.trim()) return false;
      return Math.abs(Date.parse(candidate.at) - Date.parse(item.at)) <= 90_000;
    });

    if (legacyMatchIndex >= 0) {
      const existing = merged[legacyMatchIndex];
      const campaign = existing.kind === "campaign" ? existing : item.kind === "campaign" ? item : existing;
      const other = campaign === existing ? item : existing;
      merged[legacyMatchIndex] = {
        ...campaign,
        externalMessageId: campaign.externalMessageId ?? other.externalMessageId,
        at: existing.at < item.at ? existing.at : item.at,
        instanceName: campaign.instanceName ?? other.instanceName,
        ack: Math.max(campaign.ack ?? 0, other.ack ?? 0) || null
      };
      continue;
    }

    if (!externalId) {
      merged.push(item);
      continue;
    }

    const existingIndex = outboundByExternalId.get(externalId);
    if (existingIndex === undefined) {
      outboundByExternalId.set(externalId, merged.length);
      merged.push(item);
      continue;
    }

    const existing = merged[existingIndex];
    const campaign = existing.kind === "campaign" ? existing : item.kind === "campaign" ? item : existing;
    const other = campaign === existing ? item : existing;
    merged[existingIndex] = {
      ...campaign,
      at: existing.at < item.at ? existing.at : item.at,
      instanceName: campaign.instanceName ?? other.instanceName,
      ack: Math.max(campaign.ack ?? 0, other.ack ?? 0) || null
    };
  }

  return merged.sort((left, right) => left.at.localeCompare(right.at));
}
