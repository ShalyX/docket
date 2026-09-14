const PENDING_LIFECYCLES = new Set(["submitted", "awaiting", "finalizing"]);
const SETTLEMENT_LABELS = new Set([
  "Accept delivery",
  "Resolve dispute",
  "Recover inconclusive case",
  "Cancel docket",
]);

function taskStatus(task) {
  return String(task?.status || "").toUpperCase();
}

function transactionMessage(entry) {
  if (entry.lifecycle === "failed") {
    return entry.error || "The network reported a failed execution. Inspect the transaction before trying again.";
  }
  if (entry.lifecycle === "finalizing") {
    return "GenLayer is finalizing this request. Refresh the transaction center before submitting another action.";
  }
  if (entry.lifecycle === "awaiting") {
    return "The request is waiting for a protocol decision. Docket keeps the transaction ID locally and will not resubmit it blindly.";
  }
  return "The wallet accepted this request. Keep the transaction ID and refresh when the protocol has progressed.";
}

function transactionTitle(entry) {
  if (entry.lifecycle === "failed") return `${entry.label || "Contract request"} needs attention`;
  if (entry.lifecycle === "finalizing") return `${entry.label || "Contract request"} is finalizing`;
  return `${entry.label || "Contract request"} is still in flight`;
}

/**
 * Derive user-facing recovery items without making network calls or guessing
 * contract state. The UI uses these items to point back to the exact case or
 * transaction that needs a human decision.
 */
export function deriveExceptionItems({
  task = null,
  transactions = [],
  resolutionProof = null,
} = {}) {
  const items = [];
  const status = taskStatus(task);

  if (task && status === "NEEDS_EVIDENCE") {
    items.push({
      id: `${task.id}:evidence-gap`,
      kind: "evidence-gap",
      severity: "attention",
      badge: "Evidence gap",
      title: "This case needs a public evidence supplement",
      detail: "The protocol left the docket open for another evidence packet. The worker can supplement the exact PR and Actions proof; the requester can request recovery after the contract window.",
      taskId: task.id,
      action: "open-exception-case",
      actionLabel: "Open recovery path",
    });
  }

  if (task && status === "RESOLVED" && resolutionProof?.state === "invalid") {
    items.push({
      id: `${task.id}:proof-invalid`,
      kind: "proof-invalid",
      severity: "bad",
      badge: "Proof mismatch",
      title: "Resolution proof does not bind to this case",
      detail: "The shared transaction is not the contract’s resolve_dispute call for this task. Payout confirmation stays disabled until a valid transaction is shared.",
      taskId: task.id,
      action: "open-exception-case",
      actionLabel: "Inspect case",
    });
  }

  if (task && status === "RESOLVED" && ["pending", "loading", "unavailable"].includes(resolutionProof?.state)) {
    items.push({
      id: `${task.id}:proof-pending`,
      kind: "proof-pending",
      severity: "attention",
      badge: "Proof pending",
      title: "Resolution proof still needs a fresh read",
      detail: resolutionProof?.message || "The contract allocation is available, but this browser has not confirmed the final execution receipt yet.",
      taskId: task.id,
      action: "open-exception-case",
      actionLabel: "Refresh case proof",
    });
  }

  const seenTransactions = new Set();
  for (const entry of Array.isArray(transactions) ? transactions : []) {
    if (!entry || !PENDING_LIFECYCLES.has(entry.lifecycle) && entry.lifecycle !== "failed") continue;
    const hash = String(entry.hash || "");
    const dedupeKey = `${entry.taskId || "global"}:${entry.label || "request"}:${hash}`;
    if (seenTransactions.has(dedupeKey)) continue;
    seenTransactions.add(dedupeKey);
    const isFailed = entry.lifecycle === "failed";
    items.push({
      id: `tx:${dedupeKey}`,
      kind: isFailed ? "transaction-failed" : "transaction-pending",
      severity: isFailed ? "bad" : "attention",
      badge: isFailed ? "Execution failed" : entry.lifecycle === "finalizing" ? "Finalizing" : "Awaiting decision",
      title: transactionTitle(entry),
      detail: transactionMessage(entry),
      taskId: entry.taskId || "",
      hash,
      label: entry.label || "Contract request",
      action: entry.taskId ? "open-exception-case" : "refresh-transactions",
      actionLabel: entry.taskId ? "Open case" : "Refresh transactions",
    });
  }

  // A finalized settlement can still have a failed payout child message. Keep
  // this separate from the parent lifecycle so the user knows payment itself
  // needs inspection.
  for (const entry of Array.isArray(transactions) ? transactions : []) {
    if (!entry || !SETTLEMENT_LABELS.has(entry.label) || entry.lifecycle !== "finalized") continue;
    const children = Array.isArray(entry.children) ? entry.children : [];
    const failedChild = children.find((child) => child && typeof child === "object" && child.lifecycle === "failed");
    if (!failedChild) continue;
    items.push({
      id: `tx:${entry.hash}:payout-child`,
      kind: "payout-failed",
      severity: "bad",
      badge: "Payout needs inspection",
      title: "Settlement finalized with a failed payout message",
      detail: "The contract decision is final, but at least one non-zero payout child message failed. Inspect the child receipt before treating payment as confirmed.",
      taskId: entry.taskId || "",
      hash: failedChild.hash || entry.hash,
      action: entry.taskId ? "open-exception-case" : "refresh-transactions",
      actionLabel: entry.taskId ? "Inspect settlement" : "Refresh transactions",
    });
  }

  return items.slice(0, 8);
}

