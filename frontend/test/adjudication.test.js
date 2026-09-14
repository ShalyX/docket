import assert from "node:assert/strict";
import test from "node:test";
import { deriveAdjudicationStages } from "../src/adjudication.js";

test("keeps an accepted decision in its appeal window before finality", () => {
  assert.deepEqual(deriveAdjudicationStages({ hasTx: true, storedStatus: "Accepted", decisionActive: true, canAppeal: true }), {
    packet: "complete",
    consensus: "complete",
    decision: "active",
    appeal: "active",
    finality: "pending",
  });
});

test("shows native appeal committee work as active", () => {
  const stages = deriveAdjudicationStages({ hasTx: true, storedStatus: "AppealCommitting" });
  assert.equal(stages.consensus, "complete");
  assert.equal(stages.decision, "complete");
  assert.equal(stages.appeal, "active");
  assert.equal(stages.finality, "pending");
});

test("closes every stage only at finality", () => {
  assert.deepEqual(deriveAdjudicationStages({ hasTx: true, storedStatus: "Finalized" }), {
    packet: "complete",
    consensus: "complete",
    decision: "complete",
    appeal: "complete",
    finality: "complete",
  });
});
