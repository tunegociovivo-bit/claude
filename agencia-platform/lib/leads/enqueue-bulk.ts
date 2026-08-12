export const ENQUEUE_BATCH_SIZE = 20;

export function splitEnqueueBatches(leadIds: string[]): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < leadIds.length; index += ENQUEUE_BATCH_SIZE) {
    batches.push(leadIds.slice(index, index + ENQUEUE_BATCH_SIZE));
  }
  return batches;
}
