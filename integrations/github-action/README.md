# Docket GitHub Evidence Action

This dependency-free Node 20 action turns a **public GitHub pull request** and its current Actions run into a compact Docket evidence manifest. Its `manifest` output is directly accepted by `Docket.submit_delivery`:

```json
{"pr_url":"https://github.com/owner/repository/pull/42","head_sha":"0123456789abcdef0123456789abcdef01234567","actions_run_url":"https://github.com/owner/repository/actions/runs/123456"}
```

It does not call GitHub's API, use `GITHUB_TOKEN`, post a comment, submit a transaction, upload an artifact, or write a secret.

The action validates that the workflow is a `pull_request` workflow, the event says the repository is public, the server is `https://github.com`, and the PR URL, head SHA, run ID, task ID, and canonical lowercase repository URL meet the contract's rules. It accepts only a repository-root v2 `docket.yml` with a non-zero lowercase worker address and positive `escrow_wei`; the file must be non-empty and at most 64 KiB. It produces lowercased GitHub URLs from the frozen `repository_url`. It cannot independently prove that a repository remains public or that a CI result proves a product claim; Docket validators still evaluate independently fetched evidence during a dispute.

## Add it to a public repository

Until this Action is published, vendor the complete `integrations/github-action/` directory into the target repository as `.docket/github-action/`. Prepare the canonical v2 `docket.yml` in the Docket browser, export it, acknowledge the public-root commitment before funding, and commit that exact file unchanged at the repository root before the worker opens a delivery PR.

Copy [target-repo-workflow.yml](target-repo-workflow.yml) to the target repository as `.github/workflows/docket-evidence.yml`. The complete template:

- runs only for public pull requests;
- checks out `github.event.pull_request.head.sha`, so the Action hashes the file at the same revision named by the manifest;
- uses `persist-credentials: false`;
- writes both JSON outputs into the successful run's job summary for the worker to copy.

For an installed, versioned Action, replace the local `uses:` path with the public repository and immutable release tag or commit SHA. The Docket source repository intentionally ships Action checks, not an evidence workflow for its example configuration.

## Outputs

| Output | Meaning |
|---|---|
| `manifest` | Exact flat JSON accepted by `submit_delivery`: `pr_url`, `head_sha`, and `actions_run_url` only. |
| `manifest-sha256` | Hash of the exact output JSON. |
| `proof` | Separate JSON with the supported schema, task ID, repository URL, manifest hash, config path/hash, and workflow-run ID/attempt. The browser requires it alongside `manifest`, checks its run ID against `actions_run_url` and requires a positive attempt, then compares its config hash with the task’s onchain `config_sha256`; do not submit this object as contract evidence. |
| `proof-sha256` | Hash of the exact proof JSON. |
| `config-sha256` | SHA-256 of the public root v2 `docket.yml` after CRLF/LF normalization and one final newline. It must match the canonical onchain registration hash for the case terms. |
| `pull-request-url` | Validated public PR URL. |
| `actions-run-url` | Validated public Actions-run URL. |
| `head-sha` | The PR head commit evaluated by the action. |

The supplied template writes the manifest and proof into the job summary. Copy both JSON objects into the matching Docket case. The browser submits only the flat manifest after checking the proof locally. The proof is convenient offchain handoff metadata, not contract authority. On `resolve_dispute`, the contract independently fetches the root `docket.yml` from the public PR head repository at the submitted manifest head, normalizes CRLF/LF and one final newline, and permits disputed settlement only when that hash equals the registered canonical v2 configuration for the task terms. The head repository can be a public fork; the PR base repository and Actions run still must match the task repository, and the run must be a successful `pull_request` run linked to the submitted PR head. `accept_delivery` is separate: it is a requester-authorized full payout and does not fetch GitHub.

Keep Docket task evidence public and compact; never put credentials, private issue data, logs, or personal data in `docket.yml` or a task submission. Editing terms, whitespace other than line endings, or comments after registration changes the hash. The same 64 KiB bound applies when the contract fetches the public root file during a dispute.

## Local verification

```bash
node integrations/github-action/test/index.test.js
```
