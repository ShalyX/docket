import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const address = process.argv[2];
const startIndex = Number(process.argv[3] || "1");
if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) {
  throw new Error("Usage: node upload_bootstrap_chunks.mjs 0x<contract-address> [start-index]");
}
if (!Number.isInteger(startIndex) || startIndex < 1 || startIndex > 8) throw new Error("start-index must be 1..8");

const account = createAccount();
const client = createClient({ chain: studioNext, account });
const root = resolve(import.meta.dirname, "..");
const hashes = [];

console.log(`Uploader account: ${account.address}`);
console.log(`Target: ${address}`);

await client.request({
  method: "sim_fundAccount",
  params: [account.address, "1000000000000000000000"],
});
console.log("Funded the temporary Studio Next uploader account.");

for (let index = startIndex; index <= 8; index += 1) {
  const name = `chunk-${String(index).padStart(2, "0")}.txt`;
  const encoded = (await readFile(resolve(root, "deploy", "bootstrap", name), "utf8")).trim();
  if (!encoded.startsWith("b#") || !/^[0-9a-f]+$/.test(encoded.slice(2))) {
    throw new Error(`${name} is not a canonical b# hex chunk`);
  }
  const bytes = Uint8Array.from(Buffer.from(encoded.slice(2), "hex"));
  console.log(`Submitting ${name} (${bytes.length} bytes)...`);
  const request = {
    address,
    functionName: "push_code",
    args: [bytes],
    value: 0n,
  };
  const recommended = await client.estimateTransactionFeesForWrite(request);
  const hash = await client.writeContract({
    ...request,
    fees: {
      distribution: recommended.distribution,
      messageAllocations: recommended.messageAllocations,
      feeValue: recommended.feeValue,
    },
  });
  console.log(`${name}: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 2_000,
    retries: 300,
  });
  if (receipt?.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`${name} finalized with ${receipt?.txExecutionResultName || "unknown result"}`);
  }
  hashes.push({ chunk: name, bytes: bytes.length, hash });
}

await writeFile(
  resolve(root, "deploy", "bootstrap", "upload-transactions.json"),
  `${JSON.stringify({ address, uploader: account.address, hashes }, null, 2)}\n`,
);
console.log(`Chunks ${startIndex} through 8 finalized. finish() has not been called.`);
