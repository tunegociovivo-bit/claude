export const ENQUEUE_BATCH_SIZE = 20;
export const EXPENSIVE_ENQUEUE_BATCH_SIZE = 5;

const EXPENSIVE_FORMATS = new Set(["ranking", "text_then_image", "voice", "voice_image", "alternate", "mix"]);

export function splitEnqueueBatches(leadIds: string[], kind = "text"): string[][] {
  const batchSize = EXPENSIVE_FORMATS.has(kind) ? EXPENSIVE_ENQUEUE_BATCH_SIZE : ENQUEUE_BATCH_SIZE;
  const batches: string[][] = [];
  for (let index = 0; index < leadIds.length; index += batchSize) {
    batches.push(leadIds.slice(index, index + batchSize));
  }
  return batches;
}
