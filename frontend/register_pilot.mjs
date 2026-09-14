import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const CONTRACT = "0x729C8B0451Cc42Cc4abdF9b5ba468ce14eF79057";
const TASK_ID = "dkt-8eaed55e224940e4ae9edbe1";
const WORKER = "0x9D6d1f18502e424bbBBDAB7e1826682Bc5c0E994";
const REPOSITORY = "https://github.com/shalyx/touchline-relay";
const TITLE = "Add a Docket evidence workflow to Touchline Relay";
const CONFIG_SHA256 = "9f6cf50c27b4f49f27480965c68e86009da7937f4c1bbcb0e7a80467091cfae2";
const ESCROW_WEI = 1_000_000_000_000_000_000n;
const CHECKLIST = [
  {
    id: "add-a-docket-evidence-work",
    weight_bps: 4000,
    description: "Add a Docket evidence workflow under .github/workflows and show a successful run for the submitted pull request.",
  },
  {
    id: "document-in-the-readme-how",
    weight_bps: 3000,
    description: "Document in the README how contributors generate and submit a Docket evidence manifest for paid changes.",
  },
  {
    id: "all-automated-tests-pass-i",
    weight_bps: 3000,
    description: "All automated tests pass in the GitHub Actions run submitted as delivery evidence.",
  },
];

const walletPath = resolve("..", "deploy", "pilot-wallets.local.json");
const wallets = JSON.parse(await readFile(walletPath, "utf8"));
if (!/^0x[0-9a-fA-F]{64}$/.test(wallets.requesterPrivateKey || "")) {
  throw new Error("Missing requester private key in deploy/pilot-wallets.local.json");
}

const account = createAccount(wallets.requesterPrivateKey);
const client = createClient({ chain: studioNext, account });

await client.request({
  method: "sim_fundAccount",
  params: [account.address, "1000000000000000000000"],
});

const request = {
  address: CONTRACT,
  functionName: "register_task",
  args: [TASK_ID, WORKER, REPOSITORY, TITLE, JSON.stringify(CHECKLIST), CONFIG_SHA256],
  value: ESCROW_WEI,
};
const recommended = await client.estimateTransactionFeesForWrite(request);
console.log(`estimate: passed`);
if (process.argv.includes("--estimate-only")) {
  console.log(`requester: ${account.address}`);
  console.log(`task-id: ${TASK_ID}`);
  process.exit(0);
}
const hash = await client.writeContract({
  ...request,
  fees: {
    distribution: recommended.distribution,
    messageAllocations: recommended.messageAllocations,
    feeValue: recommended.feeValue,
  },
});

console.log(`requester: ${account.address}`);
console.log(`worker: ${WORKER}`);
console.log(`task-id: ${TASK_ID}`);
console.log(`register-transaction: ${hash}`);

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 2_000,
  retries: 600,
});
console.log(`status: ${receipt?.statusName || receipt?.status || "FINALIZED"}`);
console.log(`execution-result: ${receipt?.txExecutionResultName || "unknown"}`);
if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
  throw new Error(`Registration finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
}

const taskCount = await client.readContract({
  address: CONTRACT,
  functionName: "get_task_count",
  args: [],
  stateStatus: "finalized",
});
const task = await client.readContract({
  address: CONTRACT,
  functionName: "get_task",
  args: [TASK_ID],
  stateStatus: "finalized",
});
console.log(`task-count: ${taskCount}`);
console.log(`task: ${JSON.stringify(task, (_, value) => typeof value === "bigint" ? value.toString() : value)}`);
