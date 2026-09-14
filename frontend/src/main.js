import "./styles.css";
import { buildStructuredDisputeReason, summarizeReview } from "./review.js";
import { deriveAdjudicationStages } from "./adjudication.js";
import { deriveExceptionItems } from "./exceptions.js";
import { buildCaseReceipt } from "./receipt.js";
import { deriveRecoveryWindow, formatRecoveryCountdown } from "./recovery.js";
import { studioNext } from "../studio-next.mjs";

const APP_VERSION = "v2-github-evidence";
const BASIS_POINTS = 10_000;
const WEI_PER_GEN = 10n ** 18n;
const CONFIG_KEY = "docket:v2:release-config";
const CASES_KEY = "docket:v2:recent-cases";
const TRANSACTIONS_KEY = "docket:v2:transactions";
const PREPARED_DOCKET_KEY = "docket:v2:prepared-docket";
const initialSearchParams = new URLSearchParams(window.location.search);

const NETWORKS = {
  studioNext: {
    id: "studioNext",
    label: "Studio Next",
    chainId: 61997,
    connectName: "studioDevnet",
    explorerBaseUrl: "https://explorer-studio-dev.genlayer.com",
  },
};

let sdkPromise;

async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import("genlayer-js"),
      import("genlayer-js/types"),
      import("@genlayer/transaction-kit"),
    ]).then(([sdk, types, transactionKit]) => ({
      createClient: sdk.createClient,
      createTransactionKit: transactionKit.createTransactionKit,
      TransactionStatus: types.TransactionStatus,
      chains: {
        studioNext,
      },
    }));
  }
  return sdkPromise;
}

const REQUIRED_CONTRACT_METHODS = [
  "register_task",
  "submit_delivery",
  "accept_delivery",
  "open_dispute",
  "escalate_submission",
  "resolve_dispute",
  "supplement_evidence",
  "refund_inconclusive_task",
  "cancel_task",
  "get_task",
  "get_task_count",
];

const SETTLEMENT_LABELS = new Set([
  "Accept delivery",
  "Resolve dispute",
  "Recover inconclusive case",
  "Cancel docket",
]);

const TERMINAL_FAILURE_TRANSACTION_STATUSES = new Set([
  "CANCELED",
  "CANCELLED",
  "FAILED",
  "REJECTED",
  "DROPPED",
  "UNDETERMINED",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
]);

const FINALIZING_TRANSACTION_STATUSES = new Set([
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "ACCEPTED",
  "APPEAL_REVEALING",
  "APPEAL_COMMITTING",
  "READY_TO_FINALIZE",
  // Kept for clients that return legacy status labels.
  "PROCESSING",
  "PROPOSED",
]);

const CONTRACT_METHOD_ARITY = {
  register_task: 6,
  submit_delivery: 2,
  accept_delivery: 1,
  open_dispute: 2,
  escalate_submission: 2,
  resolve_dispute: 1,
  supplement_evidence: 2,
  refund_inconclusive_task: 1,
  cancel_task: 1,
  get_task: 1,
  get_task_count: 0,
};

const DEFAULT_RELEASE = {
  product: "Docket",
  release: APP_VERSION,
  network: import.meta.env.VITE_DOCKET_NETWORK || "studioNext",
  chainId: null,
  contractAddress: import.meta.env.VITE_DOCKET_CONTRACT_ADDRESS || "",
  deploymentTxId: "",
  explorerBaseUrl: "",
  sourceSha256: "",
  status: "awaiting-deployment",
  updatedAt: null,
};

const state = {
  release: { ...DEFAULT_RELEASE },
  config: readStoredConfig(),
  readClient: null,
  walletClient: null,
  transactionKit: null,
  walletAddress: "",
  walletChainId: null,
  contractVerified: false,
  verification: null,
  activeTask: null,
  activeTaskId: initialSearchParams.get("task") || "",
  activeResolutionTxId: isTransactionId(initialSearchParams.get("tx")) ? initialSearchParams.get("tx") : "",
  resolutionProof: null,
  adjudication: {
    taskId: "",
    txId: "",
    state: "idle",
    lifecycle: null,
    canAppeal: false,
    appealCharge: null,
    error: "",
    checkedAt: "",
  },
  deliveryDiscovery: {
    taskId: "",
    state: "idle",
    candidates: [],
    selectedHeadSha: "",
    message: "",
  },
  reviewDraft: {
    taskId: "",
    choices: {},
    notes: {},
  },
  preparedDocket: readPreparedDocket(),
  busy: new Set(),
  transactions: readJson(TRANSACTIONS_KEY, []),
};

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header shell">
    <a class="brand" href="#top" aria-label="Docket home">
      <img class="brand-mark" src="${import.meta.env.BASE_URL}favicon.svg" alt="" aria-hidden="true" />
      <span>DOCKET</span>
    </a>
    <div class="header-right">
      <span id="header-network" class="network-readout">Release not configured</span>
      <button type="button" class="quiet-button" data-action="connect-wallet" id="connect-wallet">Connect wallet</button>
    </div>
  </header>

  <nav class="workspace-nav shell" aria-label="Docket workspace">
    <div class="workspace-nav-inner">
      <span class="workspace-nav-label">Workspace</span>
      <div class="workspace-nav-links">
        <a href="#dashboard" data-view-link="dashboard">Overview</a>
        <a href="#create" data-view-link="create">Create</a>
        <a href="#open" data-view-link="cases">Cases</a>
        <a href="#transactions" data-view-link="activity">Activity</a>
        <a href="#how-it-works" data-view-link="guide">Guide</a>
      </div>
      <span class="workspace-nav-case" id="workspace-nav-case">No case open</span>
    </div>
  </nav>

  <main id="top">
    <section class="hero shell" data-view="dashboard">
      <div class="hero-copy">
        <p class="eyebrow">GitHub evidence for paid agent work</p>
        <h1>Fund the work.<br><em>Release what shipped.</em></h1>
        <p class="hero-deck">Docket turns a public GitHub deliverable into funded terms, independently verifiable evidence, and criterion-level settlement on GenLayer.</p>
        <div class="hero-actions">
          <a class="primary-button" href="#create">Create a docket <span aria-hidden="true">→</span></a>
          <a class="secondary-button" href="#open">Open a shared case</a>
        </div>
        <div class="trust-row">
          <span>Public GitHub only.</span>
          <span>Public onchain fields.</span>
          <span>Direct agreements first.</span>
        </div>
      </div>
      <aside class="hero-note">
        <span class="note-kicker">Pilot wedge</span>
        <h2>PR-sized implementation work for AI teams and technical founders.</h2>
        <p>Invite a known worker, define the rubric before the work starts, then share one case URL through the delivery and settlement lifecycle.</p>
        <a href="#how-it-works" class="arrow-link">See the pilot flow <span aria-hidden="true">↘</span></a>
      </aside>
    </section>

    <section class="status-band" data-view="dashboard">
      <div class="shell status-band-inner">
        <span id="release-status-dot" class="status-dot neutral" aria-hidden="true"></span>
        <p id="release-status">Loading release configuration…</p>
        <button class="text-button" data-action="scroll-config" type="button">Configure release</button>
      </div>
    </section>

    <section id="config" class="shell section config-section" data-view="dashboard">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Release configuration</p>
          <h2>Connect the deployed settlement engine.</h2>
        </div>
        <p>The browser never invents an address. It must read the selected contract successfully and recognize the v2 interface before it enables a signature.</p>
      </div>
      <div class="config-card">
        <div class="release-metadata" id="release-metadata"></div>
        <form id="config-form" class="config-form">
          <label>
            <span>Network</span>
            <select id="network-select" name="network">
              <option value="studioNext">Studio Next</option>
            </select>
          </label>
          <label class="wide">
            <span>Deployed Docket v2 address</span>
            <input id="contract-address" name="contractAddress" autocomplete="off" spellcheck="false" placeholder="0x…" inputmode="text" />
          </label>
          <div class="config-actions">
            <button type="submit" class="secondary-button">Save configuration</button>
            <button type="button" class="primary-button" data-action="verify-contract">Verify contract</button>
          </div>
        </form>
        <div id="verification-result" class="verification-result" aria-live="polite"></div>
      </div>
    </section>

    <section id="create" class="shell section" data-view="create">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Create a docket</p>
          <h2>Turn an agreement into funded, inspectable terms.</h2>
        </div>
        <p>Use one public repository and a known worker address. Weights must total exactly 10,000 basis points so the eventual release is defined before the work begins.</p>
      </div>
      <div class="workbench">
        <form id="create-form" class="create-form">
          <div class="field-grid">
            <label>
              <span>Worker wallet</span>
              <input name="worker" autocomplete="off" spellcheck="false" placeholder="0x…" required />
            </label>
            <label>
              <span>Escrow (GEN)</span>
              <input name="escrow" inputmode="decimal" autocomplete="off" placeholder="e.g. 5" required />
            </label>
            <label class="span-two">
              <span>Public GitHub repository</span>
              <input name="repository" type="url" autocomplete="off" spellcheck="false" placeholder="https://github.com/owner/repository" required />
            </label>
            <label class="span-two">
              <span>Deliverable title</span>
              <input name="title" maxlength="120" placeholder="A clear, PR-sized outcome" required />
            </label>
          </div>
          <div class="criteria-heading">
            <div>
              <span class="field-label">Acceptance criteria</span>
              <small>Two to five criteria. Keep each observable in the public PR, commit, or CI run.</small>
            </div>
            <strong id="weight-total" class="weight-total">0 / 10,000 bps</strong>
          </div>
          <div id="criteria-container" class="criteria-editor"></div>
          <div class="form-footer">
            <div class="form-secondary-actions">
              <button id="add-criterion" class="text-button" type="button" data-action="add-criterion">+ Add criterion</button>
              <button class="text-button" type="button" data-action="prepare-docket-config">Prepare docket.yml</button>
            </div>
            <button id="create-submit" class="primary-button" type="submit">Fund and create docket <span aria-hidden="true">→</span></button>
          </div>
          <div id="docket-config-preview" class="docket-config-preview" hidden></div>
          <p class="form-note">Prepare, export, and acknowledge the public <code>docket.yml</code> before funding. Its hash is frozen with the case. In a dispute, the contract independently hashes the root file at the submitted PR head before it can settle. Task terms and evidence are public onchain—never enter tokens, private links, or customer data.</p>
        </form>
        <aside class="workbench-note">
          <span class="note-kicker">What is verified</span>
          <ol>
            <li>The assigned public GitHub repository.</li>
            <li>A canonical pull-request URL and immutable head commit.</li>
            <li>A GitHub Actions run linked to that repository.</li>
          </ol>
          <p>Private repositories, personal access tokens, and pasted logs are outside this release.</p>
        </aside>
      </div>
    </section>

    <section id="open" class="shell section open-section" data-view="cases">
      <div class="section-heading compact-heading">
        <div>
          <p class="eyebrow">Open a shared case</p>
          <h2>Read the onchain docket.</h2>
        </div>
        <p>The case ID loads current agreement state from the contract. Resolved-case links can also carry the final transaction for independent execution proof.</p>
      </div>
      <form id="open-case-form" class="open-case-form">
        <label>
          <span>Case ID</span>
          <input id="case-id-input" name="taskId" autocomplete="off" spellcheck="false" placeholder="dkt-…" />
        </label>
        <button class="secondary-button" type="submit">Load case</button>
      </form>
      <div id="case-loading" class="inline-status" hidden></div>
      <article id="case-detail" class="case-detail empty-state">
        <p>Enter a case ID or open a shared Docket URL after a deployed contract has been verified.</p>
      </article>
    </section>

    <section class="shell section recent-section" data-view="cases">
      <div class="section-heading compact-heading">
        <div>
          <p class="eyebrow">My recently opened cases</p>
          <h2>Continue the cases in this browser.</h2>
        </div>
        <p>Local convenience only. Docket does not claim a global marketplace or index from this list.</p>
      </div>
      <div id="recent-cases" class="recent-cases empty-state">No local cases yet.</div>
    </section>

    <section id="transactions" class="shell section transactions-section" data-view="activity">
      <div class="section-heading compact-heading">
        <div>
          <p class="eyebrow">Transaction center</p>
          <h2>Follow the real lifecycle.</h2>
        </div>
        <div class="heading-actions">
          <p>Submitted requests are saved locally, never blindly resubmitted after a refresh.</p>
          <button data-action="refresh-transactions" type="button" class="text-button">Refresh pending</button>
        </div>
      </div>
      <div class="transaction-legend" aria-label="Transaction lifecycle">
        <span>Submitted</span><i aria-hidden="true"></i><span>Awaiting decision</span><i aria-hidden="true"></i><span>Finalizing</span><i aria-hidden="true"></i><span>Finalized</span>
      </div>
      <div id="transaction-list" class="transaction-list empty-state">No wallet requests have been submitted in this browser.</div>
    </section>

    <section id="exceptions" class="shell section exceptions-section" data-view="activity">
      <div class="section-heading compact-heading">
        <div>
          <p class="eyebrow">Recovery &amp; exception center</p>
          <h2>Know what needs a human decision.</h2>
        </div>
        <div class="heading-actions">
          <p>Evidence gaps, inconclusive cases, and transaction failures stay visible until the next safe action is clear.</p>
          <button data-action="refresh-transactions" type="button" class="text-button">Refresh signals</button>
        </div>
      </div>
      <div id="exception-center" class="exception-center empty-state" aria-live="polite">No exceptions need attention in this browser.</div>
    </section>

    <section id="how-it-works" class="shell section pilot-section" data-view="guide">
      <div class="section-heading">
        <div>
          <p class="eyebrow">How pilots work</p>
          <h2>Start with a shared task, then earn distribution through delivery.</h2>
        </div>
        <p>Docket’s first route to usage is not a broad marketplace. It is a useful artifact in the existing GitHub workflow of teams already paying for implementation work.</p>
      </div>
      <div class="pilot-grid">
        <article>
          <span>01</span>
          <h3>Define the rubric in the repo</h3>
          <p>A <code>docket.yml</code> file maps a public PR-sized outcome to weighted criteria before anyone begins.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Generate evidence where work happens</h3>
          <p>The companion GitHub Action creates a compact PR, commit, and workflow manifest without secrets, uploads, or transaction side effects.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Share one case URL</h3>
          <p>Requester and worker use the same Docket link to fund, submit, dispute if needed, and inspect the receipt path.</p>
        </article>
      </div>
      <div class="pilot-callout">
        <strong>First-user motion:</strong>
        <span>run concierge pilots with teams that already ship public GitHub work, learn from completed cases, then automate the useful repeatable steps.</span>
      </div>
    </section>
  </main>

  <footer class="site-footer shell">
    <div class="brand footer-brand">
      <img class="brand-mark" src="${import.meta.env.BASE_URL}favicon.svg" alt="" aria-hidden="true" />
      <span>DOCKET</span>
    </div>
    <p>Public evidence for paid agent work.</p>
    <p class="footer-meta">Built for GenLayer Agent Tank · Pilot release ${APP_VERSION}</p>
  </footer>
  <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>
`;

const ui = {
  headerNetwork: document.querySelector("#header-network"),
  connectWallet: document.querySelector("#connect-wallet"),
  releaseStatus: document.querySelector("#release-status"),
  releaseStatusDot: document.querySelector("#release-status-dot"),
  releaseMetadata: document.querySelector("#release-metadata"),
  configForm: document.querySelector("#config-form"),
  networkSelect: document.querySelector("#network-select"),
  contractAddress: document.querySelector("#contract-address"),
  verificationResult: document.querySelector("#verification-result"),
  criteria: document.querySelector("#criteria-container"),
  weightTotal: document.querySelector("#weight-total"),
  createForm: document.querySelector("#create-form"),
  createSubmit: document.querySelector("#create-submit"),
  docketConfigPreview: document.querySelector("#docket-config-preview"),
  openCaseForm: document.querySelector("#open-case-form"),
  caseInput: document.querySelector("#case-id-input"),
  caseLoading: document.querySelector("#case-loading"),
  caseDetail: document.querySelector("#case-detail"),
  recentCases: document.querySelector("#recent-cases"),
  transactionList: document.querySelector("#transaction-list"),
  exceptionCenter: document.querySelector("#exception-center"),
  workspaceNavCase: document.querySelector("#workspace-nav-case"),
  toastRegion: document.querySelector("#toast-region"),
};

const VIEW_ALIASES = {
  "": "dashboard",
  top: "dashboard",
  dashboard: "dashboard",
  config: "dashboard",
  create: "create",
  open: "cases",
  cases: "cases",
  recent: "cases",
  transactions: "activity",
  exceptions: "activity",
  activity: "activity",
  "how-it-works": "guide",
  guide: "guide",
};

function viewFromHash() {
  const key = window.location.hash.replace(/^#/, "").trim().toLowerCase();
  return VIEW_ALIASES[key] || "dashboard";
}

function renderWorkspaceNav() {
  const view = document.body.dataset.view || "dashboard";
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    const active = link.dataset.viewLink === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (ui.workspaceNavCase) {
    ui.workspaceNavCase.textContent = state.activeTask?.id ? `Case ${state.activeTask.id}` : "No case open";
  }
}

function setWorkspaceView(view, { scrollToHash = false } = {}) {
  const nextView = VIEW_ALIASES[view] || "dashboard";
  document.body.dataset.view = nextView;
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== nextView;
  });
  renderWorkspaceNav();
  if (scrollToHash) {
    const key = window.location.hash.replace(/^#/, "").trim();
    const target = key ? document.getElementById(key) : null;
    (target || document.querySelector("#top"))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function syncWorkspaceView({ scrollToHash = false } = {}) {
  setWorkspaceView(viewFromHash(), { scrollToHash });
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readStoredConfig() {
  const stored = readJson(CONFIG_KEY, {});
  const configuredNetwork = NETWORKS[stored.network] ? stored.network : DEFAULT_RELEASE.network;
  return {
    schemaVersion: 2,
    network: NETWORKS[configuredNetwork] ? configuredNetwork : "studioNext",
    contractAddress: typeof stored.contractAddress === "string" ? stored.contractAddress : DEFAULT_RELEASE.contractAddress,
  };
}

function validTaskId(value) {
  return /^dkt-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || "")) &&
    String(value).length >= 12 &&
    String(value).length <= 64;
}

function readPreparedDocket() {
  const stored = readJson(PREPARED_DOCKET_KEY, null);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const repository = parseGitHubRepository(stored.repositoryUrl);
  const worker = String(stored.worker || "").trim();
  const title = String(stored.title || "").trim();
  const escrowText = String(stored.escrowText || "").trim();
  const criteria = Array.isArray(stored.criteria)
    ? stored.criteria.map((criterion) => ({
      description: String(criterion?.description || "").trim(),
      weight_bps: Number(criterion?.weight_bps),
    }))
    : [];
  const validCriteria = criteria.length >= 2 &&
    criteria.length <= 5 &&
    criteria.every((criterion) =>
      criterion.description.length >= 8 &&
      criterion.description.length <= 500 &&
      Number.isInteger(criterion.weight_bps) &&
      criterion.weight_bps > 0,
    ) &&
    criteria.reduce((sum, criterion) => sum + criterion.weight_bps, 0) === BASIS_POINTS;
  let escrow;
  try {
    escrow = parseGenToWei(escrowText);
  } catch {
    escrow = null;
  }
  if (
    !repository ||
    !isNonzeroAddress(worker) ||
    title.length < 4 ||
    title.length > 120 ||
    !validCriteria ||
    !escrow ||
    !validTaskId(stored.taskId) ||
    typeof stored.configText !== "string" ||
    stored.configText.length < 1 ||
    stored.configText.length > 64_000 ||
    !/^[a-f0-9]{64}$/.test(String(stored.configSha256 || ""))
  ) {
    window.localStorage.removeItem(PREPARED_DOCKET_KEY);
    return null;
  }
  const terms = { worker, repository, title, criteria, escrowText, escrow };
  return {
    ...terms,
    taskId: stored.taskId,
    fingerprint: createTermsFingerprint(terms),
    configText: stored.configText,
    configSha256: stored.configSha256,
    exportedAt: typeof stored.exportedAt === "string" ? stored.exportedAt : "",
    exportMethod: typeof stored.exportMethod === "string" ? stored.exportMethod : "",
    commitAcknowledgedAt: typeof stored.commitAcknowledgedAt === "string" ? stored.commitAcknowledgedAt : "",
    createdAt: typeof stored.createdAt === "string" ? stored.createdAt : "",
  };
}

function persistPreparedDocket(prepared = state.preparedDocket) {
  if (!prepared) {
    window.localStorage.removeItem(PREPARED_DOCKET_KEY);
    return;
  }
  writeJson(PREPARED_DOCKET_KEY, {
    schemaVersion: 2,
    taskId: prepared.taskId,
    worker: prepared.worker,
    repositoryUrl: prepared.repository.url,
    title: prepared.title,
    criteria: prepared.criteria,
    escrowText: prepared.escrowText,
    configText: prepared.configText,
    configSha256: prepared.configSha256,
    exportedAt: prepared.exportedAt || "",
    exportMethod: prepared.exportMethod || "",
    commitAcknowledgedAt: prepared.commitAcknowledgedAt || "",
    createdAt: prepared.createdAt || "",
  });
}

function currentNetwork() {
  return NETWORKS[state.config.network] || NETWORKS.studioNext;
}

function explorerBaseUrl() {
  return state.release.network === currentNetwork().id && state.release.explorerBaseUrl
    ? state.release.explorerBaseUrl
    : currentNetwork().explorerBaseUrl;
}

function releasePinsCurrentConfiguration() {
  return state.release.status === "deployed" &&
    state.release.network === currentNetwork().id &&
    isAddress(state.release.contractAddress) &&
    addressesMatch(state.release.contractAddress, state.config.contractAddress);
}

function explorerUrl(transactionId) {
  if (!transactionId) return "";
  return `${explorerBaseUrl().replace(/\/$/, "")}/tx/${encodeURIComponent(transactionId)}`;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function isNonzeroAddress(value) {
  return isAddress(value) && !/^0x0{40}$/i.test(String(value).trim());
}

function isTransactionId(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

function shortId(value, start = 8, end = 6) {
  const text = String(value || "");
  if (text.length <= start + end + 1) return text;
  return `${text.slice(0, start)}…${text.slice(-end)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function formatError(error) {
  const message = error?.shortMessage || error?.message || String(error || "Unknown error");
  return message.replace(/\s+/g, " ").slice(0, 400);
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function addressesMatch(a, b) {
  return isAddress(a) && isAddress(b) && normalizeAddress(a) === normalizeAddress(b);
}

function parseGitHubRepository(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null;
    const [owner, repository, ...tail] = url.pathname.split("/").filter(Boolean);
    if (
      !owner ||
      !repository ||
      tail.length ||
      owner.length > 39 ||
      repository.length > 100 ||
      owner !== owner.toLowerCase() ||
      repository !== repository.toLowerCase() ||
      owner.startsWith("-") ||
      owner.endsWith("-") ||
      repository.startsWith(".") ||
      repository.endsWith(".") ||
      !/^[a-z0-9-]+$/.test(owner) ||
      !/^[a-z0-9._-]+$/.test(repository)
    ) return null;
    return {
      owner,
      repository,
      url: `https://github.com/${owner}/${repository}`,
    };
  } catch {
    return null;
  }
}

function parsePublicGitHubUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function validateEvidenceInput(repositoryUrl, prUrl, headSha, workflowUrl) {
  const repository = parseGitHubRepository(repositoryUrl);
  const pr = parsePublicGitHubUrl(prUrl);
  const workflow = parsePublicGitHubUrl(workflowUrl);
  if (!repository) return { error: "The task must be tied to a canonical public GitHub repository." };
  if (!pr || !workflow) return { error: "Use canonical https://github.com URLs for the PR and Actions run." };
  const prParts = pr.pathname.split("/").filter(Boolean);
  const workflowParts = workflow.pathname.split("/").filter(Boolean);
  const sameRepo = (parts) => parts[0] === repository.owner && parts[1] === repository.repository;
  if (
    prParts.length !== 4 ||
    !sameRepo(prParts) ||
    prParts[2] !== "pull" ||
    !/^[1-9]\d{0,11}$/.test(prParts[3])
  ) {
    return { error: "The pull-request URL must belong to the docket repository." };
  }
  if (
    workflowParts.length !== 5 ||
    !sameRepo(workflowParts) ||
    workflowParts[2] !== "actions" ||
    workflowParts[3] !== "runs" ||
    !/^[1-9]\d{0,19}$/.test(workflowParts[4])
  ) {
    return { error: "The GitHub Actions run URL must belong to the docket repository." };
  }
  const normalizedSha = String(headSha || "").trim();
  if (!/^[a-f0-9]{40}$/.test(normalizedSha)) {
    return { error: "Head commit SHA must contain exactly 40 lowercase hexadecimal characters." };
  }
  return {
    value: {
      pr_url: `${repository.url}/pull/${prParts[3]}`,
      head_sha: normalizedSha,
      actions_run_url: `${repository.url}/actions/runs/${workflowParts[4]}`,
    },
  };
}

async function validateActionProof(raw, task, manifest) {
  let proof;
  try {
    proof = JSON.parse(raw);
  } catch {
    return { error: "The Action proof is not valid JSON." };
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return { error: "The Action proof must be a JSON object." };
  }
  if (proof.schema_version !== "docket.github-evidence-proof.v1") {
    return { error: "The Action proof does not use Docket's supported evidence-proof schema." };
  }
  const expectedConfigHash = String(task.configSha256 || "");
  const proofConfigHash = String(proof?.config?.sha256 || "");
  if (!/^[a-f0-9]{64}$/.test(expectedConfigHash)) {
    return { error: "This task did not return a valid onchain docket.yml hash." };
  }
  if (proof.task_id !== task.id) {
    return { error: "The Action proof task ID does not match this onchain case." };
  }
  if (proof.repository_url !== task.repositoryUrl) {
    return { error: "The Action proof repository does not match this onchain case." };
  }
  if (proofConfigHash !== expectedConfigHash) {
    return { error: "The Action proof config hash does not match the immutable docket.yml hash onchain." };
  }
  if (proof?.config?.path !== "docket.yml") {
    return { error: "The Action proof must be generated from the repository-root docket.yml." };
  }
  const manifestRunId = new URL(manifest.actions_run_url).pathname.split("/").filter(Boolean).at(-1);
  if (String(proof?.workflow_run?.id || "") !== manifestRunId) {
    return { error: "The Action proof workflow run does not match the submitted manifest." };
  }
  const attempt = proof?.workflow_run?.attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    return { error: "The Action proof workflow attempt is invalid." };
  }
  const manifestHash = await sha256Hex(JSON.stringify(manifest));
  if (proof.manifest_sha256 !== manifestHash) {
    return { error: "The Action proof does not bind the exact manifest being submitted." };
  }
  return { value: proof };
}

function parseGenToWei(value) {
  const text = String(value || "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) {
    throw new Error("Escrow must be a positive GEN amount with at most 18 decimal places.");
  }
  const [whole, fractional = ""] = text.split(".");
  const wei = BigInt(whole) * WEI_PER_GEN + BigInt((fractional + "0".repeat(18)).slice(0, 18));
  if (wei <= 0n) throw new Error("Escrow must be greater than zero.");
  return wei;
}

function asBigInt(value) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
    if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  } catch {
    // Display-only values safely fall through.
  }
  return 0n;
}

function formatGen(value) {
  const wei = asBigInt(value);
  const sign = wei < 0n ? "-" : "";
  const absolute = wei < 0n ? -wei : wei;
  const whole = absolute / WEI_PER_GEN;
  const fraction = (absolute % WEI_PER_GEN).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""} GEN`;
}

async function sha256Hex(text) {
  if (!window.crypto?.subtle) throw new Error("This browser cannot calculate a SHA-256 digest.");
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalConfigForHash(value) {
  return `${String(value).replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function makeTaskId() {
  const random = window.crypto?.randomUUID?.().replace(/-/g, "") ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `dkt-${random.slice(0, 24)}`;
}

function statusLabel(value) {
  return String(value || "UNKNOWN").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(value) {
  const normalized = String(value || "").toUpperCase();
  if (["RESOLVED", "REFUNDED", "CANCELLED"].includes(normalized)) return "good";
  if (["SUBMITTED", "DISPUTED", "NEEDS_EVIDENCE"].includes(normalized)) return "attention";
  return "neutral";
}

function readCriteriaRows() {
  return [...ui.criteria.querySelectorAll(".criterion-row")].map((row) => ({
    description: row.querySelector('[name="criterion-description"]')?.value.trim() || "",
    weight_bps: Number(row.querySelector('[name="criterion-weight"]')?.value || 0),
  }));
}

function criteriaForContract(criteria) {
  const used = new Set();
  return criteria.map((criterion, index) => {
    const base = criterion.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "");
    const fallback = `criterion-${index + 1}`;
    let id = (base || fallback).slice(0, 26).replace(/-+$/g, "") || fallback;
    if (!/^[a-z]/.test(id)) id = fallback;
    let candidate = id;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${id.slice(0, 28)}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return { id: candidate, description: criterion.description, weight_bps: criterion.weight_bps };
  });
}

function createTermsFingerprint(terms) {
  return JSON.stringify({
    worker: normalizeAddress(terms.worker),
    repositoryUrl: terms.repository.url,
    title: terms.title,
    escrow: terms.escrowText,
    criteria: terms.criteria,
  });
}

function quoteCanonicalYamlString(value) {
  const source = String(value);
  let quoted = '"';
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 0x22) quoted += '\\"';
    else if (code === 0x5c) quoted += "\\\\";
    else if (code === 0x08) quoted += "\\b";
    else if (code === 0x09) quoted += "\\t";
    else if (code === 0x0a) quoted += "\\n";
    else if (code === 0x0c) quoted += "\\f";
    else if (code === 0x0d) quoted += "\\r";
    else if (code < 0x20 || code > 0x7e) quoted += `\\u${code.toString(16).padStart(4, "0")}`;
    else quoted += source[index];
  }
  return `${quoted}"`;
}

function buildDocketConfig(taskId, terms) {
  const criteria = criteriaForContract(terms.criteria);
  const lines = [
    "# Public Docket agreement configuration. Keep this file unchanged after registration.",
    "version: 2",
    `task_id: ${taskId}`,
    `repository_url: ${terms.repository.url}`,
    `worker_address: ${normalizeAddress(terms.worker)}`,
    `title: ${quoteCanonicalYamlString(terms.title)}`,
    `escrow_wei: ${quoteCanonicalYamlString(terms.escrow.toString())}`,
    "",
    "criteria:",
  ];
  for (const criterion of criteria) {
    lines.push(`  - id: ${criterion.id}`);
    lines.push(`    weight_bps: ${criterion.weight_bps}`);
    lines.push(`    description: ${quoteCanonicalYamlString(criterion.description)}`);
  }
  lines.push("", "github:", "  provider: github", "  public_only: true", "  config_path: docket.yml");
  return `${lines.join("\n")}\n`;
}

function collectCreateTerms() {
  const form = new FormData(ui.createForm);
  const worker = String(form.get("worker") || "").trim();
  const repository = parseGitHubRepository(form.get("repository"));
  const title = String(form.get("title") || "").trim();
  const criteria = readCriteriaRows();
  if (!isNonzeroAddress(worker)) throw new Error("Worker wallet must be a non-zero 20-byte 0x address.");
  if (!repository) throw new Error("Use a lowercase canonical public GitHub repository URL.");
  if (title.length < 4 || title.length > 120) throw new Error("Use a deliverable title between four and 120 characters.");
  if (criteria.length < 2 || criteria.length > 5) throw new Error("Create between two and five acceptance criteria.");
  if (criteria.some((criterion) => !criterion.description || criterion.description.length < 8 || criterion.description.length > 500)) {
    throw new Error("Every criterion needs an observable description between eight and 500 characters.");
  }
  if (criteria.some((criterion) => !Number.isInteger(criterion.weight_bps) || criterion.weight_bps <= 0)) {
    throw new Error("Every criterion needs a positive whole-number weight.");
  }
  if (criteria.reduce((sum, criterion) => sum + criterion.weight_bps, 0) !== BASIS_POINTS) {
    throw new Error("Criterion weights must total exactly 10,000 bps.");
  }
  if (state.walletAddress && addressesMatch(worker, state.walletAddress)) {
    throw new Error("Requester and worker wallets must be different.");
  }
  const escrowText = String(form.get("escrow") || "").trim();
  return {
    worker,
    repository,
    title,
    criteria,
    escrowText,
    escrow: parseGenToWei(escrowText),
  };
}

function renderPreparedDocket() {
  const prepared = state.preparedDocket;
  if (!prepared) {
    ui.docketConfigPreview.hidden = true;
    ui.docketConfigPreview.innerHTML = "";
    return;
  }
  ui.docketConfigPreview.hidden = false;
  ui.docketConfigPreview.innerHTML = `
    <div class="docket-config-heading">
      <div>
        <span class="note-kicker">Repository onboarding</span>
        <strong>Export, acknowledge, and commit this public <code>docket.yml</code> before delivery begins.</strong>
      </div>
      <div class="config-preview-actions">
        <button type="button" class="text-button" data-action="copy-docket-config">Copy docket.yml</button>
        <button type="button" class="text-button" data-action="download-docket-config">Download</button>
      </div>
    </div>
    <p>Case <code>${escapeHtml(prepared.taskId)}</code> commits this normalized configuration hash onchain:</p>
    <code class="config-hash">${escapeHtml(prepared.configSha256)}</code>
    <textarea readonly aria-label="Generated docket.yml" spellcheck="false">${escapeHtml(prepared.configText)}</textarea>
    <label class="config-commit-confirmation">
      <input type="checkbox" data-action="acknowledge-docket-config" ${prepared.commitAcknowledgedAt ? "checked" : ""} ${prepared.exportedAt ? "" : "disabled"} />
      <span>I exported this exact file and will commit it at the public repository root before the worker opens a delivery PR.</span>
    </label>
    <small>${prepared.exportedAt ? `Export recorded ${escapeHtml(new Date(prepared.exportedAt).toLocaleString())}. ` : "Export the file by copying or downloading it. "}The browser compares the Action-reported hash before it submits evidence; on a disputed case, the contract independently checks the root file and canonical terms at the submitted immutable PR head.</small>
  `;
}

function invalidatePreparedDocket() {
  if (!state.preparedDocket) return;
  state.preparedDocket = null;
  persistPreparedDocket(null);
  renderPreparedDocket();
}

async function prepareDocketConfiguration({ quiet = false } = {}) {
  const terms = collectCreateTerms();
  const fingerprint = createTermsFingerprint(terms);
  if (state.preparedDocket?.fingerprint === fingerprint) {
    const expectedConfig = buildDocketConfig(state.preparedDocket.taskId, terms);
    const expectedHash = await sha256Hex(canonicalConfigForHash(expectedConfig));
    if (
      state.preparedDocket.configText === expectedConfig &&
      state.preparedDocket.configSha256 === expectedHash
    ) {
      return state.preparedDocket;
    }
    state.preparedDocket = null;
    persistPreparedDocket(null);
  }
  const taskId = makeTaskId();
  const configText = buildDocketConfig(taskId, terms);
  const configSha256 = await sha256Hex(canonicalConfigForHash(configText));
  state.preparedDocket = {
    ...terms,
    taskId,
    fingerprint,
    configText,
    configSha256,
    exportedAt: "",
    exportMethod: "",
    commitAcknowledgedAt: "",
    createdAt: new Date().toISOString(),
  };
  persistPreparedDocket();
  renderPreparedDocket();
  if (!quiet) toast(`Prepared ${taskId} and its immutable public configuration hash.`, "success");
  return state.preparedDocket;
}

function recordPreparedDocketExport(method) {
  const prepared = state.preparedDocket;
  if (!prepared) return;
  prepared.exportedAt = new Date().toISOString();
  prepared.exportMethod = method;
  prepared.commitAcknowledgedAt = "";
  persistPreparedDocket();
  renderPreparedDocket();
}

async function copyPreparedDocketConfig() {
  const prepared = state.preparedDocket;
  if (!prepared) return;
  try {
    await navigator.clipboard.writeText(prepared.configText);
    recordPreparedDocketExport("copy");
    toast("docket.yml copied. Commit this exact public file before the worker opens a delivery PR.", "success");
  } catch {
    toast("Select and copy the generated docket.yml from the configuration panel.", "info");
  }
}

function downloadPreparedDocketConfig() {
  const prepared = state.preparedDocket;
  if (!prepared) return;
  const objectUrl = URL.createObjectURL(new Blob([prepared.configText], { type: "text/yaml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "docket.yml";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  recordPreparedDocketExport("download");
  toast("Downloaded docket.yml. Commit this exact public file before delivery begins.", "success");
}

function restorePreparedDocketForm() {
  const prepared = state.preparedDocket;
  if (!prepared) return;
  const worker = ui.createForm.querySelector('[name="worker"]');
  const repository = ui.createForm.querySelector('[name="repository"]');
  const title = ui.createForm.querySelector('[name="title"]');
  const escrow = ui.createForm.querySelector('[name="escrow"]');
  if (worker) worker.value = prepared.worker;
  if (repository) repository.value = prepared.repository.url;
  if (title) title.value = prepared.title;
  if (escrow) escrow.value = prepared.escrowText;
  renderCriteria(prepared.criteria);
  renderPreparedDocket();
}

function renderCriteria(rows = null) {
  const criteria = rows || readCriteriaRows();
  ui.criteria.innerHTML = criteria.map((criterion, index) => `
    <div class="criterion-row">
      <span class="criterion-index">${String(index + 1).padStart(2, "0")}</span>
      <label>
        <span class="visually-hidden">Criterion ${index + 1} description</span>
        <input name="criterion-description" maxlength="500" placeholder="Observable acceptance criterion" value="${escapeHtml(criterion.description || "")}" />
      </label>
      <label class="weight-input">
        <span class="visually-hidden">Criterion ${index + 1} weight in basis points</span>
        <input name="criterion-weight" type="number" min="1" max="10000" step="1" inputmode="numeric" placeholder="bps" value="${criterion.weight_bps || ""}" />
        <small>bps</small>
      </label>
      <button class="icon-button" data-action="remove-criterion" type="button" aria-label="Remove criterion ${index + 1}" ${criteria.length <= 2 ? "disabled" : ""}>×</button>
    </div>
  `).join("");
  updateWeightTotal();
}

function updateWeightTotal() {
  const total = readCriteriaRows().reduce((sum, criterion) => sum + (Number.isInteger(criterion.weight_bps) ? criterion.weight_bps : 0), 0);
  ui.weightTotal.textContent = `${total.toLocaleString()} / 10,000 bps`;
  ui.weightTotal.classList.toggle("valid", total === BASIS_POINTS);
}

function renderReleaseMetadata() {
  const release = state.release;
  const network = currentNetwork();
  const manifestAddress = isAddress(release.contractAddress) ? release.contractAddress : "";
  const releaseState = release.status === "deployed" && manifestAddress ? "Manifest names a deployment" : "Awaiting a real deployment";
  ui.releaseMetadata.innerHTML = `
    <div><span>Release</span><strong>${escapeHtml(release.release || APP_VERSION)}</strong></div>
    <div><span>Manifest</span><strong>${escapeHtml(releaseState)}</strong></div>
    <div><span>Selected network</span><strong>${escapeHtml(network.label)}</strong></div>
    <div><span>Configured address</span><strong>${state.config.contractAddress ? escapeHtml(shortId(state.config.contractAddress)) : "Not set"}</strong></div>
  `;
}

function setReleaseStatus(message, stateName = "neutral") {
  ui.releaseStatus.textContent = message;
  ui.releaseStatusDot.className = `status-dot ${stateName}`;
}

function renderHeader() {
  const network = currentNetwork();
  const configured = isAddress(state.config.contractAddress);
  const verified = state.contractVerified;
  ui.headerNetwork.textContent = verified
    ? state.verification?.mode === "manifest"
      ? `${network.label} · manifest code verified`
      : `${network.label} · developer contract`
    : configured
      ? `${network.label} · verification needed`
      : "Release not configured";
  ui.connectWallet.textContent = state.walletClient && state.walletAddress
    ? shortId(state.walletAddress)
    : state.walletAddress
      ? `Reconnect ${shortId(state.walletAddress)}`
      : "Connect wallet";
  ui.connectWallet.classList.toggle("connected", Boolean(state.walletClient && state.walletAddress));
}

function renderVerification() {
  if (!state.verification) {
    ui.verificationResult.textContent = "Writes remain disabled until this browser verifies a deployed v2 contract.";
    ui.verificationResult.className = "verification-result";
    return;
  }
  const { ok, message, detail } = state.verification;
  ui.verificationResult.innerHTML = `
    <strong>${ok ? state.verification?.mode === "manifest" ? "Manifest-pinned code verified" : "Developer contract verified" : "Verification did not pass"}</strong>
    <span>${escapeHtml(message)}</span>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  `;
  ui.verificationResult.className = `verification-result ${ok ? "success" : "error"}`;
}

function taskField(raw, keys, fallback = "") {
  for (const key of keys) {
    if (raw && raw[key] !== undefined && raw[key] !== null) return raw[key];
  }
  return fallback;
}

function normalizeCriteria(raw, rawFindings = []) {
  const criteria = Array.isArray(raw) ? raw : [];
  const findings = Array.isArray(rawFindings) ? rawFindings : [];
  const findingsById = new Map(findings.map((finding) => [
    String(taskField(finding, ["id", "criterion_id"], "")),
    finding,
  ]));
  return criteria.map((criterion, index) => ({
    id: taskField(criterion, ["id"], `criterion-${index + 1}`),
    description: taskField(criterion, ["description", "criterion", "name"], `Criterion ${index + 1}`),
    weightBps: taskField(criterion, ["weight_bps", "weightBps", "weight"], 0),
    finding: taskField(
      findingsById.get(String(taskField(criterion, ["id"], ""))),
      ["verdict", "finding", "result"],
      taskField(criterion, ["finding", "verdict", "result"], ""),
    ),
    rationale: taskField(
      findingsById.get(String(taskField(criterion, ["id"], ""))),
      ["reason", "rationale"],
      taskField(criterion, ["rationale", "reason"], ""),
    ),
  }));
}

function normalizeTask(raw, taskId) {
  const task = raw && typeof raw === "object" ? raw : {};
  const checklist = taskField(task, ["criteria", "checklist"], []);
  const findings = taskField(task, ["findings"], []);
  const evidenceManifest = taskField(task, ["evidence_manifest_json", "evidenceManifestJson", "evidence_manifest"], "");
  return {
    id: taskField(task, ["task_id", "taskId", "id"], taskId),
    status: String(taskField(task, ["status", "task_status"], "UNKNOWN")),
    requester: taskField(task, ["requester", "requester_address"], ""),
    worker: taskField(task, ["worker", "worker_address"], ""),
    repositoryUrl: taskField(task, ["repository_url", "repositoryUrl"], ""),
    title: taskField(task, ["title"], "Untitled docket"),
    configSha256: taskField(task, ["config_sha256", "configSha256"], ""),
    escrowAmount: taskField(task, ["escrow_amount", "escrowAmount", "escrow"], 0),
    workerAmount: taskField(task, ["worker_amount", "workerAmount"], 0),
    requesterAmount: taskField(task, ["requester_amount", "requesterAmount"], 0),
    passedBps: taskField(task, ["passed_bps", "passedBps"], null),
    attempts: taskField(task, ["attempts"], 0),
    evidenceVersion: taskField(task, ["evidence_version", "evidenceVersion"], 0),
    resolvedAt: taskField(task, ["resolved_at", "resolvedAt"], 0),
    inconclusiveAt: taskField(task, ["inconclusive_at", "inconclusiveAt"], 0),
    criteria: normalizeCriteria(checklist, findings),
    evidenceManifest,
    evidenceSnapshot: taskField(task, ["evidence_snapshot_json", "evidenceSnapshot", "evidence_snapshot"], ""),
    decisionReason: taskField(task, ["decision_reason", "decisionReason", "dispute_reason"], ""),
    createdAt: taskField(task, ["created_at", "createdAt"], ""),
  };
}

function parseEvidenceForDisplay(raw, repositoryUrl) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const validated = validateEvidenceInput(
      repositoryUrl,
      parsed.pr_url || parsed.prUrl,
      parsed.head_sha || parsed.headSha,
      parsed.actions_run_url || parsed.actionsRunUrl,
    );
    return validated.value || null;
  } catch {
    return null;
  }
}

function parseRecord(raw) {
  if (!raw) return null;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function externalGitHubLink(url, label) {
  const parsed = parsePublicGitHubUrl(url);
  if (!parsed) return escapeHtml(label);
  return `<a href="${escapeHtml(parsed.toString())}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function formatBps(value) {
  const bps = Math.max(0, Math.min(BASIS_POINTS, Number(value) || 0));
  const percentage = bps / 100;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function settlementShareBps(task) {
  const explicit = Number(task.passedBps);
  if (task.passedBps !== null && task.passedBps !== "" && Number.isFinite(explicit) && explicit >= 0 && explicit <= BASIS_POINTS) {
    return Math.round(explicit);
  }
  const escrow = asBigInt(task.escrowAmount);
  if (escrow <= 0n) return 0;
  return Number((asBigInt(task.workerAmount) * BigInt(BASIS_POINTS)) / escrow);
}

function latestLocalResolutionTransaction(taskId) {
  return scopedTransactions()
    .filter((entry) => entry.taskId === taskId && !entry.isChild && SETTLEMENT_LABELS.has(entry.label) && isTransactionId(entry.hash))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

function isRequesterAcceptedTask(task) {
  return String(task?.status || "").toUpperCase() === "RESOLVED" &&
    settlementShareBps(task) === BASIS_POINTS &&
    asBigInt(task?.requesterAmount) === 0n &&
    Array.isArray(task?.criteria) &&
    task.criteria.length > 0 &&
    task.criteria.every((criterion) => String(criterion?.rationale || "").trim() === "Accepted by requester.");
}

function resolutionTransactionIdForTask(task) {
  if (isTransactionId(state.activeResolutionTxId)) return state.activeResolutionTxId;
  return latestLocalResolutionTransaction(task?.id)?.hash || "";
}

function transactionCallText(transaction) {
  const readable = transaction?.data?.calldata?.readable;
  if (typeof readable === "string") return readable;
  const raw = transaction?.data?.calldata?.raw;
  if (!Array.isArray(raw)) return "";
  try {
    return new TextDecoder().decode(new Uint8Array(raw));
  } catch {
    return "";
  }
}

async function verifyResolutionTransaction(task) {
  const hash = resolutionTransactionIdForTask(task);
  if (!hash || !state.readClient) {
    state.resolutionProof = null;
    state.adjudication = { taskId: task?.id || "", txId: "", state: "idle", lifecycle: null, canAppeal: false, appealCharge: null, error: "", checkedAt: "" };
    return;
  }
  state.resolutionProof = { hash, state: "loading", message: "Checking the shared resolution transaction…" };
  renderTask(task);
  try {
    const transaction = await state.readClient.getTransaction({ hash });
    const status = String(transaction?.statusName || transaction?.status || "").toUpperCase();
    const execution = String(transaction?.txExecutionResultName || "").toUpperCase();
    const recipient = transaction?.recipient || transaction?.to_address || transaction?.to || "";
    const callText = transactionCallText(transaction);
    const targetsContract = addressesMatch(recipient, state.config.contractAddress);
    const settlementFunction = isRequesterAcceptedTask(task) ? "accept_delivery" : "resolve_dispute";
    const exactResolutionCall = callText.includes(`{"":"${settlementFunction}""args":["${task.id}",]}`);
    const finalized = status === "FINALIZED" && execution === "FINISHED_WITH_RETURN";
    const deliveryEffects = transaction?.data?.fee_accounting?.message_effect_delivered;
    const deliveryValues = deliveryEffects && typeof deliveryEffects === "object" ? Object.values(deliveryEffects) : [];
    const expectedPayouts = [asBigInt(task.workerAmount), asBigInt(task.requesterAmount)].filter((amount) => amount > 0n).length;
    const payoutsDelivered = expectedPayouts > 0 && deliveryValues.length >= expectedPayouts && deliveryValues.every(Boolean);
    const bound = targetsContract && exactResolutionCall;
    const verified = finalized && bound;
    state.resolutionProof = {
      hash,
      state: verified ? "verified" : !bound || status === "FINALIZED" ? "invalid" : "pending",
      finalized,
      bound,
      payoutsDelivered,
      message: verified
        ? `Finalized ${settlementFunction} call bound to ${task.id}.${payoutsDelivered ? expectedPayouts === 1 ? " The payout value effect was delivered." : " Both payout value effects were delivered." : ""}`
        : !bound
          ? `This transaction is not the ${settlementFunction} call for this case.`
          : status !== "FINALIZED"
          ? `Network status: ${statusLabel(status || "pending")}.`
          : "This transaction does not prove this case’s successful resolution.",
    };
    if (!isRequesterAcceptedTask(task)) await refreshAdjudicationLifecycle(task, { quiet: true, render: false });
  } catch (error) {
    state.resolutionProof = {
      hash,
      state: "unavailable",
      message: `The transaction could not be verified: ${formatError(error)}`,
    };
  }
  renderTask(task);
}

async function refreshAdjudicationLifecycle(task = state.activeTask, { quiet = false, render = true } = {}) {
  const txId = resolutionTransactionIdForTask(task);
  if (!task || !isTransactionId(txId) || !state.readClient) return null;
  state.adjudication = {
    ...(state.adjudication.txId === txId ? state.adjudication : {}),
    taskId: task.id,
    txId,
    state: "loading",
    error: "",
  };
  if (render) renderTask(task);
  try {
    const lifecycle = await state.readClient.advanced.getTransactionLifecycle({ hash: txId });
    let canAppeal = false;
    let appealCharge = null;
    try {
      canAppeal = await state.readClient.canAppeal({ txId });
      if (canAppeal) appealCharge = await state.readClient.getAppealCharge({ txId });
    } catch {
      canAppeal = false;
      appealCharge = null;
    }
    state.adjudication = {
      taskId: task.id,
      txId,
      state: "ready",
      lifecycle,
      canAppeal,
      appealCharge,
      error: "",
      checkedAt: new Date().toISOString(),
    };
    const local = transactionByHash(txId, activeTransactionScope());
    if (local) {
      upsertTransaction({
        ...local,
        protocolStatus: String(lifecycle.storedStatus || ""),
        projectedStatus: String(lifecycle.projectedStatus || ""),
        resolutionAction: String(lifecycle.resolutionAction || ""),
        decisionId: lifecycle.decisionId || "",
        appealEligible: canAppeal,
        appealChargeWei: appealCharge === null ? "" : appealCharge.toString(),
      });
    }
    if (!quiet) toast("GenLayer consensus lifecycle refreshed.", "success");
    return state.adjudication;
  } catch (error) {
    state.adjudication = {
      taskId: task.id,
      txId,
      state: "error",
      lifecycle: null,
      canAppeal: false,
      appealCharge: null,
      error: formatError(error),
      checkedAt: new Date().toISOString(),
    };
    if (!quiet) toast(`Could not read the consensus lifecycle: ${formatError(error)}`, "error");
    return null;
  } finally {
    if (render && state.activeTask?.id === task.id) renderTask(task);
  }
}

function renderResolutionProof() {
  const proof = state.resolutionProof;
  if (!proof) {
    return `<div class="resolution-proof neutral"><span>Resolution transaction</span><strong>Not included in this share link</strong><small>The allocation is read from the contract. Add the final transaction to share execution proof.</small></div>`;
  }
  const label = ({
    loading: "Checking transaction",
    verified: "Execution verified",
    pending: "Transaction pending",
    invalid: "Proof mismatch",
    unavailable: "Proof unavailable",
  })[proof.state] || "Transaction proof";
  return `
    <div class="resolution-proof ${escapeHtml(proof.state)}">
      <span>Resolution transaction</span>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(proof.message)}</small>
      ${isTransactionId(proof.hash) ? `<a href="${escapeHtml(explorerUrl(proof.hash))}" target="_blank" rel="noreferrer">${escapeHtml(shortId(proof.hash, 10, 8))} ↗</a>` : ""}
    </div>
  `;
}

function evidenceRelationshipChecks(snapshot) {
  const relationships = snapshot?.relationships;
  if (!relationships || typeof relationships !== "object") return [];
  return [
    ["pr_targets_task_repository", "PR targets the docket repository"],
    ["manifest_head_matches_pr", "Immutable head matches the pull request"],
    ["workflow_completed_successfully", "GitHub Actions completed successfully"],
    ["workflow_head_matches_pr", "Workflow ran against the submitted head"],
    ["config_at_head_matches_registration", "docket.yml hash matches registration"],
    ["config_terms_match_registration", "Public terms match the onchain agreement"],
  ].filter(([key]) => typeof relationships[key] === "boolean").map(([key, label]) => ({
    label,
    passed: relationships[key],
  }));
}

function resetDeliveryDiscovery(taskId = "") {
  state.deliveryDiscovery = {
    taskId,
    state: "idle",
    candidates: [],
    selectedHeadSha: "",
    message: "",
  };
}

function activeDeliveryDiscovery(task) {
  if (state.deliveryDiscovery.taskId !== task.id) resetDeliveryDiscovery(task.id);
  return state.deliveryDiscovery;
}

async function githubApiJson(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 403 && remaining === "0") {
      throw new Error("GitHub’s public API rate limit is exhausted for this connection. Use the manual Action proof fallback or try again after the reset.");
    }
    throw new Error(`GitHub returned ${response.status} while checking public delivery evidence.`);
  }
  return response.json();
}

function decodeGitHubContent(record) {
  if (record?.encoding !== "base64" || typeof record.content !== "string") {
    throw new Error("GitHub did not return docket.yml as base64 file content.");
  }
  const compact = record.content.replace(/\s+/g, "");
  const binary = window.atob(compact);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function deliveryCandidateState(candidate, status = "") {
  if (!candidate.configMatches) return { tone: "bad", label: "Terms mismatch" };
  if (!candidate.run) return { tone: "attention", label: "CI not ready" };
  return { tone: "good", label: ["OPEN", "NEEDS_EVIDENCE"].includes(status) ? "Ready to submit" : "Source verified" };
}

async function inspectPullRequestForDelivery(task, repository, pullRequest) {
  const headSha = String(pullRequest?.head?.sha || "").toLowerCase();
  const number = Number(pullRequest?.number);
  const baseRepository = String(pullRequest?.base?.repo?.full_name || "").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(headSha) || !Number.isSafeInteger(number) || baseRepository !== `${repository.owner}/${repository.repository}`) {
    return null;
  }
  let configMatches = false;
  try {
    const configRecord = await githubApiJson(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/contents/docket.yml?ref=${encodeURIComponent(headSha)}`,
    );
    const configText = decodeGitHubContent(configRecord);
    const configHash = await sha256Hex(canonicalConfigForHash(configText));
    configMatches = configHash === String(task.configSha256 || "").toLowerCase();
  } catch {
    configMatches = false;
  }

  let run = null;
  if (configMatches) {
    const workflowResponse = await githubApiJson(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/actions/runs?event=pull_request&head_sha=${encodeURIComponent(headSha)}&status=completed&per_page=20`,
    );
    const workflowRuns = Array.isArray(workflowResponse?.workflow_runs) ? workflowResponse.workflow_runs : [];
    run = workflowRuns.find((item) =>
      item?.event === "pull_request" &&
      item?.status === "completed" &&
      item?.conclusion === "success" &&
      String(item?.head_sha || "").toLowerCase() === headSha &&
      Number.isSafeInteger(Number(item?.id)),
    ) || null;
  }

  return {
    number,
    title: String(pullRequest?.title || `Pull request #${number}`).slice(0, 180),
    headSha,
    prUrl: `${repository.url}/pull/${number}`,
    updatedAt: String(pullRequest?.updated_at || ""),
    configMatches,
    run: run ? {
      id: Number(run.id),
      url: `${repository.url}/actions/runs/${Number(run.id)}`,
      attempt: Number(run.run_attempt || 1),
    } : null,
  };
}

async function discoverGitHubDelivery(task = state.activeTask) {
  if (!task || !["OPEN", "NEEDS_EVIDENCE", "SUBMITTED", "DISPUTED", "RESOLVED"].includes(String(task.status).toUpperCase())) return;
  const repository = parseGitHubRepository(task.repositoryUrl);
  if (!repository) {
    toast("This case does not contain a canonical public GitHub repository.", "error");
    return;
  }
  const discovery = activeDeliveryDiscovery(task);
  if (discovery.state === "searching") return;
  state.deliveryDiscovery = {
    ...discovery,
    state: "searching",
    candidates: [],
    selectedHeadSha: "",
    message: "Reading open pull requests and their immutable public evidence…",
  };
  renderTask(task);
  try {
    const recordedEvidence = parseEvidenceForDisplay(task.evidenceManifest, task.repositoryUrl);
    const recordedPrNumber = recordedEvidence
      ? Number(new URL(recordedEvidence.pr_url).pathname.split("/").at(-1))
      : 0;
    const pulls = Number.isSafeInteger(recordedPrNumber) && recordedPrNumber > 0
      ? [await githubApiJson(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls/${recordedPrNumber}`,
      )]
      : await githubApiJson(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls?state=open&sort=updated&direction=desc&per_page=8`,
      );
    const inspected = await Promise.all(
      (Array.isArray(pulls) ? pulls : []).slice(0, 8).map((pullRequest) => inspectPullRequestForDelivery(task, repository, pullRequest)),
    );
    const candidates = inspected.filter(Boolean);
    const eligible = candidates.filter((candidate) => candidate.configMatches && candidate.run);
    state.deliveryDiscovery = {
      taskId: task.id,
      state: eligible.length ? "ready" : candidates.length ? "not-ready" : "empty",
      candidates,
      selectedHeadSha: eligible[0]?.headSha || "",
      message: eligible.length
        ? `${eligible.length} pull request${eligible.length === 1 ? "" : "s"} passed every delivery preflight check.`
        : candidates.length
          ? "Open pull requests were found, but none has both the registered docket.yml and a successful pull-request workflow at the same head commit."
          : "No open pull requests were found for this repository.",
    };
  } catch (error) {
    state.deliveryDiscovery = {
      taskId: task.id,
      state: "error",
      candidates: [],
      selectedHeadSha: "",
      message: formatError(error),
    };
  }
  renderTask(task);
}

function selectedDeliveryCandidate(task) {
  const discovery = activeDeliveryDiscovery(task);
  return discovery.candidates.find((candidate) =>
    candidate.headSha === discovery.selectedHeadSha && candidate.configMatches && candidate.run,
  ) || null;
}

function deliveryStageState(stage, status, discovery) {
  const settled = ["RESOLVED", "REFUNDED", "CANCELLED"].includes(status);
  const submitted = ["SUBMITTED", "DISPUTED", "NEEDS_EVIDENCE"].includes(status) || settled;
  if (stage === "assignment") return "complete";
  if (stage === "evidence") return submitted || discovery.state === "ready" ? "complete" : "active";
  if (stage === "submission") return submitted ? "complete" : discovery.state === "ready" ? "active" : "pending";
  if (stage === "review") return settled ? "complete" : ["SUBMITTED", "DISPUTED", "NEEDS_EVIDENCE"].includes(status) ? "active" : "pending";
  return settled ? "complete" : "pending";
}

function renderDeliveryConsole(task, role, status) {
  const discovery = activeDeliveryDiscovery(task);
  const selected = selectedDeliveryCandidate(task);
  const recordedEvidence = parseEvidenceForDisplay(task.evidenceManifest, task.repositoryUrl);
  const workerMaySubmit = role === "Worker" && ["OPEN", "NEEDS_EVIDENCE"].includes(status) && state.contractVerified;
  const canDiscover = ["OPEN", "NEEDS_EVIDENCE", "SUBMITTED", "DISPUTED", "RESOLVED"].includes(status);
  const stages = [
    ["assignment", "Assignment"],
    ["evidence", "GitHub evidence"],
    ["submission", "Submitted"],
    ["review", "Review"],
    ["settlement", "Settlement"],
  ];
  return `
    <section class="delivery-console">
      <div class="delivery-console-heading">
        <div><span class="note-kicker">Delivery console</span><h4>Move this case from assignment to settlement.</h4></div>
        ${canDiscover ? `<button type="button" class="secondary-button" data-action="discover-delivery" ${discovery.state === "searching" ? "disabled" : ""}>${discovery.state === "searching" ? "Checking GitHub…" : recordedEvidence ? "Recheck GitHub source" : "Find matching delivery"}</button>` : ""}
      </div>
      <ol class="delivery-stages">
        ${stages.map(([key, label], index) => `<li class="${deliveryStageState(key, status, discovery)}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(label)}</strong></li>`).join("")}
      </ol>
      ${recordedEvidence ? `
        <div class="recorded-delivery">
          <span>Recorded delivery</span>
          <strong>${externalGitHubLink(recordedEvidence.pr_url, `PR #${new URL(recordedEvidence.pr_url).pathname.split("/").at(-1)}`)}</strong>
          <code>${escapeHtml(shortId(recordedEvidence.head_sha, 10, 8))}</code>
          <strong>${externalGitHubLink(recordedEvidence.actions_run_url, "Actions run ↗")}</strong>
        </div>
      ` : ""}
      ${["OPEN", "NEEDS_EVIDENCE"].includes(status) ? `
        <div class="repo-kit-row">
          <div><span>Repository setup</span><p>Extract the GitHub kit at the repository root, add the generated <code>docket.yml</code>, and commit both before opening the delivery PR.</p></div>
          <a class="secondary-button" href="${escapeHtml(`${import.meta.env.BASE_URL}docket-github-kit.zip`)}" download>Download GitHub kit</a>
        </div>
      ` : ""}
      ${discovery.state !== "idle" ? `
        <div class="discovery-status ${escapeHtml(discovery.state)}"><span class="status-dot ${discovery.state === "ready" ? "good" : discovery.state === "searching" ? "attention" : discovery.state === "error" ? "bad" : "neutral"}"></span><p>${escapeHtml(discovery.message)}</p></div>
      ` : `
        <p class="delivery-console-intro">Docket checks open PRs through GitHub’s public API. It requires the registered root <code>docket.yml</code>, an immutable head SHA, and a successful pull-request workflow at that same commit. No GitHub token is requested.</p>
      `}
      ${discovery.candidates.length ? `
        <div class="delivery-candidates">
          ${discovery.candidates.map((candidate) => {
            const candidateState = deliveryCandidateState(candidate, status);
            const eligible = candidate.configMatches && candidate.run;
            return `
              <button type="button" class="delivery-candidate ${candidate.headSha === discovery.selectedHeadSha ? "selected" : ""}" data-action="select-delivery" data-head-sha="${escapeHtml(candidate.headSha)}" ${eligible ? "" : "disabled"}>
                <span class="status-pill ${candidateState.tone}">${escapeHtml(candidateState.label)}</span>
                <strong>PR #${candidate.number} · ${escapeHtml(candidate.title)}</strong>
                <code>${escapeHtml(shortId(candidate.headSha, 10, 8))}</code>
                <small>${candidate.configMatches ? "docket.yml matched" : "docket.yml did not match"} · ${candidate.run ? `successful run ${candidate.run.id}` : "successful CI run not found"}</small>
              </button>
            `;
          }).join("")}
        </div>
      ` : ""}
      ${selected && ["OPEN", "NEEDS_EVIDENCE"].includes(status) ? `
        <div class="delivery-submit-row">
          <div><span>Selected manifest</span><code>${escapeHtml(JSON.stringify({ pr_url: selected.prUrl, head_sha: selected.headSha, actions_run_url: selected.run.url }))}</code></div>
          ${workerMaySubmit
            ? `<form data-form="submit-discovered-evidence"><button class="primary-button" type="submit">${status === "NEEDS_EVIDENCE" ? "Supplement verified evidence" : "Submit verified delivery"}</button></form>`
            : `<button type="button" class="primary-button" data-action="connect-wallet">Connect worker wallet to submit</button>`}
        </div>
      ` : ""}
      ${["OPEN", "NEEDS_EVIDENCE"].includes(status) ? `
        <details class="manual-evidence-fallback">
          <summary>Manual Action proof fallback</summary>
          <form data-form="submit-evidence">
            ${evidenceFields(task)}
            <button class="secondary-button" type="submit" ${workerMaySubmit ? "" : "disabled"}>${status === "NEEDS_EVIDENCE" ? "Supplement manual evidence" : "Submit manual evidence"}</button>
          </form>
        </details>
      ` : ""}
    </section>
  `;
}

function payoutReceiptState(task) {
  const expectedPayouts = [asBigInt(task.workerAmount), asBigInt(task.requesterAmount)]
    .filter((amount) => amount > 0n).length;
  if (!expectedPayouts) {
    return { tone: "neutral", message: "No non-zero payout is recorded for this settlement." };
  }
  if (state.resolutionProof?.state === "verified") {
    return state.resolutionProof.payoutsDelivered
      ? { tone: "good", message: `The resolution transaction finalized successfully and delivered ${expectedPayouts === 1 ? "the payout value effect" : "both payout value effects"}.` }
      : { tone: "good", message: "The resolution transaction finalized successfully. The allocation is recorded on the contract." };
  }
  const parent = scopedTransactions()
    .filter((entry) => entry.taskId === task.id && !entry.isChild && SETTLEMENT_LABELS.has(entry.label))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  if (!parent) {
    return {
      tone: "neutral",
      message: "Settlement allocation is final on the contract. Payout receipts have not been tracked in this browser.",
    };
  }
  const children = scopedTransactions().filter((entry) => entry.parentHash === parent.hash && entry.isChild);
  if (children.some((entry) => entry.lifecycle === "failed")) {
    return { tone: "bad", message: "Settlement is determined, but at least one payout child message failed. Payment is not confirmed." };
  }
  const confirmed = children.length >= expectedPayouts &&
    children.filter((entry) => entry.lifecycle === "finalized" && entry.executionResult === "FINISHED_WITH_RETURN").length >= expectedPayouts;
  if (confirmed) {
    return { tone: "good", message: "All expected non-zero payout child messages finalized successfully." };
  }
  return {
    tone: "attention",
    message: "Settlement is determined. Payout child messages are still pending or not yet discoverable; payment is not confirmed.",
  };
}

function renderTask(task = state.activeTask) {
  renderWorkspaceNav();
  if (!task) {
    ui.caseDetail.className = "case-detail empty-state";
    ui.caseDetail.textContent = state.contractVerified
      ? "Enter a case ID or open a shared Docket URL."
      : "Verify a deployed Docket v2 contract to read a shared case.";
    renderExceptionCenter();
    return;
  }

  const evidence = parseEvidenceForDisplay(task.evidenceManifest, task.repositoryUrl);
  const evidenceSnapshot = parseRecord(task.evidenceSnapshot);
  const relationshipChecks = evidenceRelationshipChecks(evidenceSnapshot);
  const totalWeight = task.criteria.reduce((total, criterion) => total + Number(criterion.weightBps || 0), 0);
  const workerAmount = asBigInt(task.workerAmount);
  const requesterAmount = asBigInt(task.requesterAmount);
  const hasSettlement = workerAmount > 0n || requesterAmount > 0n;
  const receiptState = hasSettlement ? payoutReceiptState(task) : null;
  const role = userRole(task);
  const status = String(task.status || "").toUpperCase();
  const passedBps = settlementShareBps(task);
  const requesterBps = BASIS_POINTS - passedBps;
  const isResolved = status === "RESOLVED" && hasSettlement;
  const requesterAccepted = isRequesterAcceptedTask(task);

  ui.caseDetail.className = "case-detail";
  ui.caseDetail.innerHTML = `
    <div class="case-topline">
      <div>
        <span class="case-id">${escapeHtml(task.id)}</span>
        <h3>${escapeHtml(task.title)}</h3>
      </div>
      <span class="status-pill ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>
    </div>
    ${isResolved ? `
      <section class="resolution-hero" aria-label="Resolution summary">
        <div class="resolution-result">
          <span class="note-kicker">${requesterAccepted ? "Requester-authorized result" : "AI-adjudicated result"}</span>
          <h4>${escapeHtml(formatBps(passedBps))} <em>of escrow awarded</em></h4>
          <p>${requesterAccepted ? "The requester accepted the delivery and released the full escrow to the worker." : "The worker earned the weight of every criterion that passed. The remaining escrow returned to the requester."}</p>
        </div>
        <div class="resolution-allocation">
          <div class="split-labels">
            <span><strong>${escapeHtml(formatBps(passedBps))}</strong> Worker</span>
            <span><strong>${escapeHtml(formatBps(requesterBps))}</strong> Requester</span>
          </div>
          <div class="split-bar" role="img" aria-label="${escapeHtml(formatBps(passedBps))} to worker and ${escapeHtml(formatBps(requesterBps))} to requester">
            <span class="worker-share" style="width:${passedBps / 100}%"></span>
            <span class="requester-share" style="width:${requesterBps / 100}%"></span>
          </div>
          <div class="split-values">
            <span>${escapeHtml(formatGen(workerAmount))}</span>
            <span>${escapeHtml(formatGen(requesterAmount))}</span>
          </div>
        </div>
        ${renderResolutionProof()}
      </section>
    ` : ""}
    <div class="case-overview">
      <div><span>Escrow</span><strong>${escapeHtml(formatGen(task.escrowAmount))}</strong></div>
      <div><span>Requester</span><strong title="${escapeHtml(task.requester)}">${escapeHtml(shortId(task.requester))}</strong></div>
      <div><span>Worker</span><strong title="${escapeHtml(task.worker)}">${escapeHtml(shortId(task.worker))}</strong></div>
      <div><span>Public repo</span>${externalGitHubLink(task.repositoryUrl, "Open repository")}</div>
    </div>
    ${/^[a-f0-9]{64}$/.test(task.configSha256) ? `
      <div class="config-commitment">
        <span>Onchain docket.yml hash</span>
        <code>${escapeHtml(task.configSha256)}</code>
      </div>
    ` : ""}
    <div class="case-split">
      <div class="criteria-view">
        <div class="criteria-view-heading"><span>Acceptance criteria</span><span>${totalWeight.toLocaleString()} bps</span></div>
        <ol>
          ${task.criteria.length ? task.criteria.map((criterion) => {
            const finding = String(criterion.finding || "PENDING").toUpperCase();
            const findingClass = finding === "PASS" ? "pass" : finding === "FAIL" ? "fail" : finding === "INCONCLUSIVE" ? "inconclusive" : "pending";
            const award = finding === "PASS"
              ? formatGen((asBigInt(task.escrowAmount) * BigInt(Math.max(0, Number(criterion.weightBps) || 0))) / BigInt(BASIS_POINTS))
              : finding === "FAIL" ? "0 GEN" : "Awaiting decision";
            return `
            <li class="criterion-row-result ${findingClass}">
              <div>
                <strong>${escapeHtml(criterion.description)}</strong>
                ${criterion.rationale ? `<small>${escapeHtml(criterion.rationale)}</small>` : ""}
              </div>
              <div class="criterion-finding">
                <span>${Number(criterion.weightBps || 0).toLocaleString()} bps</span>
                <em>${escapeHtml(statusLabel(finding))}</em>
                <strong>${escapeHtml(award)}</strong>
              </div>
            </li>
          `; }).join("") : "<li><span>No criteria were returned by this contract.</span></li>"}
        </ol>
      </div>
      <aside class="case-evidence">
        <span class="note-kicker">Evidence record</span>
        ${evidence ? `
          <p>${externalGitHubLink(evidence.pr_url, "Pull request")}</p>
          <p><code>${escapeHtml(evidence.head_sha)}</code></p>
          <p>${externalGitHubLink(evidence.actions_run_url, "GitHub Actions run")}</p>
        ` : "<p>No valid public evidence manifest has been recorded yet.</p>"}
        ${evidenceSnapshot?.verification_status ? `
          <div class="snapshot-summary">
            <span>Validator snapshot</span>
            <strong>${escapeHtml(statusLabel(evidenceSnapshot.verification_status))}</strong>
            ${Number.isInteger(evidenceSnapshot.changed_files_total) ? `<small>${evidenceSnapshot.changed_files_total} changed files captured</small>` : ""}
          </div>
        ` : ""}
        ${relationshipChecks.length ? `
          <ul class="evidence-checks">
            ${relationshipChecks.map((check) => `<li class="${check.passed ? "passed" : "failed"}"><span aria-hidden="true">${check.passed ? "✓" : "×"}</span>${escapeHtml(check.label)}</li>`).join("")}
          </ul>
        ` : ""}
        <small>Only canonical public GitHub fields are displayed. Raw manifests and logs are not injected into the page.</small>
      </aside>
    </div>
    ${hasSettlement && !isResolved ? `
      <div class="settlement-card">
        <div><span>Worker allocation</span><strong>${escapeHtml(formatGen(workerAmount))}</strong></div>
        <div><span>Requester allocation</span><strong>${escapeHtml(formatGen(requesterAmount))}</strong></div>
      </div>
      <p class="payout-confirmation ${escapeHtml(receiptState.tone)}">${escapeHtml(receiptState.message)}</p>
    ` : ""}
    ${task.decisionReason ? `<p class="decision-note"><strong>Recorded reason:</strong> ${escapeHtml(task.decisionReason)}</p>` : ""}
    <div class="case-actions">
      <div>
        <span class="note-kicker">Your role</span>
        <strong>${escapeHtml(role)}</strong>
      </div>
      <div class="case-action-buttons">
        <button type="button" class="secondary-button" data-action="copy-case">Copy share URL</button>
        <button type="button" class="secondary-button" data-action="download-receipt">Download receipt</button>
        <button type="button" class="text-button" data-action="reload-case">Refresh chain state</button>
      </div>
    </div>
    ${renderTaskActions(task, role, status)}
  `;
  renderExceptionCenter();
}

function userRole(task) {
  if (!state.walletAddress) return "Connect a wallet to act";
  if (addressesMatch(task.requester, state.walletAddress)) return "Requester";
  if (addressesMatch(task.worker, state.walletAddress)) return "Worker";
  return "Read-only participant";
}

function reviewDraftForTask(task) {
  if (state.reviewDraft.taskId !== task.id) {
    state.reviewDraft = { taskId: task.id, choices: {}, notes: {} };
  }
  return state.reviewDraft;
}

function findingReviewChoice(finding) {
  const normalized = String(finding || "").toUpperCase();
  if (normalized === "PASS") return "satisfied";
  if (normalized === "FAIL") return "disputed";
  if (normalized === "INCONCLUSIVE") return "clarification";
  return "";
}

function reviewChoiceLabel(choice) {
  if (choice === "satisfied") return "Satisfied";
  if (choice === "disputed") return "Disputed";
  if (choice === "clarification") return "Needs clarification";
  return "Not assessed";
}

function pendingRequesterReviewWrite(taskId) {
  return scopedTransactions().find((entry) =>
    entry.taskId === taskId &&
    ["Accept delivery", "Open dispute"].includes(entry.label) &&
    !["finalized", "failed"].includes(entry.lifecycle),
  ) || null;
}

function renderReviewEvidence(task, evidence) {
  return `
    <div class="review-evidence-lock" aria-label="Evidence under review">
      <div><span>Pull request</span><strong>${evidence ? externalGitHubLink(evidence.pr_url, "Open exact PR") : "Not recorded"}</strong></div>
      <div><span>Commit</span><code>${evidence ? escapeHtml(shortId(evidence.head_sha)) : "Not recorded"}</code></div>
      <div><span>CI evidence</span><strong>${evidence ? externalGitHubLink(evidence.actions_run_url, "Open exact run") : "Not recorded"}</strong></div>
      <div><span>Terms</span><code title="${escapeHtml(task.configSha256)}">${/^[a-f0-9]{64}$/.test(task.configSha256) ? escapeHtml(shortId(task.configSha256)) : "Unavailable"}</code></div>
    </div>
  `;
}

function renderRequesterReviewRoom(task, role, status) {
  if (!task.criteria.length || !["SUBMITTED", "RESOLVED"].includes(status)) return "";
  const evidence = parseEvidenceForDisplay(task.evidenceManifest, task.repositoryUrl);

  if (status === "RESOLVED") {
    const choices = Object.fromEntries(task.criteria.map((criterion) => [criterion.id, findingReviewChoice(criterion.finding)]));
    const passedBps = settlementShareBps(task);
    const requesterAccepted = isRequesterAcceptedTask(task);
    return `
      <section class="requester-review-room resolved-review" aria-label="${requesterAccepted ? "Final requester review" : "Final adjudication review"}">
        <div class="review-room-heading">
          <div><span class="note-kicker">Review room · finalized</span><h4>${requesterAccepted ? "Requester acceptance behind the settlement." : "Criterion decisions behind the settlement."}</h4></div>
          <span class="review-state-chip finalized">Finalized onchain</span>
        </div>
        ${renderReviewEvidence(task, evidence)}
        <div class="review-criteria-list">
          ${task.criteria.map((criterion, index) => {
            const choice = choices[criterion.id];
            return `
              <div class="review-criterion ${escapeHtml(choice || "unreviewed")}">
                <div class="review-criterion-copy"><span>${String(index + 1).padStart(2, "0")} · ${Number(criterion.weightBps || 0).toLocaleString()} bps</span><strong>${escapeHtml(criterion.description)}</strong>${criterion.rationale ? `<small>${escapeHtml(criterion.rationale)}</small>` : ""}</div>
                <span class="review-state-chip ${escapeHtml(choice || "unreviewed")}">${escapeHtml(reviewChoiceLabel(choice))}</span>
              </div>
            `;
          }).join("")}
        </div>
        <div class="review-projection finalized">
          <div class="review-projection-copy"><span>${requesterAccepted ? "Accepted allocation" : "Adjudicated allocation"}</span><strong>${escapeHtml(formatBps(passedBps))} worker · ${escapeHtml(formatBps(BASIS_POINTS - passedBps))} requester</strong></div>
          <div class="review-mini-bar" role="img" aria-label="${escapeHtml(formatBps(passedBps))} worker allocation and ${escapeHtml(formatBps(BASIS_POINTS - passedBps))} requester allocation"><span style="width:${passedBps / 100}%"></span></div>
        </div>
      </section>
    `;
  }

  const draft = reviewDraftForTask(task);
  const summary = summarizeReview(task.criteria, draft.choices);
  const reason = buildStructuredDisputeReason({
    criteria: task.criteria,
    choices: draft.choices,
    notes: draft.notes,
    headSha: evidence?.head_sha || "",
  });
  const canReview = role === "Requester";
  const walletOnNetwork = state.walletChainId === currentNetwork().chainId;
  const pendingWrite = pendingRequesterReviewWrite(task.id);
  const canSign = canReview && state.contractVerified && Boolean(state.walletClient) && walletOnNetwork && !pendingWrite;
  const workerAmount = (asBigInt(task.escrowAmount) * BigInt(summary.satisfiedBps)) / BigInt(BASIS_POINTS);
  const requesterAmount = asBigInt(task.escrowAmount) - workerAmount;

  return `
    <form class="requester-review-room" data-form="review-delivery">
      <div class="review-room-heading">
        <div><span class="note-kicker">Requester review room</span><h4>Assess the submitted work criterion by criterion.</h4></div>
        <span class="review-progress">${summary.assessedCount}/${summary.totalCount} assessed</span>
      </div>
      <p class="review-room-intro">Review the exact public evidence below. Your selections prepare either full acceptance or a structured public dispute for validator review.</p>
      ${renderReviewEvidence(task, evidence)}
      <div class="review-criteria-list">
        ${task.criteria.map((criterion, index) => {
          const id = String(criterion.id);
          const choice = draft.choices[id] || "";
          return `
            <fieldset class="review-criterion ${escapeHtml(choice || "unreviewed")}" ${canReview ? "" : "disabled"}>
              <legend class="sr-only">Review criterion ${index + 1}</legend>
              <div class="review-criterion-copy"><span>${String(index + 1).padStart(2, "0")} · ${Number(criterion.weightBps || 0).toLocaleString()} bps</span><strong>${escapeHtml(criterion.description)}</strong></div>
              <div class="review-choice-group">
                ${[
                  ["satisfied", "Satisfied"],
                  ["disputed", "Disputed"],
                  ["clarification", "Needs clarification"],
                ].map(([value, label]) => `
                  <label class="review-choice ${value}">
                    <input type="radio" name="review-${index}" value="${value}" data-review-choice data-criterion-id="${escapeHtml(id)}" ${choice === value ? "checked" : ""}>
                    <span>${label}</span>
                  </label>
                `).join("")}
              </div>
              ${choice === "disputed" || choice === "clarification" ? `
                <label class="review-note"><span>${choice === "disputed" ? "What failed?" : "What needs clarification?"}</span><textarea maxlength="220" data-review-note data-criterion-id="${escapeHtml(id)}" placeholder="Point validators to the missing or conflicting public evidence.">${escapeHtml(draft.notes[id] || "")}</textarea></label>
              ` : ""}
            </fieldset>
          `;
        }).join("")}
      </div>
      <div class="review-projection">
        <div class="review-projection-copy"><span>Projected split from this assessment</span><strong>${escapeHtml(formatBps(summary.satisfiedBps))} worker · ${escapeHtml(formatBps(summary.requesterBps))} requester</strong><small>${escapeHtml(formatGen(workerAmount))} / ${escapeHtml(formatGen(requesterAmount))}. This is the requester’s assessment, not an adjudication prediction.</small></div>
        <div class="review-mini-bar" role="img" aria-label="Projected ${escapeHtml(formatBps(summary.satisfiedBps))} worker allocation and ${escapeHtml(formatBps(summary.requesterBps))} requester allocation"><span style="width:${summary.satisfiedBps / 100}%"></span></div>
      </div>
      ${summary.flagged.length ? `<div class="structured-reason"><span>Structured dispute preview</span><p data-review-reason-preview>${escapeHtml(reason || "Assess every criterion to complete the public dispute statement.")}</p></div>` : ""}
      ${!canReview
        ? `<p class="review-gate">Connect the requester wallet to complete this review.</p>`
        : !state.walletClient
          ? `<p class="review-gate">Reconnect the requester wallet before requesting a signature.</p>`
          : !walletOnNetwork
            ? `<p class="review-gate">Switch the wallet to ${escapeHtml(currentNetwork().label)} before requesting a signature.</p>`
            : !state.contractVerified
              ? `<p class="review-gate">Verify the configured contract before requesting a signature.</p>`
              : pendingWrite
                ? `<p class="review-gate">${escapeHtml(pendingWrite.label)} is already ${escapeHtml(statusLabel(pendingWrite.lifecycle))}. Wait for its final result before requesting another settlement action.</p>`
                : ""}
      <div class="form-footer review-actions">
        <button class="secondary-button" name="decision" value="dispute" type="submit" ${!canSign || !summary.complete || summary.flagged.length === 0 ? "disabled" : ""}>Open structured dispute</button>
        <button class="primary-button" name="decision" value="accept" type="submit" ${!canSign || !summary.allSatisfied ? "disabled" : ""}>Accept full payment</button>
      </div>
    </form>
  `;
}

function adjudicationPreflight(task) {
  const evidence = parseEvidenceForDisplay(task.evidenceManifest, task.repositoryUrl);
  const snapshotChecks = evidenceRelationshipChecks(parseRecord(task.evidenceSnapshot));
  const discovery = activeDeliveryDiscovery(task);
  const sourceCandidate = evidence
    ? discovery.candidates.find((candidate) =>
      candidate.headSha === evidence.head_sha && candidate.configMatches && candidate.run,
    )
    : null;
  const validatorVerified = snapshotChecks.length > 0 && snapshotChecks.every((check) => check.passed);
  const sourceVerified = Boolean(sourceCandidate) || validatorVerified;
  const checks = [
    { label: "Canonical public pull request and immutable commit recorded", passed: Boolean(evidence) },
    { label: "Successful pull-request CI run bound to that commit", passed: Boolean(evidence && (sourceCandidate?.run || validatorVerified)) },
    { label: "Root docket.yml matches the frozen onchain hash", passed: sourceVerified },
    { label: "Structured public dispute reason recorded", passed: String(task.decisionReason || "").trim().length >= 10 },
    { label: "Criterion weights define the complete escrow", passed: task.criteria.reduce((total, item) => total + Number(item.weightBps || 0), 0) === BASIS_POINTS },
  ];
  return {
    evidence,
    checks,
    passed: checks.every((check) => check.passed),
    sourceVerified,
    checking: discovery.state === "searching",
  };
}

function protocolStatusLabel(value) {
  return String(value || "Awaiting submission")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
}

function adjudicationStageStates(task, txId) {
  const lifecycle = state.adjudication.txId === txId ? state.adjudication.lifecycle : null;
  return deriveAdjudicationStages({
    taskStatus: task.status,
    storedStatus: lifecycle?.storedStatus || "",
    decisionActive: lifecycle?.decisionActive,
    canAppeal: state.adjudication.canAppeal,
    hasTx: Boolean(txId),
  });
}

function renderAdjudicationLaunchpad(task, role, status) {
  if (isRequesterAcceptedTask(task)) return "";
  const txId = resolutionTransactionIdForTask(task);
  if (!['DISPUTED', 'RESOLVED'].includes(status) && !txId) return "";
  const preflight = adjudicationPreflight(task);
  const lifecycleState = state.adjudication.txId === txId ? state.adjudication : null;
  const lifecycle = lifecycleState?.lifecycle;
  const stages = adjudicationStageStates(task, txId);
  const needsEvidence = status === "NEEDS_EVIDENCE";
  const isParty = role === "Requester" || role === "Worker";
  const walletOnNetwork = state.walletChainId === currentNetwork().chainId;
  const mayResolve = !txId && status === "DISPUTED" && preflight.passed && isParty && state.contractVerified && Boolean(state.walletClient) && walletOnNetwork;
  const resolutionBound = state.resolutionProof?.hash === txId && state.resolutionProof?.bound === true;
  const mayAppeal = Boolean(txId && resolutionBound && lifecycleState?.canAppeal && state.walletClient && walletOnNetwork);
  const appealCharge = lifecycleState?.appealCharge;
  const isFinalized = !needsEvidence && (String(lifecycle?.storedStatus || "").toLowerCase() === "finalized" || status === "RESOLVED");
  const protocolState = needsEvidence
    ? "Evidence required"
    : isFinalized
    ? "Finalized"
    : lifecycleState?.state === "loading"
      ? "Reading protocol lifecycle…"
      : lifecycle
        ? protocolStatusLabel(lifecycle.storedStatus)
        : txId
          ? "Lifecycle refresh required"
          : "Ready to request consensus";

  return `
    <section class="adjudication-launchpad" aria-label="AI adjudication launchpad">
      <div class="adjudication-heading">
        <div><span class="note-kicker">AI adjudication launchpad</span><h4>Take the dispute from evidence to finality.</h4></div>
        <span class="protocol-state ${isFinalized ? "finalized" : lifecycleState?.canAppeal ? "appealable" : ""}">${escapeHtml(protocolState)}</span>
      </div>
      <ol class="adjudication-stages">
        ${[["packet", "Dispute packet"], ["consensus", "Committee review"], ["decision", "Decision"], ["appeal", "Appeal window"], ["finality", "Finality"]].map(([key, label], index) => `<li class="${stages[key]}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${label}</strong></li>`).join("")}
      </ol>
      <div class="adjudication-packet">
        <div class="packet-summary">
          <span>Validator packet</span>
          <strong>${escapeHtml(task.criteria.length)} weighted criteria · ${escapeHtml(formatGen(task.escrowAmount))}</strong>
          <p>${escapeHtml(task.decisionReason || "No dispute reason has been recorded.")}</p>
          ${preflight.evidence ? `<div class="packet-links">${externalGitHubLink(preflight.evidence.pr_url, "Exact PR ↗")}${externalGitHubLink(preflight.evidence.actions_run_url, "Exact CI run ↗")}<code>${escapeHtml(shortId(preflight.evidence.head_sha, 10, 8))}</code></div>` : ""}
        </div>
        <ul class="adjudication-checks">
          ${preflight.checks.map((check) => `<li class="${check.passed ? "passed" : "failed"}"><span aria-hidden="true">${check.passed ? "✓" : "×"}</span><span>${escapeHtml(check.label)}</span></li>`).join("")}
        </ul>
      </div>
      <div class="criterion-impact-grid">
        ${task.criteria.map((criterion) => {
          const amount = (asBigInt(task.escrowAmount) * BigInt(Math.max(0, Number(criterion.weightBps) || 0))) / BigInt(BASIS_POINTS);
          return `<div><span>${escapeHtml(String(criterion.id))}</span><strong>${escapeHtml(formatBps(criterion.weightBps))}</strong><small>${escapeHtml(formatGen(amount))} at stake</small></div>`;
        }).join("")}
      </div>
      ${txId ? `
        <div class="consensus-record">
          <div><span>Resolution transaction</span><a href="${escapeHtml(explorerUrl(txId))}" target="_blank" rel="noreferrer">${escapeHtml(shortId(txId, 12, 10))} ↗</a></div>
          <div><span>Stored status</span><strong>${escapeHtml(protocolStatusLabel(lifecycle?.storedStatus || (isFinalized ? "Finalized" : "Unknown")))}</strong></div>
          <div><span>Projected status</span><strong>${escapeHtml(protocolStatusLabel(lifecycle?.projectedStatus || (isFinalized ? "Finalized" : "Unknown")))}</strong></div>
          <div><span>Protocol action</span><strong>${escapeHtml(protocolStatusLabel(lifecycle?.resolutionAction || (isFinalized ? "NoOp" : "Unknown")))}</strong></div>
        </div>
        <div class="appeal-panel ${needsEvidence ? "evidence-required" : lifecycleState?.canAppeal ? "eligible" : ""}">
          <div>
            <span>${needsEvidence ? "Recovery checkpoint" : "Native consensus appeal"}</span>
            <strong>${needsEvidence ? "Fresh public evidence is required" : isFinalized ? "Appeal window closed" : lifecycleState?.canAppeal ? "This decision can be appealed" : "No appeal action currently available"}</strong>
            <p>${needsEvidence
              ? "GenLayer could not verify the submitted public source, so every criterion is inconclusive and no payout moved. The worker can supplement the manifest; the requester can recover only after the contract window."
              : lifecycleState?.canAppeal
              ? `The current protocol charge is ${escapeHtml(formatGen(appealCharge ?? 0n))}. It includes the appeal bond and funding for a fresh validator committee.`
              : "Docket reads eligibility from GenLayer. It never assumes a fixed appeal window or hardcodes the bond."}</p>
          </div>
          <div class="appeal-actions">
            <button type="button" class="text-button" data-action="refresh-adjudication" ${lifecycleState?.state === "loading" ? "disabled" : ""}>${lifecycleState?.state === "loading" ? "Refreshing…" : "Refresh lifecycle"}</button>
            ${!needsEvidence && lifecycleState?.canAppeal ? `<form data-form="appeal-resolution"><button type="submit" class="secondary-button" ${mayAppeal ? "" : "disabled"}>Appeal for ${escapeHtml(formatGen(appealCharge ?? 0n))}</button></form>` : ""}
          </div>
        </div>
      ` : `
        <div class="launch-consensus-row">
          <div><span>${preflight.passed ? "Preflight passed" : "Preflight required"}</span><p>${preflight.passed ? "The browser has verified the public packet. GenLayer validators will fetch and judge it independently." : "Recheck the recorded GitHub source before asking validators to adjudicate this dispute."}</p></div>
          <div>
            <button type="button" class="text-button" data-action="run-adjudication-preflight" ${preflight.checking ? "disabled" : ""}>${preflight.checking ? "Checking GitHub…" : "Run evidence preflight"}</button>
            <form data-form="resolve-dispute"><button class="primary-button" type="submit" ${mayResolve ? "" : "disabled"}>Request GenLayer consensus</button></form>
          </div>
        </div>
      `}
      ${!txId && preflight.passed && !mayResolve ? `<p class="adjudication-gate">${!isParty ? "Connect the requester or worker wallet to launch adjudication." : !state.walletClient ? "Reconnect the case-party wallet to launch adjudication." : !walletOnNetwork ? `Switch the wallet to ${escapeHtml(currentNetwork().label)} before signing.` : "Verify the configured contract before signing."}</p>` : ""}
      ${lifecycleState?.error ? `<p class="adjudication-error">${escapeHtml(lifecycleState.error)}</p>` : ""}
      ${txId && state.resolutionProof?.state === "invalid" ? `<p class="adjudication-error">Appeal controls are disabled because this transaction is not bound to this case’s resolve_dispute call.</p>` : ""}
      <p class="protocol-note">${needsEvidence ? "The consensus transaction is final, but this case has no payout. Supply a new public evidence manifest before requesting another adjudication." : "An accepted result remains provisional during GenLayer’s appeal window. Payout is confirmed only after the resolution transaction reaches finality."}</p>
    </section>
  `;
}

function renderTaskActions(task, role, status) {
  const panels = [renderDeliveryConsole(task, role, status), renderRequesterReviewRoom(task, role, status), renderAdjudicationLaunchpad(task, role, status)].filter(Boolean);
  if (!state.walletAddress) {
    if (["OPEN", "NEEDS_EVIDENCE", "SUBMITTED", "DISPUTED"].includes(status)) {
      panels.push(`<div class="action-panel muted"><p>Connect the requester or worker wallet to submit a permitted onchain action.</p></div>`);
    }
    return `<div class="task-action-stack">${panels.join("")}</div>`;
  }
  if (!state.contractVerified) {
    panels.push(`<div class="action-panel muted"><p>Verify the configured contract before it can request a signature.</p></div>`);
    return `<div class="task-action-stack">${panels.join("")}</div>`;
  }

  const workerCanEscalate = role === "Worker" && status === "SUBMITTED";
  const requesterCanRecover = role === "Requester" && status === "NEEDS_EVIDENCE";
  const requesterCanCancel = role === "Requester" && status === "OPEN";
  const recoveryWindow = requesterCanRecover
    ? deriveRecoveryWindow({ status, createdAt: task.createdAt, inconclusiveAt: task.inconclusiveAt })
    : null;

  const recoveryDate = (seconds) => {
    if (!Number.isSafeInteger(seconds)) return "";
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(seconds * 1000));
    } catch {
      return new Date(seconds * 1000).toISOString();
    }
  };

  if (workerCanEscalate) {
    panels.push(`
      <form class="action-panel" data-form="escalate-submission">
        <div><span class="note-kicker">Worker escalation</span><h4>Escalate a submission after the contract window.</h4></div>
        <label><span>Reason for review</span><textarea name="reason" maxlength="800" placeholder="Describe why the submitted public evidence should be reviewed. This text is public onchain; do not enter secrets."></textarea></label>
        <p>The contract, not this browser, enforces the 24-hour waiting period after submission.</p>
        <button class="secondary-button" type="submit">Escalate submission</button>
      </form>
    `);
  }
  if (requesterCanRecover) {
    panels.push(`
      <form class="action-panel" data-form="recover-case">
        <div><span class="note-kicker">Requester recovery</span><h4>Recover an inconclusive case after its contract window.</h4></div>
        <p>${recoveryWindow?.state === "waiting"
          ? `The contract window is still closed. Recovery may open in ${escapeHtml(formatRecoveryCountdown(recoveryWindow.remainingSeconds))}, around ${escapeHtml(recoveryDate(recoveryWindow.eligibleAt))}. Refresh the case after that time; the contract remains authoritative.`
          : recoveryWindow?.state === "eligible"
            ? "The projected contract window has elapsed. You can request recovery now; the contract remains authoritative."
            : "The chain did not return recovery timestamps. The contract enforces the required waiting period and remains authoritative."}</p>
        <button class="secondary-button" type="submit" ${recoveryWindow?.state === "waiting" ? "disabled" : ""}>Request recovery</button>
      </form>
    `);
  }
  if (requesterCanCancel) {
    panels.push(`
      <form class="action-panel compact-action" data-form="cancel-case">
        <p>If no delivery has been submitted, the requester can cancel under the contract rules.</p>
        <button class="text-button danger-button" type="submit">Cancel funded docket</button>
      </form>
    `);
  }
  if (!panels.length) {
    panels.push(`<div class="action-panel muted"><p>There is no available action for this connected wallet at the current onchain status.</p></div>`);
  }
  return `<div class="task-action-stack">${panels.join("")}</div>`;
}

function evidenceFields(task) {
  return `
    <div class="evidence-fields">
      <label class="manifest-import"><span>Paste the Docket GitHub Action manifest</span><textarea name="manifestJson" maxlength="2000" required placeholder='{"pr_url":"…","head_sha":"…","actions_run_url":"…"}'></textarea></label>
      <label class="manifest-import"><span>Paste the matching Action proof</span><textarea name="proofJson" maxlength="4000" required placeholder='{"task_id":"dkt-…","repository_url":"…","manifest_sha256":"…","config":{"path":"docket.yml","sha256":"…"}}'></textarea></label>
      <p class="evidence-guidance">Copy both JSON objects from the Docket evidence job summary. The browser checks their binding before submission; disputed settlement independently hashes the public root <code>docket.yml</code> at the submitted PR head.</p>
    </div>
  `;
}

function caseMatchesActiveScope(entry) {
  const scope = activeTransactionScope();
  if (entry.network && entry.network !== scope.network) return false;
  if (entry.contractAddress && normalizeAddress(entry.contractAddress) !== scope.contractAddress) return false;
  if (scope.walletAddress && entry.walletAddress && normalizeAddress(entry.walletAddress) !== scope.walletAddress) return false;
  return true;
}

function transactionMatchesCaseScope(transaction, entry) {
  const network = String(entry.network || currentNetwork().id);
  const contractAddress = normalizeAddress(entry.contractAddress || state.config.contractAddress);
  const walletAddress = normalizeAddress(entry.walletAddress);
  return transaction.network === network &&
    normalizeAddress(transaction.contractAddress) === contractAddress &&
    (!walletAddress || normalizeAddress(transaction.walletAddress) === walletAddress);
}

function renderRecentCases() {
  const storedCases = readJson(CASES_KEY, []);
  const cases = (Array.isArray(storedCases) ? storedCases : []).filter(caseMatchesActiveScope);
  if (!Array.isArray(cases) || !cases.length) {
    ui.recentCases.className = "recent-cases empty-state";
    ui.recentCases.textContent = "No local cases for this contract and wallet yet.";
    return;
  }
  ui.recentCases.className = "recent-cases";
  ui.recentCases.innerHTML = cases.slice(0, 12).map((entry) => {
    const registration = state.transactions.find((transaction) =>
      transaction.taskId === entry.id &&
      transaction.label === "Fund and create docket" &&
      !transaction.isChild &&
      transactionMatchesCaseScope(transaction, entry));
    const registrationText = registration
      ? registration.lifecycle === "finalized"
        ? "Registration finalized"
        : registration.lifecycle === "failed"
          ? "Registration failed"
          : "Registration pending"
      : "Opened from configured contract";
    return `
      <button type="button" class="recent-case" data-action="open-recent-case" data-task-id="${escapeHtml(entry.id)}">
        <span class="recent-case-id">${escapeHtml(entry.id)}</span>
        <strong>${escapeHtml(entry.title || "Untitled docket")}</strong>
        <small>${escapeHtml(entry.repositoryUrl || "Public GitHub repository")} · ${escapeHtml(registrationText)}</small>
        <span>Open →</span>
      </button>
    `;
  }).join("");
}

function lifecycleLabel(entry) {
  const lifecycle = entry.lifecycle || "submitted";
  return ({
    submitted: "Submitted",
    awaiting: "Awaiting decision",
    finalizing: "Finalizing",
    finalized: "Finalized",
    failed: "Execution failed",
  })[lifecycle] || statusLabel(lifecycle);
}

function activeTransactionScope() {
  return {
    network: currentNetwork().id,
    contractAddress: normalizeAddress(state.config.contractAddress),
    walletAddress: normalizeAddress(state.walletAddress),
  };
}

function transactionMatchesActiveScope(entry) {
  const scope = activeTransactionScope();
  return entry.network === scope.network &&
    normalizeAddress(entry.contractAddress) === scope.contractAddress &&
    (!scope.walletAddress || normalizeAddress(entry.walletAddress) === scope.walletAddress);
}

function scopedTransactions() {
  return (Array.isArray(state.transactions) ? state.transactions : [])
    .filter(transactionMatchesActiveScope);
}

function renderTransactions() {
  const entries = scopedTransactions();
  if (!entries.length) {
    ui.transactionList.className = "transaction-list empty-state";
    ui.transactionList.textContent = "No wallet requests have been submitted in this browser.";
    renderExceptionCenter();
    return;
  }
  ui.transactionList.className = "transaction-list";
  ui.transactionList.innerHTML = entries.slice(0, 20).map((entry) => {
    const childLinks = Array.isArray(entry.children) && entry.children.length
      ? `<div class="child-transactions">${entry.children.map((child) => `<a href="${escapeHtml(explorerUrl(child))}" target="_blank" rel="noreferrer">Payout message ${escapeHtml(shortId(child))} ↗</a>`).join("")}</div>`
      : "";
    const parentLink = isTransactionId(entry.hash)
      ? `<a href="${escapeHtml(explorerUrl(entry.hash))}" target="_blank" rel="noreferrer">${escapeHtml(shortId(entry.hash))} ↗</a>`
      : `<span>${escapeHtml(shortId(entry.hash))}</span>`;
    return `
      <article class="transaction-row">
        <div>
          <span class="tx-lifecycle ${escapeHtml(entry.lifecycle || "submitted")}">${escapeHtml(lifecycleLabel(entry))}</span>
          <strong>${escapeHtml(entry.label || "Contract request")}</strong>
          <small>${escapeHtml(entry.taskId || "No case ID")}</small>
        </div>
        <div class="tx-right">
          ${parentLink}
          <small>${escapeHtml(entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "")}</small>
        </div>
        ${entry.error ? `<p class="tx-error">${escapeHtml(entry.error)}</p>` : ""}
        ${childLinks}
      </article>
    `;
  }).join("");
  renderExceptionCenter();
}

function renderExceptionCenter() {
  if (!ui.exceptionCenter) return;
  const items = deriveExceptionItems({
    task: state.activeTask,
    transactions: scopedTransactions(),
    resolutionProof: state.resolutionProof,
  });
  if (!items.length) {
    ui.exceptionCenter.className = "exception-center empty-state";
    ui.exceptionCenter.textContent = "No exceptions need attention in this browser.";
    return;
  }
  ui.exceptionCenter.className = "exception-center";
  ui.exceptionCenter.innerHTML = items.map((item) => `
    <article class="exception-card ${escapeHtml(item.severity)}">
      <div class="exception-card-topline">
        <span class="exception-badge">${escapeHtml(item.badge)}</span>
        ${item.taskId ? `<code>${escapeHtml(item.taskId)}</code>` : ""}
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.detail)}</p>
      <div class="exception-card-actions">
        ${item.hash && isTransactionId(item.hash) ? `<a href="${escapeHtml(explorerUrl(item.hash))}" target="_blank" rel="noreferrer">Inspect transaction ↗</a>` : ""}
        ${item.action === "open-exception-case" && item.taskId
          ? `<button type="button" class="secondary-button" data-action="open-exception-case" data-task-id="${escapeHtml(item.taskId)}">${escapeHtml(item.actionLabel)}</button>`
          : `<button type="button" class="secondary-button" data-action="refresh-transactions">${escapeHtml(item.actionLabel)}</button>`}
      </div>
    </article>
  `).join("");
}

function toast(message, type = "info") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  ui.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 6000);
}

function setBusy(key, busy) {
  if (busy) state.busy.add(key);
  else state.busy.delete(key);
}

function setFormBusy(form, busy) {
  if (!(form instanceof HTMLFormElement)) return;
  form.setAttribute("aria-busy", busy ? "true" : "false");
  for (const button of form.querySelectorAll("button")) {
    if (busy) {
      button.dataset.docketWasDisabled = button.disabled ? "true" : "false";
      button.disabled = true;
    } else {
      button.disabled = button.dataset.docketWasDisabled === "true";
      delete button.dataset.docketWasDisabled;
    }
  }
}

function writeReady() {
  if (!state.contractVerified) throw new Error("Verify the deployed Docket v2 contract before requesting a signature.");
  if (!state.walletClient || !isAddress(state.walletAddress)) throw new Error("Connect a GenLayer-compatible wallet first.");
  if (!isAddress(state.config.contractAddress)) throw new Error("Enter a valid deployed contract address.");
  if (state.walletChainId && state.walletChainId !== currentNetwork().chainId) {
    throw new Error(`Wallet reports chain ${state.walletChainId}. Switch to ${currentNetwork().label} and reconnect before signing.`);
  }
}

async function fetchReleaseManifest() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}release-manifest.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Release manifest returned ${response.status}.`);
    const manifest = await response.json();
    state.release = { ...DEFAULT_RELEASE, ...manifest };
  } catch (error) {
    state.release = { ...DEFAULT_RELEASE };
    toast(`Release manifest unavailable: ${formatError(error)}`, "error");
  }

  const manifestNetwork = NETWORKS[state.release.network] ? state.release.network : "";
  const stored = readJson(CONFIG_KEY, {});
  if (!stored.network && manifestNetwork) state.config.network = manifestNetwork;
  if (!stored.contractAddress && isAddress(state.release.contractAddress)) state.config.contractAddress = state.release.contractAddress;
  writeJson(CONFIG_KEY, state.config);

  ui.networkSelect.value = state.config.network;
  ui.contractAddress.value = state.config.contractAddress;
  renderReleaseMetadata();
  renderHeader();
  renderTransactions();

  if (isAddress(state.config.contractAddress)) {
    await verifyContract({ quiet: true });
  } else {
    setReleaseStatus("Awaiting a deployed Docket v2 address. This build cannot create or settle a fixture.", "neutral");
    renderVerification();
  }
}

async function buildReadClient() {
  const network = currentNetwork();
  const sdk = await loadSdk();
  state.readClient = sdk.createClient({ chain: sdk.chains[network.id] });
  return state.readClient;
}

async function verifyContract({ quiet = false } = {}) {
  const address = state.config.contractAddress.trim();
  state.contractVerified = false;
  state.verification = null;
  renderHeader();
  renderVerification();
  renderTask();
  if (!isAddress(address)) {
    state.verification = { ok: false, message: "Enter a 20-byte 0x contract address before verification." };
    renderVerification();
    setReleaseStatus("Release address is not configured.", "neutral");
    return false;
  }
  if (state.release.status === "deployed" && !releasePinsCurrentConfiguration()) {
    state.verification = {
      ok: false,
      message: "This release manifest is pinned to a different network or contract address. Select its exact release configuration before writes can be enabled.",
    };
    renderVerification();
    setReleaseStatus("Configured address does not match the pinned public release.", "bad");
    return false;
  }

  const key = "verify-contract";
  setBusy(key, true);
  const button = document.querySelector('[data-action="verify-contract"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Verifying…";
  }
  try {
    const client = await buildReadClient();
    const [count, schema, code] = await Promise.all([
      client.readContract({
        address,
        functionName: "get_task_count",
        args: [],
        transactionHashVariant: "latest-final",
      }),
      client.getContractSchema(address),
      client.getContractCode(address),
    ]);
    const methods = schema?.methods && typeof schema.methods === "object" ? schema.methods : {};
    const missing = REQUIRED_CONTRACT_METHODS.filter((method) => !methods[method]);
    const malformed = REQUIRED_CONTRACT_METHODS.filter((method) =>
      methods[method] &&
      (!Array.isArray(methods[method].params) ||
        methods[method].params.length !== CONTRACT_METHOD_ARITY[method]),
    );
    const codeLength = typeof code === "string" ? code.length : JSON.stringify(code || "").length;
    if (missing.length || malformed.length || !codeLength) {
      if (missing.length) throw new Error(`The address does not expose the required v2 methods: ${missing.join(", ")}.`);
      if (malformed.length) throw new Error(`The address exposes incompatible v2 method arguments: ${malformed.join(", ")}.`);
      throw new Error("The address returned no readable contract code.");
    }

    const releasePinsAddress = releasePinsCurrentConfiguration();
    const configuredHash = String(state.release.sourceSha256 || "").trim().toLowerCase();
    if (releasePinsAddress) {
      if (!/^[a-f0-9]{64}$/.test(configuredHash)) {
        throw new Error("A deployed release manifest must pin the exact source SHA-256.");
      }
      if (!isTransactionId(state.release.deploymentTxId)) {
        throw new Error("A deployed release manifest must include its finalized deployment transaction ID.");
      }
      const actualHash = await sha256Hex(String(code));
      if (actualHash !== configuredHash) {
        throw new Error("The deployed code does not match the source SHA-256 pinned in this release manifest.");
      }
      const deployment = await client.getTransaction({ hash: state.release.deploymentTxId });
      if (
        String(deployment?.statusName || "").toUpperCase() !== "FINALIZED" ||
        deployment?.txExecutionResultName !== "FINISHED_WITH_RETURN"
      ) {
        throw new Error("The pinned deployment transaction is not finalized with a successful contract result.");
      }
    }

    state.contractVerified = true;
    state.verification = {
      ok: true,
      mode: releasePinsAddress ? "manifest" : "developer",
      message: releasePinsAddress
        ? `Verified manifest-pinned code and ${REQUIRED_CONTRACT_METHODS.length} required v2 methods at the configured address.`
        : `Verified get_task_count() and ${REQUIRED_CONTRACT_METHODS.length} required v2 methods in developer configuration.`,
      detail: `Current task count: ${String(count)} · readable code: ${codeLength.toLocaleString()} characters${releasePinsAddress ? " · configured source hash matched · referenced transaction finalized" : ""}`,
    };
    setReleaseStatus(
      releasePinsAddress
        ? `Verified the manifest-pinned Docket configuration on ${currentNetwork().label}. Reads and wallet requests are available.`
        : `Developer contract verified on ${currentNetwork().label}. It is not a pinned public release.`,
      "good",
    );
    if (!quiet) toast(releasePinsAddress ? "Manifest-pinned Docket code verified for this browser." : "Developer contract interface verified for this browser.", "success");
    if (state.activeTaskId) await loadTask(state.activeTaskId, { quiet: true });
    refreshPendingTransactions({ quiet: true });
    return true;
  } catch (error) {
    state.verification = { ok: false, message: formatError(error) };
    setReleaseStatus("Contract verification failed. Reads and writes remain disabled.", "bad");
    if (!quiet) toast(`Verification failed: ${formatError(error)}`, "error");
    return false;
  } finally {
    setBusy(key, false);
    if (button) {
      button.disabled = false;
      button.textContent = "Verify contract";
    }
    renderVerification();
    renderHeader();
    renderReleaseMetadata();
  }
}

async function connectWallet() {
  if (!window.ethereum?.request) {
    toast("No EIP-1193 wallet was found. Install a GenLayer-compatible wallet and Snap, then try again.", "error");
    return;
  }
  const key = "connect-wallet";
  if (state.busy.has(key)) return;
  setBusy(key, true);
  ui.connectWallet.disabled = true;
  ui.connectWallet.textContent = "Connecting…";
  try {
    const network = currentNetwork();
    const sdk = await loadSdk();
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = Array.isArray(accounts) ? accounts[0] : "";
    if (!isAddress(address)) throw new Error("The wallet did not return a usable account.");
    state.walletClient = sdk.createClient({ chain: sdk.chains[network.id], account: address, provider: window.ethereum });
    await state.walletClient.connect(network.connectName);
    state.transactionKit = sdk.createTransactionKit({
      chain: sdk.chains[network.id],
      provider: window.ethereum,
      account: address,
    });
    const chainIdRaw = await window.ethereum.request({ method: "eth_chainId" });
    const chainId = typeof chainIdRaw === "string" ? Number.parseInt(chainIdRaw, 16) : Number(chainIdRaw);
    state.walletAddress = address;
    state.walletChainId = chainId;
    if (chainId && chainId !== network.chainId) {
      toast(`Wallet reports chain ${chainId}; Docket selected ${network.label}. The GenLayer wallet setup may still be switching networks.`, "info");
    } else {
      toast("Wallet connected. You can sign only after contract verification.", "success");
    }
  } catch (error) {
    state.walletClient = null;
    state.transactionKit = null;
    toast(`Wallet connection did not complete: ${formatError(error)}`, "error");
  } finally {
    setBusy(key, false);
    ui.connectWallet.disabled = false;
    renderHeader();
    renderTask();
    renderTransactions();
  }
}

function persistCase(entry) {
  const existing = readJson(CASES_KEY, []);
  const current = Array.isArray(existing) ? existing : [];
  const prior = current.find((item) => item.id === entry.id) || {};
  const scope = activeTransactionScope();
  const saved = {
    ...prior,
    ...entry,
    network: entry.network || prior.network || scope.network,
    contractAddress: entry.contractAddress || prior.contractAddress || scope.contractAddress,
    walletAddress: entry.walletAddress || prior.walletAddress || scope.walletAddress,
    lastOpenedAt: new Date().toISOString(),
  };
  const deduplicated = current.filter((item) => item.id !== entry.id);
  writeJson(CASES_KEY, [saved, ...deduplicated].slice(0, 30));
  renderRecentCases();
}

function upsertTransaction(entry) {
  const current = Array.isArray(state.transactions) ? state.transactions : [];
  const index = current.findIndex((item) => sameTransactionRecord(item, entry));
  const next = { ...entry, updatedAt: new Date().toISOString() };
  if (index >= 0) current[index] = { ...current[index], ...next };
  else current.unshift(next);
  state.transactions = current.slice(0, 40);
  writeJson(TRANSACTIONS_KEY, state.transactions);
  renderTransactions();
  renderRecentCases();
}

function transactionScopeFor(entry = {}) {
  return {
    network: String(entry.network || ""),
    contractAddress: normalizeAddress(entry.contractAddress),
    walletAddress: normalizeAddress(entry.walletAddress),
  };
}

function sameTransactionRecord(left, right) {
  const leftScope = transactionScopeFor(left);
  const rightScope = transactionScopeFor(right);
  return left?.hash === right?.hash &&
    leftScope.network === rightScope.network &&
    leftScope.contractAddress === rightScope.contractAddress &&
    leftScope.walletAddress === rightScope.walletAddress;
}

function transactionByHash(hash, scope = null) {
  const matches = state.transactions.filter((entry) => entry.hash === hash);
  if (!scope) return matches[0];
  return matches.find((entry) => sameTransactionRecord(entry, { hash, ...scope }));
}

async function runWrite({ functionName, args, value, label, taskId }) {
  writeReady();
  const key = `write:${functionName}:${taskId || ""}`;
  if (state.busy.has(key)) return;
  setBusy(key, true);
  try {
    if (!state.transactionKit) throw new Error("Reconnect the wallet to initialize Transaction Kit RC2.");
    const userValue = value === undefined ? 0n : value;
    const transaction = {
      kind: "write",
      address: state.config.contractAddress,
      method: functionName,
      args,
    };
    const quote = await state.transactionKit.estimate({ preset: "standard", userValue }, transaction);
    const submitted = await state.transactionKit.submit(quote, transaction);
    const hash = submitted?.genlayerTxId;
    if (!hash || typeof hash !== "string") throw new Error("The wallet did not return a GenLayer transaction ID.");
    const pending = {
      hash,
      label,
      taskId: taskId || "",
      lifecycle: "submitted",
      network: currentNetwork().id,
      contractAddress: state.config.contractAddress,
      walletAddress: state.walletAddress,
      createdAt: new Date().toISOString(),
      children: [],
    };
    upsertTransaction(pending);
    if (SETTLEMENT_LABELS.has(label) && taskId === state.activeTask?.id && isTransactionId(hash)) {
      state.activeResolutionTxId = hash;
      state.resolutionProof = { hash, state: "pending", bound: true, finalized: false, payoutsDelivered: false, message: "Resolution submitted and awaiting finalization." };
      const url = new URL(window.location.href);
      url.searchParams.set("task", taskId);
      url.searchParams.set("tx", hash);
      window.history.replaceState({}, "", url);
      renderTask();
    }
    toast(`${label} submitted. Docket saved the transaction ID locally and will wait for finalization.`, "success");
    void monitorTransaction(hash, { taskId, label, client: state.readClient, record: pending });
    return hash;
  } catch (error) {
    toast(`${label} was not submitted: ${formatError(error)}`, "error");
    throw error;
  } finally {
    setBusy(key, false);
  }
}

async function discoverTriggeredChildren(parentHash, { taskId, client = state.readClient, scope = null } = {}) {
  try {
    const triggered = await client.getTriggeredTransactionIds({ hash: parentHash });
    const discovered = Array.isArray(triggered) ? triggered.filter((id) => typeof id === "string") : [];
    const parent = transactionByHash(parentHash, scope);
    const childScope = parent ? transactionScopeFor(parent) : (scope || activeTransactionScope());
    const existing = Array.isArray(parent?.children) ? parent.children.filter((id) => typeof id === "string") : [];
    const children = [...new Set([...existing, ...discovered])];
    for (const childHash of children) {
      if (!transactionByHash(childHash, childScope)) {
        const child = {
          hash: childHash,
          label: "Payout child message",
          taskId: taskId || "",
          lifecycle: "awaiting",
          ...childScope,
          parentHash,
          isChild: true,
          createdAt: new Date().toISOString(),
          children: [],
        };
        upsertTransaction(child);
        void monitorTransaction(childHash, { taskId, label: "Payout child message", isChild: true, client, record: child });
      }
    }
    return children;
  } catch {
    return [];
  }
}

async function monitorTransaction(hash, { taskId, label, isChild = false, client = state.readClient, record = null } = {}) {
  const scope = record ? transactionScopeFor(record) : activeTransactionScope();
  const prior = transactionByHash(hash, scope) || { hash, label, taskId, ...scope, children: [] };
  upsertTransaction({ ...prior, lifecycle: "awaiting", error: "" });
  try {
    const sdk = await loadSdk();
    const receipt = await client.waitForTransactionReceipt({
      hash,
      status: sdk.TransactionStatus.FINALIZED,
      interval: 2_000,
      retries: 180,
    });
    const execution = receipt?.txExecutionResultName || "";
    if (execution !== "FINISHED_WITH_RETURN") {
      upsertTransaction({
        ...(transactionByHash(hash, scope) || prior),
        lifecycle: "failed",
        error: execution ? `Finalized with ${execution}.` : "Finalization returned no successful contract result.",
      });
      toast(`${label || "Contract request"} finalized without a successful contract return. Inspect the transaction.`, "error");
      return;
    }
    const children = isChild ? [] : await discoverTriggeredChildren(hash, { taskId, client, scope });
    upsertTransaction({
      ...(transactionByHash(hash, scope) || prior),
      lifecycle: "finalized",
      executionResult: execution,
      children,
      error: "",
    });
    toast(`${label || "Contract request"} finalized successfully.`, "success");
    if (taskId) await loadTask(taskId, { quiet: true });
  } catch (error) {
    const message = formatError(error);
    const terminalFailure = /cancel(?:ed|led)|undetermined|validators?_?timeout|leader_?timeout/i.test(message);
    const nextLifecycle = !terminalFailure && /retries|timeout|not finalized/i.test(message) ? "awaiting" : "failed";
    upsertTransaction({ ...(transactionByHash(hash, scope) || prior), lifecycle: nextLifecycle, error: nextLifecycle === "failed" ? message : "" });
    if (nextLifecycle === "failed") toast(`Could not follow ${shortId(hash)}: ${message}`, "error");
  }
}

async function refreshPendingTransactions({ quiet = false } = {}) {
  if (!state.contractVerified || !state.readClient) return;
  const entries = scopedTransactions();
  const pending = entries.filter((entry) => !["finalized", "failed"].includes(entry.lifecycle));
  const childDiscoveryCandidates = entries.filter((entry) =>
    entry.lifecycle === "finalized" &&
    !entry.isChild &&
    SETTLEMENT_LABELS.has(entry.label),
  );
  if (!pending.length && !childDiscoveryCandidates.length) {
    if (!quiet) toast("There are no pending local transactions to refresh.", "info");
    return;
  }
  if (!quiet) toast(`Checking ${pending.length} pending transaction${pending.length === 1 ? "" : "s"} and ${childDiscoveryCandidates.length} payout-message path${childDiscoveryCandidates.length === 1 ? "" : "s"}…`, "info");
  await Promise.all(pending.map(async (entry) => {
    try {
      const transaction = await state.readClient.getTransaction({ hash: entry.hash });
      const status = String(transaction?.statusName || transaction?.status || transaction?.txStatus || "").toUpperCase();
      if (status === "FINALIZED") {
        await monitorTransaction(entry.hash, { ...entry, client: state.readClient, record: entry });
      } else if (TERMINAL_FAILURE_TRANSACTION_STATUSES.has(status)) {
        upsertTransaction({ ...entry, lifecycle: "failed", error: `Network reported ${status}.` });
      } else {
        upsertTransaction({ ...entry, lifecycle: FINALIZING_TRANSACTION_STATUSES.has(status) ? "finalizing" : "awaiting", error: "" });
      }
    } catch (error) {
      upsertTransaction({ ...entry, error: formatError(error) });
    }
  }));
  await Promise.all(childDiscoveryCandidates.map(async (entry) => {
    const children = await discoverTriggeredChildren(entry.hash, {
      taskId: entry.taskId,
      client: state.readClient,
      scope: transactionScopeFor(entry),
    });
    if (children.length) upsertTransaction({ ...entry, children });
  }));
  if (state.activeTask) renderTask();
}

async function loadTask(taskId, { quiet = false } = {}) {
  const id = String(taskId || "").trim();
  if (!id) {
    toast("Enter a Docket case ID.", "error");
    return;
  }
  if (!state.contractVerified || !state.readClient) {
    toast("Verify the configured Docket v2 contract before loading a case.", "error");
    return;
  }
  ui.caseLoading.hidden = false;
  ui.caseLoading.textContent = `Loading ${id} from the configured contract…`;
  try {
    if (state.activeTaskId && state.activeTaskId !== id) {
      state.activeResolutionTxId = "";
      state.resolutionProof = null;
      resetDeliveryDiscovery(id);
    }
    const raw = await state.readClient.readContract({
      address: state.config.contractAddress,
      functionName: "get_task",
      args: [id],
      transactionHashVariant: "latest-final",
    });
    const task = normalizeTask(raw, id);
    state.activeTask = task;
    state.activeTaskId = id;
    ui.caseInput.value = id;
    const url = new URL(window.location.href);
    url.searchParams.set("task", id);
    const resolutionTxId = resolutionTransactionIdForTask(task);
    if (resolutionTxId) {
      state.activeResolutionTxId = resolutionTxId;
      url.searchParams.set("tx", resolutionTxId);
    }
    else url.searchParams.delete("tx");
    window.history.replaceState({}, "", url);
    persistCase({ id: task.id, title: task.title, repositoryUrl: task.repositoryUrl });
    setWorkspaceView("cases");
    renderTask(task);
    await verifyResolutionTransaction(task);
    if (!quiet) toast(`Loaded ${id} from the configured contract.`, "success");
  } catch (error) {
    state.activeTask = null;
    renderTask();
    if (!quiet) toast(`Could not load ${id}: ${formatError(error)}`, "error");
  } finally {
    ui.caseLoading.hidden = true;
  }
}

async function submitCreateDocket(event) {
  event.preventDefault();
  let prepared;
  try {
    writeReady();
    const terms = collectCreateTerms();
    const fingerprint = createTermsFingerprint(terms);
    prepared = state.preparedDocket;
    if (!prepared || prepared.fingerprint !== fingerprint) {
      throw new Error("Prepare the exact docket.yml for these terms before funding.");
    }
    const expectedConfig = buildDocketConfig(prepared.taskId, terms);
    const expectedHash = await sha256Hex(canonicalConfigForHash(expectedConfig));
    if (prepared.configText !== expectedConfig || prepared.configSha256 !== expectedHash) {
      state.preparedDocket = null;
      persistPreparedDocket(null);
      renderPreparedDocket();
      throw new Error("The saved docket.yml no longer matches these terms. Prepare and export it again before funding.");
    }
    if (!prepared.exportedAt) {
      throw new Error("Download or copy the exact docket.yml before funding this case.");
    }
    if (!prepared.commitAcknowledgedAt) {
      throw new Error("Acknowledge the public docket.yml commitment before funding this case.");
    }
  } catch (error) {
    toast(formatError(error), "error");
    return;
  }

  ui.createSubmit.disabled = true;
  ui.createSubmit.textContent = "Requesting wallet signature…";
  try {
    const checklistJson = JSON.stringify(criteriaForContract(prepared.criteria));
    await runWrite({
      functionName: "register_task",
      args: [
        prepared.taskId,
        prepared.worker,
        prepared.repository.url,
        prepared.title,
        checklistJson,
        prepared.configSha256,
      ],
      value: prepared.escrow,
      label: "Fund and create docket",
      taskId: prepared.taskId,
    });
    persistCase({
      id: prepared.taskId,
      title: prepared.title,
      repositoryUrl: prepared.repository.url,
      configSha256: prepared.configSha256,
      configText: prepared.configText,
      configExportedAt: prepared.exportedAt,
      configCommitAcknowledgedAt: prepared.commitAcknowledgedAt,
      ...activeTransactionScope(),
    });
    state.activeTaskId = prepared.taskId;
    ui.caseInput.value = prepared.taskId;
    const shareUrl = `${window.location.origin}${window.location.pathname}?task=${encodeURIComponent(prepared.taskId)}`;
    await navigator.clipboard?.writeText(shareUrl).catch(() => {});
    toast("Registration request submitted. The share URL was copied when permitted; keep the exported docket.yml unchanged and commit it before delivery begins.", "success");
  } catch {
    // runWrite already provided a useful status.
  } finally {
    ui.createSubmit.disabled = false;
    ui.createSubmit.innerHTML = `Fund and create docket <span aria-hidden="true">→</span>`;
  }
}

async function submitEvidence(event) {
  event.preventDefault();
  const task = state.activeTask;
  if (!task) return;
  const form = new FormData(event.target);
  const pastedManifest = String(form.get("manifestJson") || "").trim();
  const pastedProof = String(form.get("proofJson") || "").trim();
  if (!pastedManifest || !pastedProof) {
    toast("Paste both the Docket Action manifest and its matching proof from the job summary.", "error");
    return;
  }
  let manifestInput;
  try {
    const parsed = JSON.parse(pastedManifest);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Manifest must be an object.");
    const allowedKeys = ["pr_url", "head_sha", "actions_run_url"];
    if (
      Object.keys(parsed).length !== allowedKeys.length ||
      Object.keys(parsed).some((key) => !allowedKeys.includes(key))
    ) {
      throw new Error("Manifest contains unsupported fields.");
    }
    manifestInput = {
      prUrl: parsed.pr_url,
      headSha: parsed.head_sha,
      workflowUrl: parsed.actions_run_url,
    };
  } catch {
    toast("The pasted manifest is not valid Docket evidence JSON.", "error");
    return;
  }
  const validated = validateEvidenceInput(
    task.repositoryUrl,
    manifestInput.prUrl,
    manifestInput.headSha,
    manifestInput.workflowUrl,
  );
  if (!validated.value) {
    toast(validated.error, "error");
    return;
  }
  try {
    const proof = await validateActionProof(pastedProof, task, validated.value);
    if (!proof.value) {
      toast(proof.error, "error");
      return;
    }
  } catch (error) {
    toast(formatError(error), "error");
    return;
  }
  const status = String(task.status || "").toUpperCase();
  setFormBusy(event.target, true);
  try {
    await runWrite({
      functionName: status === "NEEDS_EVIDENCE" ? "supplement_evidence" : "submit_delivery",
      args: [task.id, JSON.stringify(validated.value)],
      label: status === "NEEDS_EVIDENCE" ? "Supplement evidence" : "Submit delivery evidence",
      taskId: task.id,
    });
  } catch {
    // runWrite already reported the error.
  } finally {
    setFormBusy(event.target, false);
  }
}

async function submitDiscoveredEvidence(event) {
  event.preventDefault();
  const task = state.activeTask;
  if (!task) return;
  if (userRole(task) !== "Worker") {
    toast("Connect the worker wallet assigned to this docket before submitting delivery evidence.", "error");
    return;
  }
  const candidate = selectedDeliveryCandidate(task);
  if (!candidate?.run) {
    toast("Select a delivery that passed every GitHub preflight check.", "error");
    return;
  }
  const validated = validateEvidenceInput(task.repositoryUrl, candidate.prUrl, candidate.headSha, candidate.run.url);
  if (!validated.value) {
    toast(validated.error, "error");
    return;
  }
  const status = String(task.status || "").toUpperCase();
  setFormBusy(event.target, true);
  try {
    await runWrite({
      functionName: status === "NEEDS_EVIDENCE" ? "supplement_evidence" : "submit_delivery",
      args: [task.id, JSON.stringify(validated.value)],
      label: status === "NEEDS_EVIDENCE" ? "Supplement evidence" : "Submit delivery evidence",
      taskId: task.id,
    });
  } catch {
    // runWrite already reported the error.
  } finally {
    setFormBusy(event.target, false);
  }
}

async function reviewDelivery(event) {
  event.preventDefault();
  const task = state.activeTask;
  if (!task) return;
  if (userRole(task) !== "Requester" || String(task.status || "").toUpperCase() !== "SUBMITTED") {
    toast("Only the requester can review a submitted delivery.", "error");
    return;
  }
  const pendingWrite = pendingRequesterReviewWrite(task.id);
  if (pendingWrite) {
    toast(`${pendingWrite.label} is already ${pendingWrite.lifecycle}. Refresh its status before trying again.`, "error");
    return;
  }
  const draft = reviewDraftForTask(task);
  event.target.querySelectorAll("[data-review-note]").forEach((control) => {
    draft.notes[String(control.dataset.criterionId || "")] = String(control.value || "").trim();
  });
  const summary = summarizeReview(task.criteria, draft.choices);
  const decision = event.submitter?.value || "";
  const evidence = parseEvidenceForDisplay(task.evidenceManifest, task.repositoryUrl);
  setFormBusy(event.target, true);
  try {
    if (decision === "accept") {
      if (!summary.allSatisfied) {
        toast("Mark every criterion satisfied before accepting full payment.", "error");
        return;
      }
      await runWrite({ functionName: "accept_delivery", args: [task.id], label: "Accept delivery", taskId: task.id });
    } else {
      const reason = buildStructuredDisputeReason({
        criteria: task.criteria,
        choices: draft.choices,
        notes: draft.notes,
        headSha: evidence?.head_sha || "",
      });
      if (!summary.complete || summary.flagged.length === 0 || reason.length < 10) {
        toast("Assess every criterion and flag at least one issue before opening a dispute.", "error");
        return;
      }
      await runWrite({ functionName: "open_dispute", args: [task.id, reason], label: "Open dispute", taskId: task.id });
    }
  } catch {
    // runWrite already reported the error.
  } finally {
    setFormBusy(event.target, false);
    if (state.activeTask?.id === task.id) renderTask();
  }
}

async function escalateSubmission(event) {
  event.preventDefault();
  const task = state.activeTask;
  if (!task) return;
  const reason = String(new FormData(event.target).get("reason") || "").trim();
  if (reason.length < 10) {
    toast("Describe the escalation in at least ten characters.", "error");
    return;
  }
  setFormBusy(event.target, true);
  try {
    await runWrite({ functionName: "escalate_submission", args: [task.id, reason], label: "Escalate submission", taskId: task.id });
  } catch {
    // runWrite already reported the error.
  } finally {
    setFormBusy(event.target, false);
  }
}

async function resolveDispute(event) {
  event.preventDefault();
  const task = state.activeTask;
  if (!task) return;
  const role = userRole(task);
  if (!["Requester", "Worker"].includes(role) || String(task.status || "").toUpperCase() !== "DISPUTED") {
    toast("Only a party to a disputed case can request consensus review.", "error");
    return;
  }
  const preflight = adjudicationPreflight(task);
  if (!preflight.passed) {
    toast("Run the public evidence preflight before requesting consensus review.", "error");
    return;
  }
  if (latestLocalResolutionTransaction(task.id)) {
    toast("A resolution transaction is already recorded for this case.", "error");
    return;
  }
  setFormBusy(event.target, true);
  try {
    const hash = await runWrite({ functionName: "resolve_dispute", args: [task.id], label: "Resolve dispute", taskId: task.id });
    if (isTransactionId(hash)) await refreshAdjudicationLifecycle(task, { quiet: true });
  } catch {
    // runWrite already reported the error.
  } finally {
    setFormBusy(event.target, false);
  }
}

async function appealResolution(event) {
  event.preventDefault();
  const task = state.activeTask;
  const txId = resolutionTransactionIdForTask(task);
  if (!task || !isTransactionId(txId)) return;
  if (state.resolutionProof?.hash !== txId || state.resolutionProof?.bound !== true) {
    toast("Verify that the resolution transaction belongs to this case before appealing it.", "error");
    return;
  }
  const key = `appeal:${txId}`;
  if (state.busy.has(key)) return;
  setFormBusy(event.target, true);
  setBusy(key, true);
  try {
    writeReady();
    const eligible = await state.readClient.canAppeal({ txId });
    if (!eligible) throw new Error("GenLayer reports that the current decision is not appealable.");
    const charge = await state.readClient.getAppealCharge({ txId });
    const returned = await state.walletClient.appealTransaction({ txId, value: charge });
    const returnedId = typeof returned === "string" ? returned : returned?.transactionId || returned?.txId || returned?.hash || txId;
    if (isTransactionId(returnedId) && returnedId.toLowerCase() !== txId.toLowerCase()) {
      throw new Error("The wallet returned a different transaction ID for the appeal.");
    }
    const scope = activeTransactionScope();
    const prior = transactionByHash(txId, scope) || {
      hash: txId,
      label: "Resolve dispute",
      taskId: task.id,
      ...scope,
      createdAt: new Date().toISOString(),
      children: [],
    };
    const updated = {
      ...prior,
      lifecycle: "awaiting",
      appealLifecycle: "submitted",
      appealAttempts: Number(prior.appealAttempts || 0) + 1,
      lastAppealAt: new Date().toISOString(),
      appealChargeWei: charge.toString(),
      error: "",
    };
    upsertTransaction(updated);
    toast(`Native GenLayer appeal submitted with ${formatGen(charge)} on the original resolution transaction.`, "success");
    await refreshAdjudicationLifecycle(task, { quiet: true });
    void monitorTransaction(txId, { taskId: task.id, label: "Resolve dispute", client: state.readClient, record: updated });
  } catch (error) {
    toast(`Appeal was not submitted: ${formatError(error)}`, "error");
  } finally {
    setBusy(key, false);
    setFormBusy(event.target, false);
    if (state.activeTask?.id === task.id) renderTask(task);
  }
}

async function recoverCase(event) {
  event.preventDefault();
  const task = state.activeTask;
  if (!task) return;
  setFormBusy(event.target, true);
  try {
    await runWrite({ functionName: "refund_inconclusive_task", args: [task.id], label: "Recover inconclusive case", taskId: task.id });
  } catch {
    // runWrite already reported the error.
  } finally {
    setFormBusy(event.target, false);
  }
}

async function cancelCase(event) {
  event.preventDefault();
  const task = state.activeTask;
  if (!task) return;
  setFormBusy(event.target, true);
  try {
    await runWrite({ functionName: "cancel_task", args: [task.id], label: "Cancel docket", taskId: task.id });
  } catch {
    // runWrite already reported the error.
  } finally {
    setFormBusy(event.target, false);
  }
}

async function copyCaseUrl() {
  if (!state.activeTask?.id) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("task", state.activeTask.id);
  const resolutionTxId = resolutionTransactionIdForTask(state.activeTask);
  if (resolutionTxId && !["invalid", "unavailable"].includes(state.resolutionProof?.state)) {
    url.searchParams.set("tx", resolutionTxId);
  }
  try {
    await navigator.clipboard.writeText(url.toString());
    toast("Share URL copied.", "success");
  } catch {
    toast(`Copy this share URL: ${url.toString()}`, "info");
  }
}

function downloadCaseReceipt() {
  const task = state.activeTask;
  if (!task?.id) return;
  const receipt = buildCaseReceipt({
    task,
    resolutionProof: state.resolutionProof,
    adjudication: state.adjudication,
  });
  const objectUrl = URL.createObjectURL(new Blob([`${JSON.stringify(receipt, null, 2)}\n`], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `docket-${task.id}-receipt.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  toast("Public case receipt downloaded.", "success");
}

function defaultCriteria() {
  return [
    { description: "", weight_bps: 5000 },
    { description: "", weight_bps: 5000 },
  ];
}

function saveConfiguration(event) {
  event.preventDefault();
  const nextNetwork = ui.networkSelect.value;
  const nextAddress = ui.contractAddress.value.trim();
  state.config = {
    schemaVersion: 2,
    network: NETWORKS[nextNetwork] ? nextNetwork : "studioNext",
    contractAddress: nextAddress,
  };
  state.contractVerified = false;
  state.verification = null;
  state.readClient = null;
  state.walletClient = null;
  state.walletAddress = "";
  state.walletChainId = null;
  state.activeTask = null;
  writeJson(CONFIG_KEY, state.config);
  renderHeader();
  renderReleaseMetadata();
  renderVerification();
  renderTask();
  renderTransactions();
  setReleaseStatus("Configuration saved. Verify the v2 contract before reading or signing.", "neutral");
  toast("Release configuration saved locally.", "success");
}

function bindEvents() {
  window.addEventListener("hashchange", () => syncWorkspaceView({ scrollToHash: true }));
  ui.configForm.addEventListener("submit", saveConfiguration);
  ui.createForm.addEventListener("submit", submitCreateDocket);
  ui.createForm.addEventListener("input", (event) => {
    if (event.target?.dataset?.action === "acknowledge-docket-config") return;
    invalidatePreparedDocket();
  });
  ui.openCaseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadTask(ui.caseInput.value);
  });
  ui.criteria.addEventListener("input", updateWeightTotal);
  app.addEventListener("click", async (event) => {
    const control = event.target.closest("[data-action]");
    if (!control || control.disabled) return;
    const action = control.dataset.action;
    if (action === "connect-wallet") await connectWallet();
    if (action === "scroll-config") {
      setWorkspaceView("dashboard");
      document.querySelector("#config")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (action === "verify-contract") await verifyContract();
    if (action === "prepare-docket-config") {
      try {
        await prepareDocketConfiguration();
      } catch (error) {
        toast(formatError(error), "error");
      }
    }
    if (action === "copy-docket-config") await copyPreparedDocketConfig();
    if (action === "download-docket-config") downloadPreparedDocketConfig();
    if (action === "add-criterion") {
      const rows = readCriteriaRows();
      if (rows.length >= 5) {
        toast("A docket supports at most five criteria.", "info");
      } else {
        rows.push({ description: "", weight_bps: 0 });
        renderCriteria(rows);
        invalidatePreparedDocket();
      }
    }
    if (action === "remove-criterion") {
      const row = control.closest(".criterion-row");
      const index = [...ui.criteria.children].indexOf(row);
      const rows = readCriteriaRows();
      if (rows.length > 2 && index >= 0) {
        rows.splice(index, 1);
        renderCriteria(rows);
        invalidatePreparedDocket();
      }
    }
    if (action === "copy-case") await copyCaseUrl();
    if (action === "download-receipt") downloadCaseReceipt();
    if (action === "reload-case" && state.activeTask?.id) await loadTask(state.activeTask.id);
    if (action === "discover-delivery" && state.activeTask) await discoverGitHubDelivery(state.activeTask);
    if (action === "run-adjudication-preflight" && state.activeTask) await discoverGitHubDelivery(state.activeTask);
    if (action === "refresh-adjudication" && state.activeTask) await refreshAdjudicationLifecycle(state.activeTask);
    if (action === "select-delivery" && state.activeTask) {
      const headSha = String(control.dataset.headSha || "");
      const candidate = activeDeliveryDiscovery(state.activeTask).candidates.find((item) =>
        item.headSha === headSha && item.configMatches && item.run,
      );
      if (candidate) {
        state.deliveryDiscovery.selectedHeadSha = candidate.headSha;
        renderTask();
      }
    }
    if (action === "refresh-transactions") await refreshPendingTransactions();
    if (action === "open-exception-case") {
      const taskId = String(control.dataset.taskId || "").trim();
      if (taskId) {
        await loadTask(taskId, { quiet: true });
        window.location.hash = "open";
      }
    }
    if (action === "open-recent-case") await loadTask(control.dataset.taskId);
  });
  app.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form.dataset.form === "submit-evidence") await submitEvidence(event);
    if (form.dataset.form === "submit-discovered-evidence") await submitDiscoveredEvidence(event);
    if (form.dataset.form === "review-delivery") await reviewDelivery(event);
    if (form.dataset.form === "escalate-submission") await escalateSubmission(event);
    if (form.dataset.form === "resolve-dispute") await resolveDispute(event);
    if (form.dataset.form === "appeal-resolution") await appealResolution(event);
    if (form.dataset.form === "recover-case") await recoverCase(event);
    if (form.dataset.form === "cancel-case") await cancelCase(event);
  });
  app.addEventListener("change", (event) => {
    const control = event.target;
    if (control instanceof HTMLInputElement && control.dataset.reviewChoice !== undefined && state.activeTask) {
      const draft = reviewDraftForTask(state.activeTask);
      draft.choices[String(control.dataset.criterionId || "")] = control.value;
      renderTask();
      return;
    }
    if (!(control instanceof HTMLInputElement) || control.dataset.action !== "acknowledge-docket-config") return;
    if (!state.preparedDocket?.exportedAt) {
      control.checked = false;
      return;
    }
    state.preparedDocket.commitAcknowledgedAt = control.checked ? new Date().toISOString() : "";
    persistPreparedDocket();
    renderPreparedDocket();
  });
  app.addEventListener("input", (event) => {
    const control = event.target;
    if (!(control instanceof HTMLTextAreaElement) || control.dataset.reviewNote === undefined || !state.activeTask) return;
    const draft = reviewDraftForTask(state.activeTask);
    draft.notes[String(control.dataset.criterionId || "")] = control.value;
    const evidence = parseEvidenceForDisplay(state.activeTask.evidenceManifest, state.activeTask.repositoryUrl);
    const preview = control.closest("form")?.querySelector("[data-review-reason-preview]");
    if (preview) {
      preview.textContent = buildStructuredDisputeReason({
        criteria: state.activeTask.criteria,
        choices: draft.choices,
        notes: draft.notes,
        headSha: evidence?.head_sha || "",
      });
    }
  });
  window.ethereum?.on?.("accountsChanged", async (accounts) => {
    state.walletAddress = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : "";
    state.walletClient = null;
    try {
      const chainIdRaw = await window.ethereum.request({ method: "eth_chainId" });
      state.walletChainId = typeof chainIdRaw === "string" ? Number.parseInt(chainIdRaw, 16) : Number(chainIdRaw);
    } catch {
      state.walletChainId = null;
    }
    renderHeader();
    renderTask();
    renderTransactions();
  });
  window.ethereum?.on?.("chainChanged", (chainIdRaw) => {
    const nextChainId = typeof chainIdRaw === "string" ? Number.parseInt(chainIdRaw, 16) : Number(chainIdRaw);
    if (state.busy.has("connect-wallet")) {
      state.walletChainId = nextChainId;
      return;
    }
    state.walletChainId = nextChainId;
    state.walletClient = null;
    state.walletAddress = "";
    renderHeader();
    renderTask();
    renderTransactions();
    toast("Wallet network changed. Reconnect it to the selected Docket network before signing.", "info");
  });
}

async function initialize() {
  syncWorkspaceView();
  renderCriteria(state.preparedDocket?.criteria || defaultCriteria());
  restorePreparedDocketForm();
  renderRecentCases();
  renderTransactions();
  renderHeader();
  bindEvents();
  await fetchReleaseManifest();
}

initialize().catch((error) => {
  setReleaseStatus("The Docket client could not initialize.", "bad");
  toast(formatError(error), "error");
});
