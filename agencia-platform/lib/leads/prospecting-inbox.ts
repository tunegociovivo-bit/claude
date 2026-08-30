export type ProspectingInboxStore = "prospecting" | "lead-inbox";

export function inboxMessageId(store: ProspectingInboxStore, id: string) {
  return `${store}:${id}`;
}

export function splitInboxMessageIds(ids: string[]) {
  const prospecting = new Set<string>();
  const leadInbox = new Set<string>();
  for (const opaqueId of ids) {
    const separator = opaqueId.indexOf(":");
    if (separator <= 0 || separator === opaqueId.length - 1) continue;
    const store = opaqueId.slice(0, separator);
    const id = opaqueId.slice(separator + 1);
    if (store === "prospecting") prospecting.add(id);
    if (store === "lead-inbox") leadInbox.add(id);
  }
  return { prospecting: [...prospecting], leadInbox: [...leadInbox] };
}
