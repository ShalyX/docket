# Docket contract review

This bundle is the readable Docket v2 contract requested for review. The primary source is [contracts/docket.py](contracts/docket.py); it is the source intended for deployment, not the compact delivery artifact.

## What the contract does

Docket holds GEN escrow for a public GitHub implementation agreement. A requester fixes a worker address, public repository, 2–5 weighted acceptance criteria, and the hash of the canonical root `docket.yml` at registration. A worker supplies a pull request, commit SHA, and Actions-run URL. In a dispute, consensus fetches bounded public GitHub facts and the root configuration at the submitted immutable commit, then settles the passed portion of escrow. Ambiguous or invalid evidence goes to `NEEDS_EVIDENCE` without payment.

The source contains the recovery protection added after review: a requester cannot wait out a completed `SUBMITTED` case and take the full escrow through `refund_inconclusive_task`. That recovery route is available only after a case has actually entered `NEEDS_EVIDENCE`; the worker may escalate a silent requester after 24 hours.

## Review entry points

| File | Purpose |
| --- | --- |
| `contracts/docket.py` | Readable intelligent contract source |
| `tests/direct/test_docket.py` | Direct-mode behavioral tests |
| `docket.yml` | Canonical public agreement format |
| `ARCHITECTURE.md` | Trust boundaries, evidence model, and lifecycle |
| `frontend/` | Browser shell that verifies deployed code before enabling writes |

## Source identity

| Item | Value |
| --- | --- |
| Readable source SHA-256 | `56fab2c4739ba63c545e0725408f6acae3cd44259dd1399088c95a54c150acfc` |
| Runtime dependency | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Studio target | Studio Next / `studioNext`, chain ID `61997` |
| Canonical RPC | `https://studio-next.genlayer.com/api` |
| Studio deployment source SHA-256 | `deda418529318e01b7bd3a0766fea648304378eb730e348537037442f3f991c7` |

## Local validation

`python -m pytest tests/direct -v --contracts-dir contracts` completed with **28 passed** on this exact readable source. The suite includes the regression that rejects a 30-day refund directly from `SUBMITTED` or `DISPUTED`, the two states that previously allowed a requester to starve a completed worker.

## Studio Next deployment path

The stable runtime hash in the readable source is not the Studio Next selector and produces `invalid_contract runner malformed` there. GenLayer's referenced v0.3.x bootstrapper uses `py-genlayer:test`; with that selector, the Docket bootstrapper schema loads successfully on Studio Next. That runtime retains the legacy `gl.vm.run_nondet_default` name, so the generated Studio target maps the canonical source's current `run_nondet_unsafe` call to the compatible two-callback API. The full source exceeds the single-transaction execution limit and is installed through the bootstrap path below.

The deploy kit follows GenLayer's official single-address bootstrap mechanism: deploy `contracts/docket_bootstrapper.py`, append the generated Studio source in eight ordered 6,000-byte-or-smaller calls, then call `finish()` to install Docket at the same address. See [BOOTSTRAP_DEPLOY.md](BOOTSTRAP_DEPLOY.md).

## Deployment claim

The public manifest now pins the verified Studio Next release at `0xa6f640F8bb879c9336F9D5A0a8fBdD4f810Af7B3`. The bootstrap deployment and final activation both finalized with successful execution; the live 46,719-byte source hash is `deda418529318e01b7bd3a0766fea648304378eb730e348537037442f3f991c7`, and the schema exposes 11 Docket methods. Four founder-operated tasks now cover acceptance, dispute, appeal, and recovery. Disputed case `dkt-dispute-7030-20260912` independently verified PR #2 and its successful Actions run, returned `PASS / PASS / FAIL`, and split 1 GEN into 0.7 GEN for the worker and 0.3 GEN for the requester. The finalized contract balance is zero.
