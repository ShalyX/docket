# Docket Pilot: from demo to recurring use

Docket's first users are small software teams that commission scoped work from AI coding agents, independent developers, or automation shops and already review delivery in public GitHub pull requests. The initial problem is practical: a task can be mostly complete, yet conventional escrow requires either a full payout or an argument over a refund. Docket gives the team a pre-priced checklist and an evidence trail before that disagreement happens.

## Pilot offer

Recruit five small teams that already commission public GitHub work from coding agents or independent developers. Each partner runs up to five narrowly scoped public-repository tasks over two weeks. Docket provides hands-on task setup, browser-generated `docket.yml`, the vendored GitHub Action, and its target-repository workflow template. Partners decide whether to accept, dispute, or cancel each task; Docket collects the operational feedback.

The pilot starts with Studio Next or other explicitly agreed test conditions. Docket has a deployed contract plus founder-operated acceptance, dispute, appeal, and recovery cases. It has no external design partners, paid users, customer revenue, or measured savings yet, so those self-pilots must not be presented as customer validation or production escrow.

## Activation path

1. A partner chooses one public PR-sized task with two to five concrete acceptance criteria.
2. The requester and worker assign criterion weights that total 10,000 basis points. The requester prepares the canonical v2 `docket.yml` in Docket, exports it by copy or download, and acknowledges that it will be committed at the public repository root before the browser permits funding. Registration verifies the repository is active and public, and accepts the hash only when it is the contract's own rendering of the case ID, worker, title, escrow wei, and checklist. The browser keeps the exact generated file and hash in local storage for recovery.
3. The repository commits that exact public `docket.yml`, vendors the Docket Action at `./.docket/github-action`, and copies the supplied target-repository workflow. That workflow checks out the submitted PR head with `persist-credentials: false`.
4. The worker submits a public PR. The Action produces a flat contract-ready manifest plus a separate proof and places both JSON objects in the successful run's job summary. The worker pastes both into Docket; the browser requires both, checks the proof schema, task ID, repository, manifest hash, root config path/hash, Actions-run ID against the manifest, and positive run attempt, then sends only the manifest. The proof is onboarding metadata; disputed settlement independently verifies a successful `pull_request` run linked to the submitted PR head.
5. The requester reviews the task in Docket. They may use `accept_delivery` for a requester-authorized full payout without a GitHub fetch, or open and resolve a dispute for the independently checked path. The team records the outcome and whether the rule made review faster or fairer.

A partner is activated only after all five steps have occurred. The proof is offchain handoff metadata and does not become contract evidence; the onchain task holds the immutable configuration hash. On a disputed resolution, the contract independently reads the root `docket.yml` from the public PR head repository at the submitted SHA, normalizes it, and refuses to settle unless it is the exact canonical v2 agreement. The head repository can be a public fork, while the PR base repository and a successful pull-request Actions run must still match the task repository and submitted PR. A GitHub Action install or local demo view alone does not count as usage.

## Distribution loop

The original plan was to plug Docket into an existing job or escrow protocol. That required another team to integrate before the core settlement rule could be tested. The current product packages the Intelligent Contract, browser flow, repository-root agreement, GitHub Action, and agent handoff so any suitable public repository can run the flow directly. Protocol integrations are a later distribution channel, not a dependency for this pilot.

Each pilot begins with a small public repository integration, which gives the worker a reusable workflow and config template. A successful task leaves a PR, an Actions evidence run whose job summary contains the manifest and proof, and a Docket settlement record. The partner can reuse that template for its next task, while a reviewer or contributor can adopt the same Action from the repository.

The initial channels are direct outreach to agent builders in the GenLayer community, short implementation clinics for open-source maintainers, and a concise public case study after a partner explicitly consents. The distribution ask is concrete: try one scoped PR task, not move an entire project onto Docket. Early feedback should improve setup time, the criterion template, and evidence quality before expanding to private repositories or production payment.

## Evidence dashboard

**Snapshot date: 2026-09-13. Founder-operated proofs and external pilot metrics are kept separate.**

`shalyx/touchline-relay` is the founder-operated proof repository. It demonstrates the workflow on public infrastructure; it is not an external prospect or design partner.

| Founder-operated proof | Current | Evidence |
|---|---:|---|
| Public repos configured | 1 | `shalyx/touchline-relay` has root `docket.yml` fixtures and successful Docket evidence runs. |
| Current-contract tasks registered | 4 | Acceptance, dispute, appeal, and fail-closed recovery cases exist on `0xa6f640F8bb879c9336F9D5A0a8fBdD4f810Af7B3`. |
| Requester acceptance finalized | 1 | `dkt-accept-drill-20260913` paid the full 1 GEN escrow to the worker. |
| Partial settlements finalized | 3 | The dispute, appeal, and repaired recovery drills each reached a proportional result. |

| External pilot metric | Current | What counts |
|---|---:|---|
| Design partners contacted | 0 | A named team received the pilot invitation. |
| Design partners committed | 0 | A team agreed a pilot window and a first task. |
| Public repos configured | 0 | A repository has both `docket.yml` and a successful Docket evidence workflow. |
| Docket tasks registered | 0 | A task-registration receipt exists. |
| Delivery manifests submitted | 0 | A worker submission is visible on the task. |
| Requester reviews completed | 0 | The requester accepted or disputed a submitted task. |
| Partial settlements finalized | 0 | A public finalized receipt shows both payout messages. |
| Median setup time | — | Measured from checklist agreement to first workflow success. |
| Partner retention | — | Partner begins a second task within 30 days. |

## Learning gates

The first five partners should answer four questions: can a team set up its first task in under 30 minutes with assistance, do participants understand proportional settlement before work starts, do the PR evidence manifests reduce back-and-forth at review time, and will a partner start a second task? If the answer is no, improve the onboarding and rubric design before adding marketplace, token, or growth features.

The target is useful behavior, not vanity installs. Update this dashboard only from reviewable repository links and finalized Docket receipts; leave unknown values blank instead of estimating them.
