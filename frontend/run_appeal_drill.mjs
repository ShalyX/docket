import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const CONTRACT = "0xa6f640F8bb879c9336F9D5A0a8fBdD4f810Af7B3";
const TASK_ID = "dkt-appeal-drill-20260912";
const REPOSITORY = "https://github.com/shalyx/touchline-relay";
const TITLE = "Exercise the native GenLayer appeal path";
const CONFIG_SHA256 = "bca6bad5f2b80f93d770f8b5a41f329ff3f84c05690d19f5b936039269b5cb97";
const ESCROW_WEI = 1_000_000_000_000_000_000n;
const HEAD_SHA = "a42c5d1035fa6d21e572428c2670c81a35f0707f";
const ACTIONS_RUN_ID = 34720906133;
const MANIFEST = {
  pr_url: "https://github.com/shalyx/touchline-relay/pull/3",
  head_sha: HEAD_SHA,
  actions_run_url: `https://github.com/shalyx/touchline-relay/actions/runs/${ACTIONS_RUN_ID}`,
};
const CHECKLIST = [
  {
    id: "document-appeal-path",
    weight_bps: 4000,
    description: 'Add docs/appeal-drill.md with a section titled "Appeal path" that explains this native consensus appeal drill.',
  },
  {
    id: "actions-run-succeeds",
    weight_bps: 3000,
    description: "The submitted pull request has a successful GitHub Actions pull_request workflow run linked to its exact head commit.",
  },
  {
    id: "add-appeal-receipt",
    weight_bps: 3000,
    description: "Add docs/appeal-drill.json containing task_id and appeal_charge_wei fields.",
  },
];
const DISPUTE_REASON = "The delivery omits docs/appeal-drill.json, so the machine-readable appeal receipt criterion is disputed. Evaluate each weighted criterion independently from the public pull request and linked Actions run.";
const CASE_PATH = resolve("..", "deploy", "appeal-drill-case.json");

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

async function writeContract(client, functionName, args, value = 0n, { wait = true } = {}) {
  const request = { address: CONTRACT, functionName, args, value };
  const estimate = await client.estimateTransactionFeesForWrite(request);
  const hash = await client.writeContract({
    ...request,
    fees: { distribution: estimate.distribution, messageAllocations: estimate.messageAllocations, feeValue: estimate.feeValue },
  });
  console.log(`${functionName}-transaction=${hash}`);
  if (!wait) return hash;
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

async function inspect() {
  const task = await readClient.readContract({ address: CONTRACT, functionName: "get_task", args: [TASK_ID], stateStatus: "finalized" });
  console.log(`task=${json(task)}`);
  const lifecycle = await readClient.advanced.getTransactionLifecycle({ hash: process.env.DOCKET_RESOLUTION_TX || "0x0000000000000000000000000000000000000000000000000000000000000000" }).catch(() => null);
  if (lifecycle) console.log(`lifecycle=${json(lifecycle)}`);
}

async function waitForAppeal(txId) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const canAppeal = await readClient.canAppeal({ txId }).catch(() => false);
    const lifecycle = await readClient.advanced.getTransactionLifecycle({ hash: txId }).catch(() => null);
    console.log(`appeal-read-${attempt}: status=${lifecycle?.storedStatus || "unavailable"} projected=${lifecycle?.projectedStatus || "unavailable"} eligible=${canAppeal}`);
    if (canAppeal) return { lifecycle, charge: await readClient.getAppealCharge({ txId }) };
    if (String(lifecycle?.storedStatus || "").toLowerCase() === "finalized") throw new Error("Resolution finalized before an appeal became eligible.");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error("Appeal eligibility did not open within the drill window.");
}

async function resolveAndAppeal() {
  const resolutionTxId = await writeContract(workerClient, "resolve_dispute", [TASK_ID], 0n, { wait: false });
  await save({ taskId: TASK_ID, contractAddress: CONTRACT, resolutionTxId, status: "RESOLUTION_SUBMITTED", manifest: MANIFEST, headSha: HEAD_SHA, configSha256: CONFIG_SHA256 });
  const { lifecycle, charge } = await waitForAppeal(resolutionTxId);
  console.log(`appeal-charge-wei=${charge}`);
  console.log(`appeal-charge-gen=${Number(charge) / 1e18}`);
  const appealedTxId = await requesterClient.appealTransaction({ txId: resolutionTxId, value: charge });
  console.log(`appeal-original-transaction=${appealedTxId}`);
  await save({ status: "APPEAL_SUBMITTED", appealChargeWei: charge.toString(), appealAttempts: 1, protocolBeforeAppeal: lifecycle });
  const receipt = await readClient.waitForTransactionReceipt({ hash: resolutionTxId, status: TransactionStatus.FINALIZED, interval: 2_000, retries: 900 });
  console.log(`resolution-status=${receipt?.statusName || receipt?.status || "FINALIZED"}`);
  console.log(`resolution-execution=${receipt?.txExecutionResultName || "unknown"}`);
  if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) throw new Error(`Resolution finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
  const task = await readClient.readContract({ address: CONTRACT, functionName: "get_task", args: [TASK_ID], stateStatus: "finalized" });
  console.log(`task-after-appeal=${json(task)}`);
  const finalLifecycle = await readClient.advanced.getTransactionLifecycle({ hash: resolutionTxId });
  console.log(`lifecycle-after-appeal=${json(finalLifecycle)}`);
  const children = await readClient.getTriggeredTransactionIds({ hash: resolutionTxId });
  console.log(`payout-transactions=${json(children || [])}`);
  await save({ status: "RESOLVED", finalLifecycle, task: JSON.parse(json(task)), payoutTransactionIds: children || [], resolutionExecutionResult: receipt?.txExecutionResultName });
}

if (stage === "fund") {
  await Promise.all([fund(requester.address), fund(worker.address)]);
  console.log(`requester=${requester.address}`);
  console.log(`worker=${worker.address}`);
} else if (stage === "register") {
  await Promise.all([fund(requester.address), fund(worker.address)]);
  const hash = await writeContract(requesterClient, "register_task", [TASK_ID, worker.address, REPOSITORY, TITLE, JSON.stringify(CHECKLIST), CONFIG_SHA256], ESCROW_WEI);
  await save({ taskId: TASK_ID, contractAddress: CONTRACT, registrationTxId: hash, requester: requester.address, worker: worker.address, repositoryUrl: REPOSITORY, pullRequestUrl: MANIFEST.pr_url, actionsRunUrl: MANIFEST.actions_run_url, headSha: HEAD_SHA, configSha256: CONFIG_SHA256, escrowWei: ESCROW_WEI.toString(), status: "OPEN" });
} else if (stage === "submit") {
  const hash = await writeContract(workerClient, "submit_delivery", [TASK_ID, JSON.stringify(MANIFEST)]);
  await save({ deliveryTxId: hash, status: "SUBMITTED", manifest: MANIFEST });
} else if (stage === "dispute") {
  const hash = await writeContract(requesterClient, "open_dispute", [TASK_ID, DISPUTE_REASON]);
  await save({ disputeTxId: hash, status: "DISPUTED", disputeReason: DISPUTE_REASON });
} else if (stage === "resolve-appeal") {
  await resolveAndAppeal();
} else if (stage === "inspect") {
  await inspect();
} else {
  throw new Error("Use one of: fund, register, submit, dispute, resolve-appeal, inspect");
}
