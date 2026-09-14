import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const CONTRACT = "0xa6f640F8bb879c9336F9D5A0a8fBdD4f810Af7B3";
const TASK_ID = "dkt-dispute-7030-20260912";
const REPOSITORY = "https://github.com/shalyx/touchline-relay";
const TITLE = "Document a Docket disputed settlement pilot";
const CONFIG_SHA256 = "424a5e30708c3b0888e7a909d62284dcff2a6d7b74df7bd88207d4eece76bea4";
const ESCROW_WEI = 1_000_000_000_000_000_000n;
const CHECKLIST = [
  {
    id: "document-dispute-pilot",
    weight_bps: 4000,
    description:
      'Add docs/docket-dispute-pilot.md with a section titled "Observed behavior" that explains the purpose of this disputed-settlement pilot.',
  },
  {
    id: "actions-run-succeeds",
    weight_bps: 3000,
    description:
      "The submitted pull request has a successful GitHub Actions pull_request workflow run linked to its exact head commit.",
  },
  {
    id: "add-machine-receipt",
    weight_bps: 3000,
    description:
      "Add docs/docket-dispute-pilot.json containing a JSON object with task_id, expected_passed_bps, and expected_worker_amount_wei fields.",
  },
];
const MANIFEST = {
  pr_url: "https://github.com/shalyx/touchline-relay/pull/2",
  head_sha: "cd7910038cd582f82d54831b1aa371cd7a59f6e6",
  actions_run_url: "https://github.com/shalyx/touchline-relay/actions/runs/34691465908",
};
const DISPUTE_REASON =
  "The delivery omits the required docs/docket-dispute-pilot.json machine-readable receipt. Evaluate each weighted criterion independently from the public pull request and linked Actions run.";

const wallets = JSON.parse(
  await readFile(resolve("..", "deploy", "dispute-pilot-wallets.local.json"), "utf8"),
);
for (const field of ["requesterPrivateKey", "workerPrivateKey"]) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(wallets[field] || "")) {
    throw new Error(`Missing ${field} in the ignored dispute-pilot wallet file`);
  }
}

const requester = createAccount(wallets.requesterPrivateKey);
const worker = createAccount(wallets.workerPrivateKey);
if (requester.address.toLowerCase() !== wallets.requesterAddress.toLowerCase()) {
  throw new Error("Requester signer does not match its recorded address");
}
if (worker.address.toLowerCase() !== wallets.workerAddress.toLowerCase()) {
  throw new Error("Worker signer does not match its recorded address");
}

const requesterClient = createClient({ chain: studioNext, account: requester });
const workerClient = createClient({ chain: studioNext, account: worker });
const readClient = createClient({ chain: studioNext });
const stage = process.argv[2] || "inspect";

const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));

async function fund(client, address) {
  await client.request({
    method: "sim_fundAccount",
    params: [address, "1000000000000000000000"],
  });
}

async function write(client, functionName, args, value = 0n) {
  const request = { address: CONTRACT, functionName, args, value };
  const recommended = await client.estimateTransactionFeesForWrite(request);
  console.log(`${functionName}-estimate=passed`);
  const hash = await client.writeContract({
    ...request,
    fees: {
      distribution: recommended.distribution,
      messageAllocations: recommended.messageAllocations,
      feeValue: recommended.feeValue,
    },
  });
  console.log(`${functionName}-transaction=${hash}`);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 2_000,
    retries: 900,
  });
  console.log(`${functionName}-status=${receipt?.statusName || receipt?.status || "FINALIZED"}`);
  console.log(`${functionName}-execution=${receipt?.txExecutionResultName || "unknown"}`);
  if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`${functionName} finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
  }
  return hash;
}

async function inspect() {
  const task = await readClient.readContract({
    address: CONTRACT,
    functionName: "get_task",
    args: [TASK_ID],
    stateStatus: "finalized",
  });
  const [contractBalance, requesterBalance, workerBalance] = await Promise.all([
    readClient.request({ method: "eth_getBalance", params: [CONTRACT, "latest"] }),
    readClient.request({ method: "eth_getBalance", params: [requester.address, "latest"] }),
    readClient.request({ method: "eth_getBalance", params: [worker.address, "latest"] }),
  ]);
  console.log(`task=${json(task)}`);
  console.log(`contract-balance-wei=${BigInt(contractBalance)}`);
  console.log(`requester-balance-wei=${BigInt(requesterBalance)}`);
  console.log(`worker-balance-wei=${BigInt(workerBalance)}`);
}

if (stage === "fund") {
  await Promise.all([fund(requesterClient, requester.address), fund(workerClient, worker.address)]);
  console.log(`requester=${requester.address}`);
  console.log(`worker=${worker.address}`);
} else if (stage === "register") {
  await write(
    requesterClient,
    "register_task",
    [TASK_ID, worker.address, REPOSITORY, TITLE, JSON.stringify(CHECKLIST), CONFIG_SHA256],
    ESCROW_WEI,
  );
  await inspect();
} else if (stage === "submit") {
  await write(workerClient, "submit_delivery", [TASK_ID, JSON.stringify(MANIFEST)]);
  await inspect();
} else if (stage === "dispute") {
  await write(requesterClient, "open_dispute", [TASK_ID, DISPUTE_REASON]);
  await inspect();
} else if (stage === "resolve") {
  const hash = await write(workerClient, "resolve_dispute", [TASK_ID]);
  console.log(`triggered-transactions=${json((await readClient.getTriggeredTransactionIds({ hash })) || [])}`);
  await inspect();
} else if (stage === "inspect") {
  await inspect();
} else {
  throw new Error("Use one of: fund, register, submit, dispute, resolve, inspect");
}
