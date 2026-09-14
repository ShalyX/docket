# Docket — Agent Tank submission brief

## One sentence

Docket gives paid public-GitHub implementation work a verifiable delivery record and an on-chain proportional settlement rule, so a disputed pull request can be paid according to the criteria it actually satisfies.

## Track

**Onchain Justice**

## The company-shaped problem

AI coding agents and development teams are increasingly able to deliver a pull request, but the commercial handoff is still weak. A requester may see a useful PR with one unmet requirement, an unclear CI result, or a disagreement about what “done” meant. Standard escrow forces an all-or-nothing answer; manual dispute handling does not produce a reusable, auditable record.

Docket begins with the narrow case people can use now: a requester already has a worker, a public GitHub repository, and a PR-sized piece of work. Before implementation, the requester funds a weighted acceptance checklist. After delivery, the case URL carries the public PR, exact commit, Actions run, independently fetched evidence snapshot, state, and settlement record.

## Why GenLayer is necessary

A deterministic contract can lock funds and divide known numbers, but it cannot decide whether public delivery evidence satisfies natural-language implementation terms. That is the nondeterministic step Docket gives to GenLayer.

GenLayer validators independently retrieve the relevant public GitHub facts and assess each frozen criterion as `PASS`, `FAIL`, or `INCONCLUSIVE`. On a disputed case they retrieve the repository-root v2 `docket.yml` from the public PR head repository at the submitted head SHA, normalize its line endings and final newline, and require its SHA-256 and full canonical term rendering to match registration. They require the Actions run to be a successful `pull_request` run linked to the submitted PR and head. That allows a public fork PR while the PR base repository and Actions run still must match the task repository. They compare a bounded snapshot and verdict vector, while the contract retains control over escrow, case state, criterion weights, and arithmetic. A mismatched or unavailable public source cannot turn into a payout: the case remains in `NEEDS_EVIDENCE`.

## What is implemented in the v2 source

- Payable case registration with a client-generated `dkt-…` ID, non-zero worker address, canonical public GitHub repository preflight, title, 2–5 criteria totaling 10,000 bps, and the `config_sha256` of the canonical v2 public `docket.yml` rebuilt from those exact terms.
- Worker evidence manifests that bind a canonical PR URL, lower-case commit SHA, and Actions-run URL to the registered repository.
- Public GitHub retrieval for the PR, first page of up to five changed files with 4,000-character / 16,000-character patch caps, Actions run, and root `docket.yml` from the public PR head repository at the submitted immutable head inside the consensus path.
- Snapshot relationship checks for repository identity, public visibility, PR head SHA, manifest SHA, successful pull-request workflow linkage, and the normalized canonical root configuration.
- A fail-closed `NEEDS_EVIDENCE` outcome for unavailable, invalid, mismatched, or insufficient public evidence.
- Criterion-level consensus, deterministic proportional settlement, external-transfer messages for non-zero GenLayer Chain addresses, up to three evidence versions, and requester recovery only from `NEEDS_EVIDENCE`, after seven days or once the 30-day case deadline has elapsed.
- A browser release shell that supports wallet connection, verified contract configuration, prepared-configuration recovery, new case creation, role-specific actions, case share URLs, pending transaction tracking, and receipt inspection.
- A browser-generated repository configuration, GitHub Action, and agent-skill path that binds public onboarding terms to delivery evidence without sending secrets onchain. Funding requires a prepared configuration, export, and a requester acknowledgement; evidence submission requires both Action JSON outputs.

## Current execution status

The v2 contract is deployed on Studio Next (chain ID `61997`, RPC `https://studio-next.genlayer.com/api`) at `0xa6f640F8bb879c9336F9D5A0a8fBdD4f810Af7B3`, and the release manifest pins its verified source hash and finalized activation transaction. The browser uses `genlayer-js@2.0.0-rc.1` with the framework-neutral `@genlayer/transaction-kit@0.1.0-rc.2` for fee quotes and contract writes. Two founder-operated cases prove both settlement routes on that same instance. Case `dkt-accept-drill-20260913` bound public PR #5 and its successful Actions run, then finalized requester-authorized acceptance in transaction `0x98e211e696a044263fc8d98312220cd771083ce7e1f91aef4a83f036a1a21ca1`: 10,000 passed basis points, 1 GEN to the worker, 0 to the requester, and a zero contract balance. Disputed case `dkt-dispute-7030-20260912` invoked GenLayer adjudication over an intentionally partial delivery. Validators independently returned `PASS / PASS / FAIL`, producing 7,000 passed basis points, 0.7 GEN for the worker, 0.3 GEN for the requester, and a zero post-settlement contract balance. This is real onchain self-usage; **external users and customer feedback are not yet proven**.

Local contract tests and linting test the source behavior. They do not prove live chain execution, external GitHub availability under validator consensus, wallet compatibility, transferred funds, or demand. The final presentation must distinguish those facts plainly.

## Initial customer and go-to-market path

The first customer is a technical founder, AI development studio, or agent builder paying for a public-repository implementation task. The initial motion is a concierge pilot: help the requester write evidence-friendly criteria, set up the public repository configuration, and observe a real handoff from funded case to PR to receipt.

We entered the build expecting Docket to sit behind an existing job or escrow protocol. That path depended on another team integrating before we could test the mechanism. We moved to a direct GitHub-native workflow so we could ship and prove the settlement primitive ourselves. Protocol-level integrations remain the next distribution layer; this submission works without one.

Distribution is embedded in the development workflow rather than built around a generic marketplace:

1. The browser prepares `docket.yml`, requires a copy or download plus a public-root commit acknowledgement before funding, preserves the exact file locally, and registers its normalized hash as `config_sha256`.
2. A vendored GitHub Action runs from the submitted PR head with `persist-credentials: false`, derives the manifest and offchain proof, and places both objects in the job summary.
3. The worker pastes both objects into the browser. The browser checks their relationship to the onchain task and submits the exact three-field manifest; during a dispute the contract independently rechecks the root file at that manifest head.
4. An agent skill gives coding agents a consistent way to prepare their evidence handoff, and the stable case URL can travel in an issue, PR description, delivery update, or client handoff.

The repository contains the initial integration assets. It does **not** establish that a team has adopted them. Outreach, participant consent, and public customer claims remain future work.

## Demo that proves the product

The right demo is a real public case, recorded only after deployment:

1. Show the verified network, deployed v2 contract address, and release metadata.
2. Create a case from a public repository with a real worker wallet, weighted terms, and test-network escrow.
3. Open the case’s stable share URL and show the worker’s actual PR, head SHA, Actions run summary, manifest, proof, and matching root `docket.yml`.
4. Trigger an acceptance or dispute and show the live transaction lifecycle. Label an acceptance as a requester-authorized full payout without a GitHub fetch.
5. For a dispute, show the recorded GitHub snapshot, including the root-config hash relationship, criterion findings, settlement state, parent transaction, and any finalized child transfer records.
6. Close with the source-controlled `docket.yml`, GitHub Action, and agent skill that let the next team use the same flow.

A local UI, a simulated split, a copied explorer screenshot, or a hardcoded case would not be adequate proof. The current submission instead uses public PRs, successful Actions runs, finalized Studio Next transactions, and recorded post-settlement state. Those founder-operated proofs establish execution, not external adoption.

## Judging criteria map

| Criterion | Docket evidence |
|---|---|
| Idea / impact | Gives AI-assisted software delivery a fairer outcome than binary escrow when part of a PR-sized agreement is verified and part is not |
| Technical execution | Public-GitHub evidence binding, immutable root-config hash verification at the submitted PR head, bounded API snapshot, consensus comparison, state controls, `u256` proportional settlement, and wallet transaction tracking |
| GenLayer use | Subjective, evidence-dependent acceptance directly drives a contract settlement transition; external web data is retrieved in the consensus path |
| User experience | A case has a stable URL, role-specific next actions, a clear configured-versus-unverified network state, and explicit transaction/receipt status |
| Completeness and startup potential | The repository includes a contract, tests, release shell, integration primitives, a pilot operating path, and defined live-proof gates |

## Remaining proof before broader claims

1. Run the first consented pilot with an external requester and worker, then document observed usage, feedback, and failure modes.
2. Repeat deployment and settlement on a durable network after the Studio Next preview phase before making production-network claims.
3. Publish customer names or case studies only with participant consent.

## Competitive wedge

Docket is not a marketplace whose differentiation is listings, ratings, or tags. Its wedge is the evidence-to-settlement path for a known public GitHub handoff: terms are priced before work, provenance is verified independently, a shareable case records the result, and payment follows the criteria rather than an arbitrary winner-take-all dispute.
