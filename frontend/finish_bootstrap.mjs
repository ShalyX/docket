import { createHash } from "node:crypto";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const address = process.argv[2];
const expectedSha256 = process.argv[3]?.toLowerCase();
if (!/^0x[0-9a-fA-F]{40}$/.test(address || "") || !/^[0-9a-f]{64}$/.test(expectedSha256 || "")) {
  throw new Error("Usage: node finish_bootstrap.mjs 0x<contract-address> <expected-source-sha256>");
}

const account = createAccount();
const client = createClient({ chain: studioNext, account });
await client.request({ method: "sim_fundAccount", params: [account.address, "1000000000000000000000"] });

const request = { address, functionName: "finish", args: [], value: 0n };
const recommended = await client.estimateTransactionFeesForWrite(request);
const hash = await client.writeContract({
  ...request,
  fees: {
    distribution: recommended.distribution,
    messageAllocations: recommended.messageAllocations,
    feeValue: recommended.feeValue,
  },
});
console.log(`finish: ${hash}`);

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 2_000,
  retries: 300,
});
if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
  throw new Error(`finish finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
}

const codeResult = await client.request({ method: "gen_getContractCode", params: [address] });
const encodedCode = typeof codeResult === "string" ? codeResult : codeResult?.code;
if (typeof encodedCode !== "string") throw new Error("gen_getContractCode returned no source");
const code = encodedCode.startsWith("0x")
  ? Buffer.from(encodedCode.slice(2), "hex")
  : Buffer.from(encodedCode, "base64");
const actualSha256 = createHash("sha256").update(code).digest("hex");
if (actualSha256 !== expectedSha256) {
  throw new Error(`Live source hash mismatch: expected ${expectedSha256}, got ${actualSha256}`);
}

const schema = await client.request({ method: "gen_getContractSchema", params: [address] });
const taskCount = await client.readContract({
  address,
  functionName: "get_task_count",
  args: [],
  stateStatus: "finalized",
});

console.log(`source-bytes: ${code.length}`);
console.log(`source-sha256: ${actualSha256}`);
console.log(`schema-methods: ${Object.keys(schema?.methods || {}).length}`);
console.log(`get_task_count: ${taskCount}`);
