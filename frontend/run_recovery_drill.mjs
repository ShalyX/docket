import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const CONTRACT = "0xa6f640F8bb879c9336F9D5A0a8fBdD4f810Af7B3";
const TASK_ID = "dkt-recovery-drill-20260912";
const REPOSITORY = "https://github.com/shalyx/touchline-relay";
const TITLE = "Exercise fail-closed evidence recovery";
const CONFIG_SHA256 = "5970b325ffca9024609e31fa9c64df9d090cd7d1f8e3515f1fd946a9d7f98d19";
const ESCROW_WEI = 1_000_000_000_000_000_000n;
const PR_URL = "https://github.com/shalyx/touchline-relay/pull/4";
const ACTIONS_RUN_URL = "https://github.com/shalyx/touchline-relay/actions/runs/34723025237";
const GOOD_HEAD_SHA = "1273ae2155af8bef32f29644d6a60c61f0732695";
const BAD_HEAD_SHA = "0000000000000000000000000000000000000000";
const BAD_MANIFEST = { pr_url: PR_URL, head_sha: BAD_HEAD_SHA, actions_run_url: ACTIONS_RUN_URL };
const GOOD_MANIFEST = { pr_url: PR_URL, head_sha: GOOD_HEAD_SHA, actions_run_url: ACTIONS_RUN_URL };
const CHECKLIST = [
  {
    id: "document-recovery-path",
    weight_bps: 4000,
    description: 'Add docs/recovery-drill.md with a section titled "Recovery path" that explains fail-closed evidence recovery.',
  },
  {
    id: "actions-run-succeeds",
    weight_bps: 3000,
    description: "The submitted pull request has a successful GitHub Actions pull_request workflow run linked to its exact head commit.",
  },
  {
    id: "include-recovery-receipt",
    weight_bps: 3000,
    description: "Add docs/recovery-drill.json containing task_id and recovery_status fields.",
  },
];
const DISPUTE_REASON = "The first evidence packet points at a stale commit, so the public source cannot be verified. Keep escrow locked until the worker supplies a manifest for the immutable PR head.";
const CASE_PATH = resolve("..", "deploy", "recovery-drill-case.json");

const wallets = JSON.parse(await readFile(resolve("..", "deploy", "dispute-pilot-wallets.local.json"), "utf8"));
for (const field of ["requesterPrivateKey", "workerPrivateKey"]) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(wallets[field] || "")) throw new Error(`Missing ${field} in the ignored wallet file`);
}
const requester = createAccount(wallets.requesterPrivateKey);
const worker = createAccount(wallets.workerPrivateKey);
if (requester.address.toLowerCase() !== wallets.requesterAddress.toLowerCase()) throw new Error("Requester signer does not match its recorded address");
if (worker.address.toLowerCase() !== wallets.workerAddress.toLowerCase()) throw new Error("Worker signer does not match its recorded address");

const requesterClient = createClient({ chain: studioNext, account: requester });
const workerClient = createClient({ chain: studioNext, account: worker });
const readClient = createClient({ chain: studioNext });
const stage = process.argv[2] || "inspect";
const json = (value) => JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));

async function fund(address) {
  await readClient.request({ method: "sim_fundAccount", params: [address, "1000000000000000000000"] });
}

async function writeContract(client, functionName, args, value = 0n) {
  const request = { address: CONTRACT, functionName, args, value };
  const estimate = await client.estimateTransactionFeesForWrite(request);
  const hash = await client.writeContract({
    ...request,
    fees: { distribution: estimate.distribution, messageAllocations: estimate.messageAllocations, feeValue: estimate.feeValue },
  });
  console.log(`${functionName}-transaction=${hash}`);
  const receipt = await readClient.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 2_000, retries: 900 });
  console.log(`${functionName}-status=${receipt?.statusName || receipt?.status || "FINALIZED"}`);
  console.log(`${functionName}-execution=${receipt?.txExecutionResultName || "unknown"}`);
  if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) throw new Error(`${functionName} finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
  return hash;
}

async function save(patch) {
  let current = {};
  try { current = JSON.parse(await readFile(CASE_PATH, "utf8")); } catch { /* first stage */ }
  await writeFile(CASE_PATH, `${JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

async function resolveBadEvidence() {
  const resolutionTxId = await writeContract(workerClient, "resolve_dispute", [TASK_ID]);
  const task = await readClient.readContract({ address: CONTRACT, functionName: "get_task", args: [TASK_ID], stateStatus: "finalized" });
  const lifecycle = await readClient.advanced.getTransactionLifecycle({ hash: resolutionTxId });
  console.log(`task-after-fail-closed=${json(task)}`);
  console.log(`lifecycle=${json(lifecycle)}`);
  await save({ resolutionTxId, status: task.status, task: JSON.parse(json(task)), lifecycle });
}

if (stage === "fund") {
  await Promise.all([fund(requester.address), fund(worker.address)]);
  console.log(`requester=${requester.address}`);
  console.log(`worker=${worker.address}`);
} else if (stage === "register") {
  await Promise.all([fund(requester.address), fund(worker.address)]);
  const hash = await writeContract(requesterClient, "register_task", [TASK_ID, worker.address, REPOSITORY, TITLE, JSON.stringify(CHECKLIST), CONFIG_SHA256], ESCROW_WEI);
  await save({ taskId: TASK_ID, contractAddress: CONTRACT, registrationTxId: hash, requester: requester.address, worker: worker.address, repositoryUrl: REPOSITORY, pullRequestUrl: PR_URL, actionsRunUrl: ACTIONS_RUN_URL, goodHeadSha: GOOD_HEAD_SHA, badHeadSha: BAD_HEAD_SHA, configSha256: CONFIG_SHA256, escrowWei: ESCROW_WEI.toString(), status: "OPEN" });
} else if (stage === "submit") {
  const hash = await writeContract(workerClient, "submit_delivery", [TASK_ID, JSON.stringify(BAD_MANIFEST)]);
  await save({ deliveryTxId: hash, manifest: BAD_MANIFEST, status: "SUBMITTED" });
} else if (stage === "dispute") {
  const hash = await writeContract(requesterClient, "open_dispute", [TASK_ID, DISPUTE_REASON]);
  await save({ disputeTxId: hash, disputeReason: DISPUTE_REASON, status: "DISPUTED" });
} else if (stage === "resolve") {
  await resolveBadEvidence();
} else if (stage === "supplement") {
  const hash = await writeContract(workerClient, "supplement_evidence", [TASK_ID, JSON.stringify(GOOD_MANIFEST)]);
  const task = await readClient.readContract({ address: CONTRACT, functionName: "get_task", args: [TASK_ID], stateStatus: "finalized" });
  console.log(`task-after-supplement=${json(task)}`);
  await save({ supplementTxId: hash, manifest: GOOD_MANIFEST, status: task.status });
} else if (stage === "resolve-final") {
  const resolutionTxId = await writeContract(workerClient, "resolve_dispute", [TASK_ID]);
  const task = await readClient.readContract({ address: CONTRACT, functionName: "get_task", args: [TASK_ID], stateStatus: "finalized" });
  const lifecycle = await readClient.advanced.getTransactionLifecycle({ hash: resolutionTxId });
  console.log(`task-after-repair=${json(task)}`);
  console.log(`lifecycle=${json(lifecycle)}`);
  await save({ repairedResolutionTxId: resolutionTxId, task: JSON.parse(json(task)), lifecycle, status: task.status });
} else if (stage === "inspect") {
  const task = await readClient.readContract({ address: CONTRACT, functionName: "get_task", args: [TASK_ID], stateStatus: "finalized" });
  console.log(`task=${json(task)}`);
} else {
  throw new Error("Use one of: fund, register, submit, dispute, resolve, supplement, resolve-final, inspect");
}
