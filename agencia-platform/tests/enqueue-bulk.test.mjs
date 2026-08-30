import assert from "node:assert/strict";
import test from "node:test";
import { ENQUEUE_BATCH_SIZE, enqueueRetryDelayMs, isRetryableEnqueueStatus, splitEnqueueBatches } from "../lib/leads/enqueue-bulk.ts";

test("splits a large enqueue request into durable request-sized batches", () => {
  const leadIds = Array.from({ length: 406 }, (_, index) => `lead-${index + 1}`);

  const batches = splitEnqueueBatches(leadIds);

  assert.equal(batches.length, 21);
  assert.ok(batches.every((batch) => batch.length <= ENQUEUE_BATCH_SIZE));
  assert.deepEqual(batches.flat(), leadIds);
});

test("does not create empty batches", () => {
  assert.deepEqual(splitEnqueueBatches([]), []);
});

test("uses smaller batches for formats that call external AI or Places services", () => {
  const leadIds = Array.from({ length: 20 }, (_, index) => `lead-${index + 1}`);

  for (const kind of ["ranking", "text_then_image", "voice", "voice_image", "alternate", "mix"]) {
    const batches = splitEnqueueBatches(leadIds, kind);
    assert.equal(batches.length, 4, kind);
    assert.ok(batches.every((batch) => batch.length <= 5), kind);
  }
});

test("honors Retry-After and otherwise backs off safely after a 429", () => {
  assert.equal(enqueueRetryDelayMs("12", 0), 12_000);
  assert.equal(enqueueRetryDelayMs(null, 0), 15_000);
  assert.equal(enqueueRetryDelayMs(null, 1), 30_000);
  assert.equal(enqueueRetryDelayMs(null, 10), 60_000);
});

test("retries transient gateway errors with a shorter exponential delay", () => {
  for (const status of [429, 502, 503, 504]) assert.equal(isRetryableEnqueueStatus(status), true);
  for (const status of [400, 401, 500]) assert.equal(isRetryableEnqueueStatus(status), false);
  assert.equal(enqueueRetryDelayMs(null, 0, 502), 2_000);
  assert.equal(enqueueRetryDelayMs(null, 1, 503), 4_000);
  assert.equal(enqueueRetryDelayMs(null, 10, 504), 15_000);
});
