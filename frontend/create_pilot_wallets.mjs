import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, generatePrivateKey } from "genlayer-js";

const output = resolve(import.meta.dirname, "..", "deploy", "pilot-wallets.local.json");
let existing;
try {
  existing = JSON.parse(await readFile(output, "utf8"));
} catch {
  existing = null;
}

const requesterPrivateKey = existing?.requesterPrivateKey || generatePrivateKey();
const workerPrivateKey = existing?.workerPrivateKey || generatePrivateKey();
const requester = createAccount(requesterPrivateKey);
const worker = createAccount(workerPrivateKey);

await writeFile(output, `${JSON.stringify({
  network: "studioNext",
  requesterAddress: requester.address,
  requesterPrivateKey,
  workerAddress: worker.address,
  workerPrivateKey,
}, null, 2)}\n`);

console.log(JSON.stringify({ requester: requester.address, worker: worker.address, storedAt: output }, null, 2));
