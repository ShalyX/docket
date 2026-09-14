# Docket single-address bootstrap deployment

This follows GenLayer's official GenVM bootstrapper mechanism. The bootstrapper is deployed first at the final Docket address. Ordered calls stage the full Docket source in smaller transactions, and `finish()` replaces the bootstrapper code at that same address.

## Studio Next flow

1. Upload `contracts/docket_bootstrapper.py` to Studio Next and deploy it with `save_default_locked_slots` set to `true`.
2. Keep the resulting address. Every remaining call targets this same address.
3. Call `push_code` once for each file in `deploy/bootstrap`, strictly from `chunk-01.txt` through the final chunk. The files use the CLI bytes syntax `b#<hex>`.
4. Wait for each `push_code` transaction to succeed before sending the next one. Never retry a successful chunk: `push_code` appends, so a duplicate changes the final source.
5. Call `finish()` exactly once. After it succeeds, the bootstrapper methods disappear and the Docket methods become available at the same address.
6. Reload the contract schema at that address and call `get_task_count()`. The expected initial result is `0`.
7. Fetch the deployed code and verify its SHA-256 against `deploy/bootstrap/manifest.json` before updating the public release manifest.

Both the bootstrapper and generated `deploy/bootstrap/docket.studio.py` use `py-genlayer:test`, matching the Studio Next runtime selector in GenLayer's referenced `v0.3.x` example. That runtime exposes the legacy `gl.vm.run_nondet_default` name, so the generated Studio target also maps the canonical source's `gl.vm.run_nondet_unsafe` call to that compatible two-callback API. The canonical readable source remains `contracts/docket.py` and continues to use the current SDK name.

The Studio form may render `bytes` as a hex input rather than CLI syntax. If so, paste the chunk without the leading `b#` and use the hex prefix the form displays. Do not decode or edit the payload.

## Critical operational rule

The upstream bootstrapper methods are intentionally open. Complete the ordered chunk sequence promptly from the same account, and use a fresh address if any chunk order or receipt is uncertain. Do not put escrow into the address until `finish()`, schema reload, `get_task_count()`, and the source-hash check all pass.

Upstream reference:

- https://github.com/genlayerlabs/genvm-executor/blob/v0.3.x/tests/integration/storage/bootstrapper/bootstrapper.py
- https://github.com/genlayerlabs/genvm-executor/blob/v0.3.x/tests/integration/storage/bootstrapper/bootstrapper.jsonnet
