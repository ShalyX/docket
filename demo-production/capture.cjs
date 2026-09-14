const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("C:\\Users\\USER\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright-core");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:4173";
const OUT = path.join(__dirname, "captures");
const cases = {
  dispute: `${BASE}/?task=dkt-dispute-7030-20260912&tx=0x3cd794de1dfc07dfe5c4a547845f3cd1cadfa6bb269a8b5f84dffed8d2b76eec#open`,
  acceptance: `${BASE}/?task=dkt-accept-drill-20260913&tx=0x98e211e696a044263fc8d98312220cd771083ce7e1f91aef4a83f036a1a21ca1#open`,
  appeal: `${BASE}/?task=dkt-appeal-drill-20260912&tx=0xe0f917eef533237f02c64edfacb7800182b431ff2f29ba811979ebc23003ef5b#open`,
};

async function main() {
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

async function open(url, expectedText) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByText(expectedText, { exact: true }).waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForTimeout(750);
}

async function shot(name, selector) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 20_000 });
  await locator.screenshot({ path: path.join(OUT, `${name}.png`) });
}

await open(cases.dispute, "AI-adjudicated result");
await page.getByText("Execution verified", { exact: true }).waitFor({ state: "visible", timeout: 45_000 });
await shot("dispute-resolution", ".resolution-hero");
await shot("dispute-overview", ".case-overview");
await shot("dispute-review", ".requester-review-room");
await shot("dispute-consensus", ".adjudication-launchpad");

await open(cases.acceptance, "Requester-authorized result");
await page.getByText("Execution verified", { exact: true }).waitFor({ state: "visible", timeout: 45_000 });
await shot("acceptance-resolution", ".resolution-hero");

await open(cases.appeal, "AI adjudication launchpad");
await shot("appeal-consensus", ".adjudication-launchpad");

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.getByText("Manifest-pinned code verified", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
await shot("verified-release", "#config");

await browser.close();
console.log(OUT);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
