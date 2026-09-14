import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const account = createAccount();
const client = createClient({ chain: studioNext, account });
await client.request({ method: "sim_fundAccount", params: [account.address, "1000000000000000000000"] });

const code = await readFile(resolve(import.meta.dirname, "..", "contracts", "docket_bootstrapper.py"), "utf8");
const estimate = await client.estimateTransactionFees({
  leaderTimeunitsAllocation: 600n,
  validatorTimeunitsAllocation: 600n,
});
const hash = await client.deployContract({
  code,
  args: [],
  kwargs: { save_default_locked_slots: true },
  fees: {
    distribution: estimate.distribution,
    messageAllocations: estimate.messageAllocations,
    feeValue: estimate.feeValue,
  },
});
console.log(`deploy: ${hash}`);

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 2_000,
  retries: 300,
  fullTransaction: true,
});
if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
  throw new Error(`deploy finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
}

const tx = await client.getTransaction({ hash });
const candidates = [
  receipt?.contractAddress,
  receipt?.address,
  receipt?.recipient,
  receipt?.to,
  tx?.contractAddress,
  tx?.address,
  tx?.recipient,
  tx?.to,
].filter((value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value));

console.log(`address: ${candidates[0] || "not-found"}`);
if (!candidates[0]) {
  console.log(`receipt-keys: ${Object.keys(receipt || {}).join(",")}`);
  console.log(`tx-keys: ${Object.keys(tx || {}).join(",")}`);
}
