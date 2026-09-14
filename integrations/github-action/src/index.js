"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_REPOSITORY_URL_LENGTH = 180;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

class DocketEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocketEvidenceError";
  }
}

function fail(message) {
  throw new DocketEvidenceError(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalConfigForHash(value) {
  return `${String(value).replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${name} is required.`);
  }
  return value.trim();
}

function optional(env, name) {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function actionInput(env, name) {
  return optional(env, `INPUT_${name.toUpperCase().replace(/-/g, "_")}`);
}

function isGitHubOwner(value) {
  if (value.length < 1 || value.length > 39 || value[0] === "-" || value[value.length - 1] === "-") {
    return false;
  }
  return /^[a-z0-9-]+$/.test(value);
}

function isGitHubRepository(value) {
  if (value.length < 1 || value.length > 100 || value[0] === "." || value[value.length - 1] === ".") {
    return false;
  }
  return /^[a-z0-9._-]+$/.test(value);
}

function validateCanonicalRepositorySlug(value, source) {
  const parts = value.split("/");
  if (parts.length !== 2 || !isGitHubOwner(parts[0]) || !isGitHubRepository(parts[1])) {
    fail(`${source} must be a lowercase GitHub owner/repository slug.`);
  }
  return value;
}

function validateRepositoryContext(repository) {
  if (typeof repository !== "string" || repository.trim() !== repository || repository.length === 0) {
    fail("GITHUB_REPOSITORY must be an owner/repository GitHub slug.");
  }
  return validateCanonicalRepositorySlug(repository.toLowerCase(), "GITHUB_REPOSITORY");
}

function validateCanonicalRepositoryUrl(repositoryUrl) {
  const prefix = "https://github.com/";
  if (
    typeof repositoryUrl !== "string" ||
    repositoryUrl.trim() !== repositoryUrl ||
    repositoryUrl.length > MAX_REPOSITORY_URL_LENGTH ||
    !repositoryUrl.startsWith(prefix)
  ) {
    fail("docket.yml repository_url must be a canonical lowercase https://github.com/owner/repo URL.");
  }

  const slug = repositoryUrl.slice(prefix.length);
  validateCanonicalRepositorySlug(slug, "docket.yml repository_url");
  if (repositoryUrl !== `${prefix}${slug}`) {
    fail("docket.yml repository_url must be canonical and lowercase.");
  }
  return { url: repositoryUrl, slug };
}

function validateTaskId(taskId, source) {
  if (
    typeof taskId !== "string" ||
    taskId.length < 12 ||
    taskId.length > 64 ||
    !taskId.startsWith("dkt-") ||
    taskId[taskId.length - 1] === "-" ||
    taskId.includes("--")
  ) {
    fail(`${source} must be a dkt- identifier between 12 and 64 characters.`);
  }

  let previousHyphen = false;
  for (const character of taskId.slice(4)) {
    if (!/[a-z0-9-]/.test(character) || (character === "-" && previousHyphen)) {
      fail(`${source} may contain lowercase letters, digits, and single hyphens only.`);
    }
    previousHyphen = character === "-";
  }
  return taskId;
}

function validateSha(sha) {
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    fail("pull_request.head.sha must be a lowercase 40-character Git SHA.");
  }
  return sha;
}

function validatePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    fail(`${label} must be a positive integer.`);
  }
  return String(value);
}

function validatePublicGitHubServer(serverUrl) {
  let url;
  try {
    url = new URL(serverUrl);
  } catch {
    fail("GITHUB_SERVER_URL must be a URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    fail("Docket GitHub evidence supports public https://github.com repositories only.");
  }
}

function validatePublicGithubUrl(value, expectedPath, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.toLowerCase() !== expectedPath
  ) {
    fail(`${label} must be the expected public github.com URL.`);
  }
}

function loadEvent(eventPath) {
  let raw;
  try {
    raw = fs.readFileSync(eventPath, "utf8");
  } catch {
    fail("GITHUB_EVENT_PATH could not be read.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail("GITHUB_EVENT_PATH does not contain valid JSON.");
  }
}

function resolveConfigPath(configPath, workspace) {
  if (!configPath || path.isAbsolute(configPath)) {
    fail("config-path must be a repository-relative file path.");
  }

  const root = path.resolve(workspace);
  const resolved = path.resolve(root, configPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("config-path must stay inside GITHUB_WORKSPACE.");
  }
  return { resolved, relative: relative.split(path.sep).join("/") };
}

function readYamlScalar(contents, key) {
  const match = contents.match(new RegExp(`^${key}\\s*:\\s*(?:"([^"]+)"|'([^']+)'|([^\\s#]+))\\s*(?:#.*)?$`, "m"));
  if (!match) {
    fail(`docket.yml must declare a top-level ${key}.`);
  }
  return match[1] || match[2] || match[3];
}

function readConfig(configPath, workspace) {
  const location = resolveConfigPath(configPath, workspace);
  if (location.relative !== "docket.yml") {
    fail("Docket evidence must use the repository-root docket.yml.");
  }
  let contents;
  try {
    const stats = fs.statSync(location.resolved);
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_CONFIG_BYTES) {
      fail("docket.yml must be a non-empty file smaller than 64 KB.");
    }
    contents = fs.readFileSync(location.resolved, "utf8");
  } catch (error) {
    if (error instanceof DocketEvidenceError) {
      throw error;
    }
    fail("config-path could not be read.");
  }

  if (readYamlScalar(contents, "version") !== "2") {
    fail("docket.yml version must be 2.");
  }
  const taskId = validateTaskId(readYamlScalar(contents, "task_id"), "docket.yml task_id");
  const repository = validateCanonicalRepositoryUrl(readYamlScalar(contents, "repository_url"));
  const workerAddress = readYamlScalar(contents, "worker_address");
  if (!/^0x[0-9a-f]{40}$/.test(workerAddress) || /^0x0{40}$/.test(workerAddress)) {
    fail("docket.yml worker_address must be a non-zero lowercase 20-byte address.");
  }
  validatePositiveInteger(readYamlScalar(contents, "escrow_wei"), "docket.yml escrow_wei");
  return {
    path: location.relative,
    taskId,
    repositoryUrl: repository.url,
    repositorySlug: repository.slug,
    sha256: sha256(canonicalConfigForHash(contents)),
  };
}

function readPullRequest(event, repositoryUrl) {
  if (!event || typeof event !== "object" || !event.pull_request || typeof event.pull_request !== "object") {
    fail("The event payload must be a pull_request event.");
  }
  if (!event.repository || event.repository.private !== false) {
    fail("The event payload must identify the repository as public.");
  }

  const number = validatePositiveInteger(event.number, "pull_request number");
  const headSha = validateSha(event.pull_request.head && event.pull_request.head.sha);
  const expectedPath = `${new URL(repositoryUrl).pathname}/pull/${number}`;
  if (typeof event.pull_request.html_url !== "string") {
    fail("pull_request.html_url is required.");
  }
  validatePublicGithubUrl(event.pull_request.html_url, expectedPath, "pull_request.html_url");
  return {
    number,
    url: `${repositoryUrl}/pull/${number}`,
    headSha,
  };
}

function deriveManifest(env = process.env, now = () => new Date()) {
  if (required(env, "GITHUB_EVENT_NAME") !== "pull_request") {
    fail("Docket GitHub evidence must run from a pull_request workflow.");
  }

  validatePublicGitHubServer(required(env, "GITHUB_SERVER_URL"));
  const repository = validateRepositoryContext(required(env, "GITHUB_REPOSITORY"));
  const event = loadEvent(required(env, "GITHUB_EVENT_PATH"));
  if (
    event.repository &&
    event.repository.full_name &&
    String(event.repository.full_name).toLowerCase() !== repository
  ) {
    fail("GITHUB_REPOSITORY does not match repository.full_name in the event payload.");
  }

  const runId = validatePositiveInteger(required(env, "GITHUB_RUN_ID"), "GITHUB_RUN_ID");
  const runAttempt = validatePositiveInteger(optional(env, "GITHUB_RUN_ATTEMPT") || "1", "GITHUB_RUN_ATTEMPT");
  const workspace = optional(env, "GITHUB_WORKSPACE") || process.cwd();
  const config = readConfig(actionInput(env, "config-path") || "docket.yml", workspace);
  if (config.repositorySlug !== repository) {
    fail("docket.yml repository_url must match GITHUB_REPOSITORY after canonical lowercase normalization.");
  }

  const inputTaskId = actionInput(env, "task-id");
  if (inputTaskId) {
    validateTaskId(inputTaskId, "task-id input");
    if (inputTaskId !== config.taskId) {
      fail("task-id input must match docket.yml task_id.");
    }
  }

  const pullRequest = readPullRequest(event, config.repositoryUrl);
  const manifest = {
    pr_url: pullRequest.url,
    head_sha: pullRequest.headSha,
    actions_run_url: `${config.repositoryUrl}/actions/runs/${runId}`,
  };
  const manifestJson = JSON.stringify(manifest);
  const manifestSha256 = sha256(manifestJson);
  const proof = {
    schema_version: "docket.github-evidence-proof.v1",
    generated_at: now().toISOString(),
    task_id: config.taskId,
    repository_url: config.repositoryUrl,
    manifest_sha256: manifestSha256,
    config: {
      path: config.path,
      sha256: config.sha256,
    },
    workflow_run: {
      id: runId,
      attempt: Number(runAttempt),
    },
  };
  const proofJson = JSON.stringify(proof);

  return {
    manifest,
    manifestJson,
    manifestSha256,
    proof,
    proofJson,
    proofSha256: sha256(proofJson),
    configSha256: config.sha256,
  };
}

function writeOutput(env, name, value) {
  const outputPath = required(env, "GITHUB_OUTPUT");
  const delimiter = `docket_${crypto.randomUUID().replace(/-/g, "")}`;
  fs.appendFileSync(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
}

function run(env = process.env, now = () => new Date()) {
  const result = deriveManifest(env, now);
  writeOutput(env, "manifest", result.manifestJson);
  writeOutput(env, "manifest-sha256", result.manifestSha256);
  writeOutput(env, "proof", result.proofJson);
  writeOutput(env, "proof-sha256", result.proofSha256);
  writeOutput(env, "config-sha256", result.configSha256);
  writeOutput(env, "pull-request-url", result.manifest.pr_url);
  writeOutput(env, "actions-run-url", result.manifest.actions_run_url);
  writeOutput(env, "head-sha", result.manifest.head_sha);
  console.log(`Docket evidence generated for ${result.proof.task_id} at ${result.manifest.pr_url}`);
  return result;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`Docket evidence action failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DocketEvidenceError,
  canonicalConfigForHash,
  deriveManifest,
  run,
  validateCanonicalRepositoryUrl,
  validatePublicGithubUrl,
  validateTaskId,
};
