const RELATIONSHIP_KEYS = [
  "pr_targets_task_repository",
  "manifest_head_matches_pr",
  "workflow_completed_successfully",
  "workflow_head_matches_pr",
  "config_at_head_matches_registration",
  "config_terms_match_registration",
  "workflow_is_pull_request_event",
  "workflow_links_to_manifest_pr",
  "workflow_targets_task_repository",
  "repository_is_public",
  "config_source_is_public",
];

function parseObject(raw) {
  if (!raw) return null;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function text(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function wei(value) {
  try {
    if (typeof value === "bigint") return value >= 0n ? value.toString() : "0";
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim()).toString();
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value).toString();
  } catch {
    // Keep malformed or unavailable values explicit and serializable.
  }
  return "0";
}

function normalizedManifest(raw) {
  const manifest = parseObject(raw);
  if (!manifest) return null;
  return {
    pr_url: text(manifest.pr_url ?? manifest.prUrl),
    head_sha: text(manifest.head_sha ?? manifest.headSha),
    actions_run_url: text(manifest.actions_run_url ?? manifest.actionsRunUrl),
  };
}

function normalizedRelationships(raw) {
  const relationships = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    RELATIONSHIP_KEYS
      .filter((key) => typeof relationships[key] === "boolean")
      .map((key) => [key, relationships[key]]),
  );
}

function normalizedSnapshot(raw, manifest) {
  const snapshot = parseObject(raw) || {};
  const workflowKeys = [
    "workflow_status",
    "workflow_conclusion",
    "workflow_event",
    "workflow_head_sha",
    "workflow_run_attempt",
    "actions_run_url",
  ];
  const workflow = Object.fromEntries(
    workflowKeys
      .filter((key) => snapshot[key] !== undefined && snapshot[key] !== null && snapshot[key] !== "")
      .map((key) => [key, snapshot[key]]),
  );
  return {
    verification_status: text(snapshot.verification_status),
    head_sha: text(snapshot.head_sha || manifest?.head_sha),
    changed_files_total: Number.isSafeInteger(Number(snapshot.changed_files_total))
      ? Number(snapshot.changed_files_total)
      : null,
    workflow,
    relationships: normalizedRelationships(snapshot.relationships),
  };
}

function criterionReceipt(criterion, finding = {}) {
  return {
    id: text(criterion?.id),
    description: text(criterion?.description ?? criterion?.criterion ?? criterion?.name),
    weight_bps: integer(criterion?.weight_bps ?? criterion?.weightBps ?? criterion?.weight),
    finding: text(criterion?.finding || criterion?.verdict || finding?.finding || finding?.verdict).toUpperCase(),
    rationale: text(criterion?.rationale || criterion?.reason || finding?.rationale || finding?.reason),
  };
}

function passedBasisPoints(task, escrowWei, workerWei) {
  const explicit = Number(task?.passedBps ?? task?.passed_bps);
  if (Number.isSafeInteger(explicit) && explicit >= 0 && explicit <= 10_000) return explicit;
  if (escrowWei <= 0n) return 0;
  return Number((workerWei * 10_000n) / escrowWei);
}

/**
 * Build a portable receipt from public task data and the browser's verified
 * protocol reads. The shape intentionally excludes raw patches and logs.
 */
export function buildCaseReceipt({ task = {}, resolutionProof = null, adjudication = null } = {}) {
  const manifest = normalizedManifest(task.evidenceManifest ?? task.evidence_manifest);
  const snapshot = normalizedSnapshot(task.evidenceSnapshot ?? task.evidence_snapshot, manifest);
  const escrowWei = BigInt(wei(task.escrowAmount ?? task.escrow_amount));
  const workerWei = BigInt(wei(task.workerAmount ?? task.worker_amount));
  const requesterWei = BigInt(wei(task.requesterAmount ?? task.requester_amount));
  const lifecycle = adjudication?.lifecycle && typeof adjudication.lifecycle === "object"
    ? adjudication.lifecycle
    : {};
  const criteria = Array.isArray(task.criteria ?? task.checklist) ? (task.criteria ?? task.checklist) : [];
  const findingsById = new Map(
    (Array.isArray(task.findings) ? task.findings : [])
      .filter((finding) => finding && typeof finding === "object")
      .map((finding) => [text(finding.id ?? finding.criterion_id), finding]),
  );

  return {
    schema_version: 1,
    task_id: text(task.id ?? task.task_id),
    status: text(task.status ?? task.task_status).toUpperCase(),
    title: text(task.title),
    repository_url: text(task.repositoryUrl ?? task.repository_url),
    requester: text(task.requester ?? task.requester_address),
    worker: text(task.worker ?? task.worker_address),
    config_sha256: text(task.configSha256 ?? task.config_sha256),
    escrow_wei: escrowWei.toString(),
    decision_reason: text(task.decisionReason ?? task.decision_reason ?? task.dispute_reason),
    criteria: criteria.map((criterion) => criterionReceipt(criterion, findingsById.get(text(criterion?.id)))),
    evidence: {
      manifest,
      verification_status: snapshot.verification_status,
      head_sha: snapshot.head_sha,
      changed_files_total: snapshot.changed_files_total,
      workflow: snapshot.workflow,
      relationships: snapshot.relationships,
    },
    settlement: {
      passed_bps: passedBasisPoints(task, escrowWei, workerWei),
      worker_amount_wei: workerWei.toString(),
      requester_amount_wei: requesterWei.toString(),
      resolution_transaction: text(resolutionProof?.hash),
      execution: text(resolutionProof?.state || "unverified"),
      payouts_delivered: Boolean(resolutionProof?.payoutsDelivered),
      stored_status: text(lifecycle.storedStatus),
      projected_status: text(lifecycle.projectedStatus),
      appeal_eligible: Boolean(adjudication?.canAppeal),
    },
  };
}
