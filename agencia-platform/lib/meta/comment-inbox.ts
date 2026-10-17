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
    && (filters.status === "history" ? ["deleted", "hidden", "replied"].includes(item.status)
      : filters.status === "negative_all" ? item.sentiment === "negative" && item.status !== "ignored_self"
        : filters.status === "positive_all" ? item.sentiment === "positive" && item.status !== "ignored_self"
          : filters.status === "neutral_all" ? !["negative", "positive"].includes(item.sentiment) && item.status !== "ignored_self"
            : filters.status === "deleted_all" ? ["deleted", "hidden"].includes(item.status)
              : filters.status === "replied_all" ? item.status === "replied"
                : !["deleted", "hidden", "ignored_self"].includes(item.status) && (filters.status === "all"
                  || (filters.status === "pending" ? item.status !== "replied"
                    : filters.status === "negative" ? item.sentiment === "negative" && item.status !== "replied"
                      : item.status === "replied")))
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

const searchable = (value: string | null | undefined) => String(value ?? "")
  .toLocaleLowerCase("es-ES")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/\s+/g, " ")
  .trim();

/** Búsqueda libre en la bandeja: texto del comentario, autor, anuncio, campaña o cliente. */
export function matchesMetaCommentSearch(
  item: { message?: string | null; authorName?: string | null; adName?: string | null; feed: MetaInboxItem["feed"] },
  query: string
): boolean {
  const terms = searchable(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const haystack = searchable([
    item.message, item.authorName, item.adName, item.feed.campaignName, item.feed.displayName, item.feed.adAccountName, item.feed.clientName
  ].join(" "));
  return terms.every((term) => haystack.includes(term));
}

/** Enlace al comentario en Facebook (publicación «página_post» + id del comentario). */
export function facebookCommentUrl(postId: string | null | undefined, externalCommentId: string | null | undefined): string | null {
  if (!postId || !/^\d+_\d+$/.test(postId)) return null;
  const commentId = String(externalCommentId ?? "").split("_").pop() ?? "";
  return `https://www.facebook.com/${postId}${/^\d+$/.test(commentId) ? `?comment_id=${commentId}` : ""}`;
}
