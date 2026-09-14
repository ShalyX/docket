import { createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const parentHash = "0xd97afe11c3e2fc3903a1d1ea47a8fd740cf70f7f117aa875913be0e00d7db316";
const client = createClient({ chain: studioNext });
let children = [];
for (let attempt = 0; attempt < 10 && children.length === 0; attempt += 1) {
  children = (await client.getTriggeredTransactionIds({ hash: parentHash })) || [];
  if (children.length === 0) await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
}
console.log(`payout-transactions: ${JSON.stringify(children)}`);
for (const childHash of children) {
  const receipt = await client.waitForTransactionReceipt({
    hash: childHash,
    status: TransactionStatus.FINALIZED,
    interval: 2_000,
    retries: 300,
  });
  console.log(`payout ${childHash}: ${receipt?.txExecutionResultName || "unknown"}`);
  if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`Payout ${childHash} did not finalize successfully`);
  }
}

const contractBalance = await client.request({
  method: "eth_getBalance",
  params: ["0x729C8B0451Cc42Cc4abdF9b5ba468ce14eF79057", "latest"],
});
const workerBalance = await client.request({
  method: "eth_getBalance",
  params: ["0x9D6d1f18502e424bbBBDAB7e1826682Bc5c0E994", "latest"],
});
console.log(`contract-balance-wei: ${BigInt(contractBalance).toString()}`);
console.log(`worker-balance-wei: ${BigInt(workerBalance).toString()}`);
