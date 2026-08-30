export const ENQUEUE_BATCH_SIZE = 20;
export const EXPENSIVE_ENQUEUE_BATCH_SIZE = 5;
export const ENQUEUE_BATCH_DELAY_MS = 2_100;
export const ENQUEUE_MAX_RATE_LIMIT_RETRIES = 5;
export const ENQUEUE_MAX_TRANSIENT_RETRIES = 4;

const EXPENSIVE_FORMATS = new Set(["ranking", "text_then_image", "voice", "voice_image", "alternate", "mix"]);

export function splitEnqueueBatches(leadIds: string[], kind = "text"): string[][] {
  const batchSize = EXPENSIVE_FORMATS.has(kind) ? EXPENSIVE_ENQUEUE_BATCH_SIZE : ENQUEUE_BATCH_SIZE;
  const batches: string[][] = [];
  for (let index = 0; index < leadIds.length; index += batchSize) {
    batches.push(leadIds.slice(index, index + batchSize));
  }
  return batches;
}

export function isRetryableEnqueueStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function enqueueRetryDelayMs(retryAfter: string | null, attempt: number, status = 429): number {
  const retryAfterSeconds = retryAfter == null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.max(1_000, retryAfterSeconds * 1_000);
  }
  if (status !== 429) return Math.min(15_000, 2_000 * 2 ** attempt);
  return Math.min(60_000, 15_000 * 2 ** attempt);
}
