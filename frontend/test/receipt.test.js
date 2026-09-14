import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseReceipt } from "../src/receipt.js";

test("builds a compact public receipt from a finalized proportional settlement", () => {
  const receipt = buildCaseReceipt({
    task: {
      id: "dkt-receipt-20260913",
      status: "RESOLVED",
      title: "Ship the checked handoff",
      repositoryUrl: "https://github.com/example/repo",
      requester: "0xrequester",
      worker: "0xworker",
      escrowAmount: "1000000000000000000",
      passedBps: 7000,
      workerAmount: "700000000000000000",
      requesterAmount: "300000000000000000",
      criteria: [
        { id: "docs", description: "Docs exist", weightBps: 4000, finding: "PASS", rationale: "The file is present." },
        { id: "ci", description: "CI passes", weightBps: 3000, finding: "PASS", rationale: "The run succeeded." },
        { id: "receipt", description: "Receipt exists", weightBps: 3000, finding: "FAIL", rationale: "The file is absent." },
      ],
      evidenceManifest: JSON.stringify({
        pr_url: "https://github.com/example/repo/pull/4",
        head_sha: "a".repeat(40),
        actions_run_url: "https://github.com/example/repo/actions/runs/42",
      }),
      evidenceSnapshot: JSON.stringify({
        verification_status: "VERIFIED",
        head_sha: "a".repeat(40),
        changed_files_total: 2,
        workflow_status: "completed",
        workflow_conclusion: "success",
        relationships: { config_at_head_matches_registration: true },
        changed_files: [{ filename: "private-looking.log", patch_excerpt: "should not ship" }],
      }),
    },
    resolutionProof: {
      hash: "0xresolution",
      state: "verified",
      finalized: true,
      payoutsDelivered: true,
    },
    adjudication: {
      canAppeal: false,
      lifecycle: { storedStatus: "Finalized", projectedStatus: "Finalized" },
    },
  });

  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.task_id, "dkt-receipt-20260913");
  assert.equal(receipt.escrow_wei, "1000000000000000000");
  assert.equal(receipt.criteria[2].finding, "FAIL");
  assert.equal(receipt.evidence.manifest.head_sha, "a".repeat(40));
  assert.equal(receipt.evidence.relationships.config_at_head_matches_registration, true);
  assert.deepEqual(receipt.settlement, {
    passed_bps: 7000,
    worker_amount_wei: "700000000000000000",
    requester_amount_wei: "300000000000000000",
    resolution_transaction: "0xresolution",
    execution: "verified",
    payouts_delivered: true,
    stored_status: "Finalized",
    projected_status: "Finalized",
    appeal_eligible: false,
  });
  assert.equal(JSON.stringify(receipt).includes("patch_excerpt"), false);
  assert.equal(JSON.stringify(receipt).includes("private-looking.log"), false);
});

test("keeps unresolved receipts explicit and serializable", () => {
  const receipt = buildCaseReceipt({
    task: { id: "dkt-open-20260913", status: "OPEN", criteria: [] },
  });
  assert.equal(receipt.status, "OPEN");
  assert.equal(receipt.evidence.manifest, null);
  assert.equal(receipt.settlement.resolution_transaction, "");
  assert.doesNotThrow(() => JSON.stringify(receipt));
});

test("joins snake_case checklist rows with onchain findings", () => {
  const receipt = buildCaseReceipt({
    task: {
      task_id: "dkt-snake-case-20260913",
      status: "RESOLVED",
      checklist: [{ id: "docs", description: "Docs exist", weight_bps: 4000 }],
      findings: [{ id: "docs", verdict: "PASS", reason: "The file is present." }],
    },
  });
  assert.deepEqual(receipt.criteria, [{
    id: "docs",
    description: "Docs exist",
    weight_bps: 4000,
    finding: "PASS",
    rationale: "The file is present.",
  }]);
});
