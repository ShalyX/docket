import assert from "node:assert/strict";
import test from "node:test";
import { buildStructuredDisputeReason, summarizeReview } from "../src/review.js";

const criteria = [
  { id: "relay-api", description: "Relay endpoint works", weightBps: 4000 },
  { id: "receipt-ui", description: "Receipt renders", weightBps: 3000 },
  { id: "machine-receipt", description: "Machine receipt exists", weightBps: 3000 },
];

test("projects a 70/30 split from criterion decisions", () => {
  const choices = { "relay-api": "satisfied", "receipt-ui": "satisfied", "machine-receipt": "disputed" };
  assert.deepEqual(summarizeReview(criteria, choices), {
    satisfiedBps: 7000,
    requesterBps: 3000,
    assessedCount: 3,
    totalCount: 3,
    complete: true,
    allSatisfied: false,
    flagged: [{ ...criteria[2], choice: "disputed" }],
  });
});

test("builds a bounded dispute reason tied to the exact commit and criterion", () => {
  const choices = { "relay-api": "satisfied", "receipt-ui": "satisfied", "machine-receipt": "disputed" };
  const reason = buildStructuredDisputeReason({
    criteria,
    choices,
    notes: { "machine-receipt": "The required JSON file is absent." },
    headSha: "cd7910038cd582f82d54831b1aa371cd7a59f6e6",
  });
  assert.match(reason, /commit cd7910038cd582f82d54831b1aa371cd7a59f6e6/);
  assert.match(reason, /Criterion machine-receipt is disputed\. The required JSON file is absent\./);
  assert.match(reason, /7000\/10000 bps satisfied/);
  assert.ok(reason.length <= 800);
});
