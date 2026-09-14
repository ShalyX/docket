# Studio Next preflight and bootstrap resolution

## Target verified

| Field | Observed value |
| --- | --- |
| RPC | `https://studio-next.genlayer.com/api` |
| `eth_chainId` | `0xf22d` (61997) |
| SDK / CLI release family selected | `genlayer-js@2.0.0-rc.1`, `genlayer@0.40.0-rc.3` |
| SDK chain definition | Docket's `studioNext` override, based on the RC1 `studioDevnet` metadata |

## Read-only schema request

The Studio Next branch of the matching RC SDK calls:

```text
gen_getContractSchemaForCode([0x + UTF-8 contract source encoded as hex])
```

The original Docket source used the stable pinned dependency header:

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

Studio Next returned `VM_ERROR: invalid_contract runner malformed` for that dependency. GenLayer's v0.3.x bootstrapper example instead uses:

```python
# { "Depends": "py-genlayer:test" }
```

With `py-genlayer:test`, the 3 KB Docket bootstrapper returns a valid schema from the canonical Studio Next RPC, exposing `push_code(bytes)` and `finish()`. The full 46 KB Docket source also gets past runner loading with this selector, then exits during schema generation because it exceeds the one-shot execution envelope. This matches the GenLayer co-founder's direction to split deployment into gas-safe writes. A live disputed-case preflight later established that this selector exposes `gl.vm.run_nondet_default` rather than the current `gl.vm.run_nondet_unsafe` name, so the generated Studio target maps that one call while preserving the same leader and validator callbacks.

## Deployment path

1. Deploy `contracts/docket_bootstrapper.py` on Studio Next.
2. Submit the eight ordered payloads in `deploy/bootstrap/chunk-01.txt` through `chunk-08.txt` to `push_code`.
3. Call `finish()` once.
4. Reload the deployed address and verify Docket's 11-method schema, the expected current task count, and the source SHA-256 recorded in `deploy/bootstrap/manifest.json`.
5. Require successful finalization before placing the address and transaction ID in `frontend/public/release-manifest.json`.

Studio Next state can reset. The manifest must therefore retain the exact Studio transaction, contract address, source SHA-256, and deployment time for the active preview instance.
