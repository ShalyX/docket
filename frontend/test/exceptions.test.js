import test from "node:test";
import assert from "node:assert/strict";
import { deriveExceptionItems } from "../src/exceptions.js";

test("surfaces the supplement and recovery path for an evidence gap", () => {
  const items = deriveExceptionItems({
    task: { id: "dkt-gap-20260912", status: "NEEDS_EVIDENCE" },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "evidence-gap");
  assert.equal(items[0].action, "open-exception-case");
});

test("keeps failed and finalizing wallet requests actionable", () => {
  const items = deriveExceptionItems({
    transactions: [
      { hash: "0xfailed", taskId: "dkt-fail-20260912", label: "Accept delivery", lifecycle: "failed", error: "Rejected" },
      { hash: "0xpending", taskId: "dkt-wait-20260912", label: "Resolve dispute", lifecycle: "finalizing" },
    ],
  });
  assert.deepEqual(items.map((item) => item.kind), ["transaction-failed", "transaction-pending"]);
  assert.equal(items[0].actionLabel, "Open case");
  assert.equal(items[1].badge, "Finalizing");
});

test("separates a failed payout child from a finalized settlement", () => {
  const items = deriveExceptionItems({
    transactions: [{
      hash: "0xparent",
      taskId: "dkt-payout-20260912",
      label: "Resolve dispute",
      lifecycle: "finalized",
      children: [{ hash: "0xchild", lifecycle: "failed" }],
    }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "payout-failed");
  assert.equal(items[0].hash, "0xchild");
});

