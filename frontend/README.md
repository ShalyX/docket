# Docket web app

This browser client supports Docket's public-GitHub pilot flow. A requester funds a defined task, a worker submits a public pull-request evidence manifest, and the configured GenLayer contract independently checks public GitHub facts before settlement.

The app ships with the verified Studio Next contract address and no demo task, wallet key, or fake receipt. It only enables mutations when a connected wallet and the manifest-pinned v2 contract are present.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. Use `npm run build` for the production bundle.

## Configure a release

Use **Release configuration** to select a network and enter a deployed v2 contract address. The value stays only in this browser. The app calls `get_task_count`, fetches contract schema and code, and checks the required v2 methods before enabling writes. A manifest marked `deployed` is stricter: the selected address and network must match the manifest, its source SHA-256 must match deployed code, and its referenced deployment transaction must be finalized successfully. This verifies a manifest-pinned address and code configuration; it does not establish that the referenced transaction deployed that address. Any manually entered address is labelled developer configuration rather than a pinned public release.

`public/release-manifest.json` pins the live Studio Next address, required RPC, activation transaction, explorer base URL, and source hash.

For a development default, copy `.env.example` to `.env.local` and set values safe to expose in a browser bundle:

```bash
VITE_DOCKET_NETWORK=studioNext
VITE_DOCKET_CONTRACT_ADDRESS=
```

Never put a private key, GitHub token, or repository secret in the frontend, release manifest, or `docket.yml`. Docket v2 accepts public GitHub evidence only.

## Pilot workflow

1. A requester enters a known non-zero worker address, public GitHub repository, and 2–5 weighted acceptance criteria totaling 10,000 basis points. The browser prepares the canonical v2 `docket.yml`, requires a copy or download and a public-root commit acknowledgement before it permits funding, keeps the exact generated file in browser storage for recovery, and passes its normalized SHA-256 as `config_sha256` to `register_task`. The contract verifies the hash against its own rendering of the full terms and preflights the public repository.
2. The requester commits that exact public file before the worker opens a delivery PR, vendors the companion Action at `.docket/github-action`, and copies the supplied target-repository workflow. Its checkout is pinned to the submitted PR head with `persist-credentials: false`.
3. The worker opens a public pull request. The Action writes the flat manifest and separate proof JSON to the job summary. The proof is convenient browser handoff metadata; it is not a contract argument.
4. The worker pastes both JSON outputs into the case. The browser requires both, validates the supported proof schema, task, repository, exact manifest hash, root config path/hash, Actions-run ID against the manifest, and positive workflow-run attempt, then submits only the exact three-field manifest.
5. The requester accepts, disputes, or both parties resolve using the GenLayer contract. `accept_delivery` is a requester-authorized full payout and does not fetch GitHub. For a disputed resolution, the contract independently fetches root `docket.yml` from the public PR head repository at the submitted head and only settles when its normalized hash and canonical v2 terms match registration. This permits a public fork PR while the PR base repository and a successful `pull_request` Actions run linked to the submitted PR still must match the task repository.
6. The app stores the submitted transaction ID locally, tracks finalization, and displays child payout transactions returned by GenLayer.
7. Any loaded case can export a compact public JSON receipt with its frozen terms, bounded evidence summary, criterion findings, settlement amounts, and protocol status. Raw patches and logs are excluded from the export.
8. For `NEEDS_EVIDENCE`, the requester action shows the projected earliest recovery time from onchain timestamps and stays gated while the contract window is closed; the contract remains authoritative.

This is a direct-agreement product. It does not claim to be a public worker marketplace or global task index.
