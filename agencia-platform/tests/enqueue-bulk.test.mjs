import assert from "node:assert/strict";
import test from "node:test";
import { ENQUEUE_BATCH_SIZE, splitEnqueueBatches } from "../lib/leads/enqueue-bulk.ts";

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
