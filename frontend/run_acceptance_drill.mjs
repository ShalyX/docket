import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const CONTRACT = "0xa6f640F8bb879c9336F9D5A0a8fBdD4f810Af7B3";
const TASK_ID = "dkt-accept-drill-20260913";
const REPOSITORY = "https://github.com/shalyx/touchline-relay";
const TITLE = "Exercise requester-authorized acceptance";
const CONFIG_SHA256 = "59b735598f57a646f11914c46a1acd85f3857e1890eb8400ca5015e6a70b49a3";
const ESCROW_WEI = 1_000_000_000_000_000_000n;
const HEAD_SHA = "c23236b1110718a4998149429e9540b737e51663";
const MANIFEST = {
  pr_url: "https://github.com/shalyx/touchline-relay/pull/5",
  head_sha: HEAD_SHA,
  actions_run_url: "https://github.com/shalyx/touchline-relay/actions/runs/34774786923",
};
const CHECKLIST = [
  {
    id: "document-acceptance-path",
    weight_bps: 4000,
    description: 'Add docs/acceptance-drill.md with a section titled "Acceptance path" that explains requester-authorized full settlement.',
  },
  {
    id: "actions-run-succeeds",
    weight_bps: 3000,
    description: "The submitted pull request has a successful GitHub Actions pull_request workflow run linked to its exact head commit.",
  },
  {
    id: "include-acceptance-receipt",
    weight_bps: 3000,
    description: "Add docs/acceptance-drill.json containing task_id and expected_worker_amount_wei fields.",
  },
];
const CASE_PATH = resolve("..", "deploy", "acceptance-drill-case.json");

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
  return { hash, receipt };
}

async function save(patch) {
  let current = {};
  try { current = JSON.parse(await readFile(CASE_PATH, "utf8")); } catch { /* first stage */ }
  await writeFile(CASE_PATH, `${JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

async function readTaskAndBalances() {
  const task = await readClient.readContract({ address: CONTRACT, functionName: "get_task", args: [TASK_ID], stateStatus: "finalized" });
  const [contractBalance, requesterBalance, workerBalance] = await Promise.all([
    readClient.request({ method: "eth_getBalance", params: [CONTRACT, "latest"] }),
    readClient.request({ method: "eth_getBalance", params: [requester.address, "latest"] }),
    readClient.request({ method: "eth_getBalance", params: [worker.address, "latest"] }),
  ]);
  return {
    task: JSON.parse(json(task)),
    balances: {
      contractWei: BigInt(contractBalance).toString(),
      requesterWei: BigInt(requesterBalance).toString(),
      workerWei: BigInt(workerBalance).toString(),
    },
  };
}

if (stage === "fund") {
  await Promise.all([fund(requester.address), fund(worker.address)]);
  console.log(`requester=${requester.address}`);
  console.log(`worker=${worker.address}`);
} else if (stage === "register") {
  await Promise.all([fund(requester.address), fund(worker.address)]);
  const before = await readTaskAndBalances().catch(() => ({ task: null, balances: null }));
  const { hash, receipt } = await writeContract(requesterClient, "register_task", [TASK_ID, worker.address, REPOSITORY, TITLE, JSON.stringify(CHECKLIST), CONFIG_SHA256], ESCROW_WEI);
  await save({
    network: "studioNext",
    chainId: 61997,
    taskId: TASK_ID,
    contractAddress: CONTRACT,
    registrationTxId: hash,
    registrationExecutionResult: receipt.txExecutionResultName,
    requester: requester.address.toLowerCase(),
    worker: worker.address.toLowerCase(),
    repositoryUrl: REPOSITORY,
    pullRequestUrl: MANIFEST.pr_url,
    actionsRunUrl: MANIFEST.actions_run_url,
    evidenceHeadSha: HEAD_SHA,
    configSha256: CONFIG_SHA256,
    escrowWei: ESCROW_WEI.toString(),
    balancesBeforeRegistration: before.balances,
    status: "OPEN",
    pilotType: "founder-operated acceptance proof",
  });
} else if (stage === "submit") {
  const { hash, receipt } = await writeContract(workerClient, "submit_delivery", [TASK_ID, JSON.stringify(MANIFEST)]);
  await save({ deliveryTxId: hash, deliveryExecutionResult: receipt.txExecutionResultName, manifest: MANIFEST, status: "SUBMITTED" });
} else if (stage === "accept") {
  const balancesBeforeAcceptance = (await readTaskAndBalances()).balances;
  const { hash, receipt } = await writeContract(requesterClient, "accept_delivery", [TASK_ID]);
  const { task, balances } = await readTaskAndBalances();
  const lifecycle = await readClient.advanced.getTransactionLifecycle({ hash });
  const triggeredTransactionIds = (await readClient.getTriggeredTransactionIds({ hash })) || [];
  if (task.status !== "RESOLVED") throw new Error(`Expected RESOLVED, received ${task.status}`);
  if (Number(task.passed_bps) !== 10_000) throw new Error(`Expected 10000 passed_bps, received ${task.passed_bps}`);
  if (BigInt(task.worker_amount) !== ESCROW_WEI) throw new Error(`Expected full worker payout, received ${task.worker_amount}`);
  if (BigInt(task.requester_amount) !== 0n) throw new Error(`Expected zero requester refund, received ${task.requester_amount}`);
  if (BigInt(balances.contractWei) !== 0n) throw new Error(`Expected zero contract balance, received ${balances.contractWei}`);
  console.log(`task-after-acceptance=${json(task)}`);
  console.log(`balances-after-acceptance=${json(balances)}`);
  console.log(`triggered-transactions=${json(triggeredTransactionIds)}`);
  await save({
    acceptanceTxId: hash,
    acceptanceExecutionResult: receipt.txExecutionResultName,
    lifecycle,
    triggeredTransactionIds,
    task,
    status: task.status,
    passedBps: Number(task.passed_bps),
    workerAmountWei: String(task.worker_amount),
    requesterAmountWei: String(task.requester_amount),
    balancesBeforeAcceptance,
    balancesAfterSettlement: balances,
    contractBalanceAfterSettlementWei: balances.contractWei,
    payoutVerification: "Requester acceptance finalized with FINISHED_WITH_RETURN; resolved state assigns the full 1 GEN escrow to the worker; contract balance is zero.",
  });
} else if (stage === "inspect") {
  const result = await readTaskAndBalances();
  console.log(`task=${json(result.task)}`);
  console.log(`balances=${json(result.balances)}`);
} else {
  throw new Error("Use one of: fund, register, submit, accept, inspect");
}
