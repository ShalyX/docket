import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const CONTRACT = "0x729C8B0451Cc42Cc4abdF9b5ba468ce14eF79057";
const TASK_ID = "dkt-8eaed55e224940e4ae9edbe1";
const MANIFEST = {
  pr_url: "https://github.com/shalyx/touchline-relay/pull/1",
  head_sha: "cb0d0c7c95884245e2c122f9433821b7e18aa654",
  actions_run_url: "https://github.com/shalyx/touchline-relay/actions/runs/34676277187",
};

const walletPath = resolve("..", "deploy", "pilot-wallets.local.json");
const wallets = JSON.parse(await readFile(walletPath, "utf8"));
if (!/^0x[0-9a-fA-F]{64}$/.test(wallets.workerPrivateKey || "")) {
  throw new Error("Missing worker private key in deploy/pilot-wallets.local.json");
}

const account = createAccount(wallets.workerPrivateKey);
const client = createClient({ chain: studioNext, account });
await client.request({
  method: "sim_fundAccount",
  params: [account.address, "1000000000000000000000"],
});

const request = {
  address: CONTRACT,
  functionName: "submit_delivery",
  args: [TASK_ID, JSON.stringify(MANIFEST)],
  value: 0n,
};
const recommended = await client.estimateTransactionFeesForWrite(request);
console.log("estimate: passed");
console.log(`worker: ${account.address}`);
console.log(`manifest: ${JSON.stringify(MANIFEST)}`);
if (process.argv.includes("--estimate-only")) process.exit(0);

const hash = await client.writeContract({
  ...request,
  fees: {
    distribution: recommended.distribution,
    messageAllocations: recommended.messageAllocations,
    feeValue: recommended.feeValue,
  },
});
console.log(`delivery-transaction: ${hash}`);

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 2_000,
  retries: 600,
});
console.log(`execution-result: ${receipt?.txExecutionResultName || "unknown"}`);
if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
  throw new Error(`Delivery finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
}

const task = await client.readContract({
  address: CONTRACT,
  functionName: "get_task",
  args: [TASK_ID],
  stateStatus: "finalized",
});
console.log(`task: ${JSON.stringify(task, (_, value) => typeof value === "bigint" ? value.toString() : value)}`);
