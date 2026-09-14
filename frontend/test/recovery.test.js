import assert from "node:assert/strict";
import test from "node:test";
import { deriveRecoveryWindow } from "../src/recovery.js";

test("keeps requester recovery gated until the seven-day window", () => {
  const inconclusiveAt = 1_700_000_000;
  const window = deriveRecoveryWindow({
    status: "NEEDS_EVIDENCE",
    createdAt: inconclusiveAt - 60,
    inconclusiveAt,
    now: inconclusiveAt + 6 * 24 * 60 * 60,
  });

  assert.equal(window.state, "waiting");
  assert.equal(window.eligible, false);
  assert.equal(window.eligibleAt, inconclusiveAt + 7 * 24 * 60 * 60);
  assert.equal(window.remainingSeconds, 24 * 60 * 60);
});

test("opens recovery at the earliest of the retry window or absolute deadline", () => {
  const createdAt = 1_700_000_000;
  const window = deriveRecoveryWindow({
    status: "NEEDS_EVIDENCE",
    createdAt,
    inconclusiveAt: createdAt + 25 * 24 * 60 * 60,
    now: createdAt + 30 * 24 * 60 * 60,
  });

  assert.equal(window.state, "eligible");
  assert.equal(window.eligible, true);
  assert.equal(window.eligibleAt, createdAt + 30 * 24 * 60 * 60);
  assert.equal(window.remainingSeconds, 0);
});

test("leaves non-recovery states out of the recovery window", () => {
  assert.deepEqual(deriveRecoveryWindow({ status: "RESOLVED", now: 1_700_000_000 }), {
    state: "not-applicable",
    eligible: false,
    eligibleAt: null,
    retryEligibleAt: null,
    deadlineAt: null,
    remainingSeconds: 0,
  });
});

test("does not treat zero timestamps as an expired recovery window", () => {
  const window = deriveRecoveryWindow({ status: "NEEDS_EVIDENCE", createdAt: 0, inconclusiveAt: 0, now: 1_700_000_000 });
  assert.equal(window.state, "unknown");
  assert.equal(window.eligible, false);
  assert.equal(window.eligibleAt, null);
});
