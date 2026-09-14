import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const CONTRACT = "0x729C8B0451Cc42Cc4abdF9b5ba468ce14eF79057";
const TASK_ID = "dkt-8eaed55e224940e4ae9edbe1";
const wallets = JSON.parse(
  await readFile(resolve("..", "deploy", "pilot-wallets.local.json"), "utf8"),
);
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
  functionName: "accept_delivery",
  args: [TASK_ID],
  value: 0n,
};
const recommended = await client.estimateTransactionFeesForWrite(request);
console.log("estimate: passed");
console.log(`requester: ${account.address}`);

const hash = await client.writeContract({
  ...request,
  fees: {
    distribution: recommended.distribution,
    messageAllocations: recommended.messageAllocations,
    feeValue: recommended.feeValue,
  },
});
console.log(`accept-transaction: ${hash}`);

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 2_000,
  retries: 600,
});
console.log(`execution-result: ${receipt?.txExecutionResultName || "unknown"}`);
if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
  throw new Error(`Acceptance finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
}

const children = await client.getTriggeredTransactionIds({ hash });
console.log(`payout-transactions: ${JSON.stringify(children || [])}`);
for (const childHash of children || []) {
  const child = await client.waitForTransactionReceipt({
    hash: childHash,
    status: TransactionStatus.FINALIZED,
    interval: 2_000,
    retries: 600,
  });
  console.log(`payout ${childHash}: ${child?.txExecutionResultName || "unknown"}`);
  if (child?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`Payout ${childHash} finalized with ${child?.txExecutionResultName || "unknown result"}`);
  }
}

const task = await client.readContract({
  address: CONTRACT,
  functionName: "get_task",
  args: [TASK_ID],
  stateStatus: "finalized",
});
console.log(`task: ${JSON.stringify(task, (_, value) => typeof value === "bigint" ? value.toString() : value)}`);
