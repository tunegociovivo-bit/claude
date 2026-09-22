export async function requestDraftBatch(
  commentIds: string[],
  onWait: (seconds: number) => void,
  request: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request("/api/v1/meta-comments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate_drafts", commentIds }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) return data;
    if (response.status === 429 && attempt < 2) {
      const raw = Number(response.headers.get("Retry-After"));
      const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120) : 60;
      onWait(seconds);
      await sleep(seconds * 1000 + 250);
      continue;
    }
    throw new Error(data?.error?.message ?? data?.message ?? `No se pudieron generar las respuestas (HTTP ${response.status}).`);
  }
  throw new Error("El límite temporal continúa activo. Reintenta los comentarios pendientes.");
}
