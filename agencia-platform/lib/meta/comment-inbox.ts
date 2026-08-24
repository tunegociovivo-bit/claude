export type MetaInboxItem = {
  id: string;
  status: string;
  sentiment: string;
  feed: {
    clientName: string;
    displayName?: string | null;
    adAccountName?: string | null;
    campaignId: string;
    campaignName?: string | null;
  };
};

function canonicalClientName(name: string) {
  return name.trim().replace(/\s+(nueva|nuevo)$/i, "").replace(/\s+/g, " ");
}

export function metaClientKey(value: MetaInboxItem["feed"]) {
  return canonicalClientName(value.adAccountName || value.clientName).toLocaleLowerCase("es-ES");
}

export function filterMetaCommentInbox<T extends MetaInboxItem>(
  items: T[],
  filters: { client: string; campaign: string; status: string }
) {
  return items.filter((item) =>
    (filters.client === "all" || metaClientKey(item.feed) === filters.client)
    && (filters.campaign === "all" || item.feed.campaignId === filters.campaign)
    && (filters.status === "all"
      || (filters.status === "pending" ? item.status !== "replied"
        : filters.status === "negative" ? item.sentiment === "negative" && item.status !== "replied"
          : item.status === "replied"))
  );
}

export function campaignOptionsForClient<T extends MetaInboxItem>(items: T[], client: string) {
  const campaigns = new Map<string, string>();
  for (const item of items) {
    if (client !== "all" && metaClientKey(item.feed) !== client) continue;
    campaigns.set(item.feed.campaignId, item.feed.campaignName?.trim() || `Campaña ${item.feed.campaignId}`);
  }
  return [...campaigns.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
}
