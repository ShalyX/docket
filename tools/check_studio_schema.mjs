import { readFile } from "node:fs/promises";


const endpoint = "https://studio-next.genlayer.com/api";
const paths = process.argv.slice(2);
const useTestRunner = process.env.DOCKET_USE_TEST_RUNNER === "1";

for (const path of paths) {
  let code = await readFile(path, "utf8");
  if (useTestRunner) {
    code = code.replace(/py-genlayer:[^" ]+/, "py-genlayer:test");
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: path,
    method: "gen_getContractSchemaForCode",
    params: [`0x${Buffer.from(code).toString("hex")}`],
  });

  let result;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const data = await response.json();
      result = data.error
        ? { path, ok: false, rpcCode: data.error.code, message: String(data.error.message).slice(0, 5000) }
        : { path, ok: true, schema: data.result };
      break;
    } catch (error) {
      result = { path, ok: false, networkError: String(error) };
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
