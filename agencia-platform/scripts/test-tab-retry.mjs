import test from "node:test";
import assert from "node:assert/strict";
import { isTabTemporarilyBusy, retryTabOperation } from "../chrome-extension/background/tab-retry.mjs";

const busy = () => new Error("Tabs cannot be edited right now (user may be dragging a tab).");

test("retries a transient tab lock and returns the successful operation result", async () => {
  let calls = 0;
  const delays = [];
  const result = await retryTabOperation(async () => {
    if (++calls < 3) throw busy();
    return { id: 42 };
  }, async (ms) => delays.push(ms));
  assert.deepEqual(result, { id: 42 });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("a persistent lock remains recognizable so the job pauses instead of skipping a profile", async () => {
  let calls = 0;
  await assert.rejects(retryTabOperation(async () => { calls++; throw busy(); }, async () => {}), isTabTemporarilyBusy);
  assert.equal(calls, 6);
});

test("does not retry unrelated errors such as a closed tab or permission failure", async () => {
  let calls = 0;
  const original = new Error("No tab with id: 42");
  await assert.rejects(retryTabOperation(async () => { calls++; throw original; }, async () => assert.fail("Unexpected retry")), (error) => error === original);
  assert.equal(calls, 1);
});
