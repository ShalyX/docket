"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DocketEvidenceError, canonicalConfigForHash, deriveManifest, run } = require("../src/index.js");

const FIXED_NOW = () => new Date("2026-09-09T12:00:00.000Z");

function fixture({ privateRepository = false } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "docket-github-action-"));
  const repository = "docket-demo/public-repo";
  const event = {
    number: 42,
    repository: {
      full_name: repository,
      private: privateRepository,
    },
    pull_request: {
      html_url: "https://github.com/docket-demo/public-repo/pull/42",
      head: { sha: "0123456789abcdef0123456789abcdef01234567" },
    },
  };
  const eventPath = path.join(workspace, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify(event), "utf8");
  fs.writeFileSync(
    path.join(workspace, "docket.yml"),
    [
      "# Public Docket agreement configuration. Keep this file unchanged after registration.",
      "version: 2",
      "task_id: dkt-github-pr-42",
      "repository_url: https://github.com/docket-demo/public-repo",
      "worker_address: 0x1234567890abcdef1234567890abcdef12345678",
      "title: \"Public delivery evidence\"",
      "escrow_wei: \"10000\"",
      "",
      "criteria:",
      "  - id: evidence",
      "    weight_bps: 10000",
      "    description: \"Public PR evidence supports the agreed delivery.\"",
      "",
      "github:",
      "  provider: github",
      "  public_only: true",
      "  config_path: docket.yml",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    workspace,
    env: {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: repository,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_RUN_ID: "123456",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_WORKSPACE: workspace,
      INPUT_CONFIG_PATH: "docket.yml",
      INPUT_TASK_ID: "dkt-github-pr-42",
    },
  };
}

test("derives a compact manifest from a public pull-request context", () => {
  const { env } = fixture();
  const result = deriveManifest(env, FIXED_NOW);

  assert.deepEqual(result.manifest, {
    pr_url: "https://github.com/docket-demo/public-repo/pull/42",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    actions_run_url: "https://github.com/docket-demo/public-repo/actions/runs/123456",
  });
  assert.deepEqual(Object.keys(JSON.parse(result.manifestJson)), ["pr_url", "head_sha", "actions_run_url"]);
  assert.equal(result.proof.schema_version, "docket.github-evidence-proof.v1");
  assert.equal(result.proof.generated_at, "2026-09-09T12:00:00.000Z");
  assert.equal(result.proof.task_id, "dkt-github-pr-42");
  assert.equal(result.proof.repository_url, "https://github.com/docket-demo/public-repo");
  assert.equal(result.proof.manifest_sha256, result.manifestSha256);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(result.proofSha256, /^[0-9a-f]{64}$/);
  assert.match(result.configSha256, /^[0-9a-f]{64}$/);
});

test("normalizes line endings and the final newline before hashing the public configuration", () => {
  const { workspace, env } = fixture();
  const original = fs.readFileSync(path.join(workspace, "docket.yml"), "utf8");
  const unix = deriveManifest(env, FIXED_NOW);
  fs.writeFileSync(path.join(workspace, "docket.yml"), original.replace(/\n/g, "\r\n").replace(/\r\n$/, ""), "utf8");
  const windows = deriveManifest(env, FIXED_NOW);

  assert.equal(unix.configSha256, windows.configSha256);
  assert.equal(canonicalConfigForHash(original), canonicalConfigForHash(original.replace(/\n/g, "\r\n").replace(/\r\n$/, "")));
});

test("rejects a configuration larger than the contract's public-file bound", () => {
  const { workspace, env } = fixture();
  fs.writeFileSync(path.join(workspace, "docket.yml"), "x".repeat((64 * 1024) + 1), "utf8");

  assert.throws(() => deriveManifest(env, FIXED_NOW), /smaller than 64 KB/);
});

test("writes action outputs without posting a manifest", () => {
  const { workspace, env } = fixture();
  const outputPath = path.join(workspace, "github-output.txt");
  const result = run({ ...env, GITHUB_OUTPUT: outputPath }, FIXED_NOW);
  const output = fs.readFileSync(outputPath, "utf8");

  assert.match(output, /^manifest<</m);
  assert.match(output, new RegExp(result.manifestSha256));
  assert.match(output, /^proof<</m);
  assert.match(output, /actions-run-url<</);
  assert.doesNotMatch(output, /GITHUB_TOKEN|PRIVATE_KEY|SECRET/i);
});

test("vendor workflow derives config and manifest from the same PR-head checkout", () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, "..", "target-repo-workflow.yml"), "utf8");

  assert.match(workflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /DOCKET_MANIFEST:\s*\$\{\{\s*steps\.docket_evidence\.outputs\.manifest\s*\}\}/);
  assert.match(workflow, /DOCKET_PROOF:\s*\$\{\{\s*steps\.docket_evidence\.outputs\.proof\s*\}\}/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});

test("rejects a private repository event", () => {
  const { env } = fixture({ privateRepository: true });
  assert.throws(() => deriveManifest(env, FIXED_NOW), DocketEvidenceError);
});

test("rejects a pull-request URL outside public github.com", () => {
  const { workspace, env } = fixture();
  const eventPath = path.join(workspace, "event.json");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  event.pull_request.html_url = "https://example.com/docket-demo/public-repo/pull/42";
  fs.writeFileSync(eventPath, JSON.stringify(event), "utf8");

  assert.throws(() => deriveManifest(env, FIXED_NOW), /expected public github.com URL/);
});

test("emits canonical lowercase URLs when GitHub context casing differs", () => {
  const { workspace, env } = fixture();
  const eventPath = path.join(workspace, "event.json");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  event.repository.full_name = "Docket-Demo/Public-Repo";
  event.pull_request.html_url = "https://github.com/Docket-Demo/Public-Repo/pull/42";
  fs.writeFileSync(eventPath, JSON.stringify(event), "utf8");

  const result = deriveManifest({ ...env, GITHUB_REPOSITORY: "Docket-Demo/Public-Repo" }, FIXED_NOW);
  assert.equal(result.manifest.pr_url, "https://github.com/docket-demo/public-repo/pull/42");
  assert.equal(result.manifest.actions_run_url, "https://github.com/docket-demo/public-repo/actions/runs/123456");
});

test("rejects a config repository that does not match the workflow repository", () => {
  const { workspace, env } = fixture();
  fs.writeFileSync(
    path.join(workspace, "docket.yml"),
    "version: 2\ntask_id: dkt-github-pr-42\nrepository_url: https://github.com/another/repository\nworker_address: 0x1234567890abcdef1234567890abcdef12345678\nescrow_wei: \"10000\"\n",
    "utf8",
  );
  assert.throws(() => deriveManifest(env, FIXED_NOW), /must match GITHUB_REPOSITORY/);
});

test("rejects an input task ID that does not match the public config", () => {
  const { env } = fixture();
  assert.throws(
    () => deriveManifest({ ...env, INPUT_TASK_ID: "dkt-another-task" }, FIXED_NOW),
    /must match docket.yml task_id/,
  );
});

test("rejects a task ID that the Docket contract cannot register", () => {
  const { env } = fixture();
  assert.throws(
    () => deriveManifest({ ...env, INPUT_TASK_ID: "github-pr-42" }, FIXED_NOW),
    /dkt- identifier/,
  );
});

test("rejects a legacy or incomplete agreement configuration", () => {
  const { workspace, env } = fixture();
  fs.writeFileSync(
    path.join(workspace, "docket.yml"),
    "version: 1\ntask_id: dkt-github-pr-42\nrepository_url: https://github.com/docket-demo/public-repo\nworker_address: 0x1234567890abcdef1234567890abcdef12345678\nescrow_wei: \"10000\"\n",
    "utf8",
  );
  assert.throws(() => deriveManifest(env, FIXED_NOW), /version must be 2/);
});

test("rejects a nested configuration path even when it is inside the checkout", () => {
  const { workspace, env } = fixture();
  const nested = path.join(workspace, "config");
  fs.mkdirSync(nested);
  fs.copyFileSync(path.join(workspace, "docket.yml"), path.join(nested, "docket.yml"));
  assert.throws(
    () => deriveManifest({ ...env, INPUT_CONFIG_PATH: "config/docket.yml" }, FIXED_NOW),
    /repository-root docket.yml/,
  );
});
