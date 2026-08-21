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
 * Text and timestamp are deliberately not used as identity: two intentional
 * sends can contain the same copy in the same minute and must remain visible.
 */
export function mergeLeadConversationItems(items: LeadConversationItem[]): LeadConversationItem[] {
  const merged: LeadConversationItem[] = [];
  const outboundByExternalId = new Map<string, number>();

  for (const item of [...items].sort((left, right) => left.at.localeCompare(right.at))) {
    const externalId = item.externalMessageId?.trim();
    if (item.direction !== "out" || !externalId) {
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
