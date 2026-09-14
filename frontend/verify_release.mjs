import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createClient } from "genlayer-js";
import { studioNext } from "./studio-next.mjs";

const manifest = JSON.parse(await readFile(new URL("./public/release-manifest.json", import.meta.url), "utf8"));
const client = createClient({ chain: studioNext });
const [count, schema, code, activation] = await Promise.all([
  client.readContract({
    address: manifest.contractAddress,
    functionName: "get_task_count",
    args: [],
    transactionHashVariant: "latest-final",
  }),
  client.getContractSchema(manifest.contractAddress),
  client.getContractCode(manifest.contractAddress),
  client.getTransaction({ hash: manifest.deploymentTxId }),
]);

const actualHash = createHash("sha256").update(String(code)).digest("hex");
const expectedHash = manifest.sourceSha256.toLowerCase();
if (actualHash !== expectedHash) throw new Error(`source hash mismatch: ${actualHash}`);
if (String(activation?.statusName || "").toUpperCase() !== "FINALIZED") throw new Error("activation is not finalized");
if (activation?.txExecutionResultName !== "FINISHED_WITH_RETURN") throw new Error("activation execution failed");

console.log(JSON.stringify({
  address: manifest.contractAddress,
  sourceSha256: actualHash,
  methods: Object.keys(schema?.methods || {}).length,
  taskCount: String(count),
  activationTxId: manifest.deploymentTxId,
  activationStatus: activation.statusName,
  executionResult: activation.txExecutionResultName,
}, null, 2));
