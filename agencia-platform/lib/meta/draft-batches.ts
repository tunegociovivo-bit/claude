export async function generateDraftBatches(
  ids: string[],
  request: (ids: string[]) => Promise<{ drafts: Record<string, string> }>,
  progress: (drafts: Record<string, string>, completed: number, total: number) => void,
) {
  const uniqueIds = [...new Set(ids)];
  const failedIds: string[] = [];
  let lastError: string | undefined;
  for (let offset = 0; offset < uniqueIds.length; offset += 5) {
    const batch = uniqueIds.slice(offset, offset + 5);
    let drafts: Record<string, string> = {};
    try {
      const result = await request(batch);
      drafts = Object.fromEntries(batch.filter((id) => typeof result.drafts?.[id] === "string").map((id) => [id, result.drafts[id]]));
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    failedIds.push(...batch.filter((id) => !(id in drafts)));
    progress(drafts, offset + batch.length, uniqueIds.length);
  }
  return { failedIds, lastError };
}
