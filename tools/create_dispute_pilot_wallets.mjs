import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAccount, generatePrivateKey } from "../frontend/node_modules/genlayer-js/dist/index.js";

const requesterPrivateKey = generatePrivateKey();
const workerPrivateKey = generatePrivateKey();
const requester = createAccount(requesterPrivateKey);
const worker = createAccount(workerPrivateKey);
const outputPath = resolve("deploy", "dispute-pilot-wallets.local.json");

await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      warning: "Disposable Studio Next accounts. Never fund or reuse on another network.",
      requesterAddress: requester.address,
      requesterPrivateKey,
      workerAddress: worker.address,
      workerPrivateKey,
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", flag: "wx" },
);

console.log(`requester=${requester.address}`);
console.log(`worker=${worker.address}`);
console.log(`wallet_file=${outputPath}`);
