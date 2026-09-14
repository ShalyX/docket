"""Prepare ordered, gas-safe Docket source chunks for the GenVM bootstrapper."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts" / "docket.py"
OUTPUT = ROOT / "deploy" / "bootstrap"
STUDIO_SOURCE = OUTPUT / "docket.studio.py"
CHUNK_BYTES = 6_000
PINNED_HEADER = b'# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }'
STUDIO_HEADER = b'# { "Depends": "py-genlayer:test" }'
PINNED_NONDET_RUNNER = b"gl.vm.run_nondet_unsafe(leader_fn, validator_fn)"
STUDIO_NONDET_RUNNER = b"gl.vm.run_nondet_default(leader_fn, validator_fn)"


source = SOURCE.read_bytes()
if not source.startswith(PINNED_HEADER):
    raise RuntimeError("Unexpected Docket dependency header; refusing to prepare deployment chunks")
source = STUDIO_HEADER + source[len(PINNED_HEADER) :]
if source.count(PINNED_NONDET_RUNNER) != 1:
    raise RuntimeError("Unexpected nondeterminism runner call; refusing to prepare Studio target")
source = source.replace(PINNED_NONDET_RUNNER, STUDIO_NONDET_RUNNER)
chunks = [source[offset : offset + CHUNK_BYTES] for offset in range(0, len(source), CHUNK_BYTES)]
OUTPUT.mkdir(parents=True, exist_ok=True)
STUDIO_SOURCE.write_bytes(source)

expected_names = {f"chunk-{index:02d}.txt" for index in range(1, len(chunks) + 1)}
for old_chunk in OUTPUT.glob("chunk-*.txt"):
    if old_chunk.name not in expected_names:
        old_chunk.unlink()

manifest = {
    "source": "deploy/bootstrap/docket.studio.py",
    "source_origin": "contracts/docket.py",
    "runtime_dependency": "py-genlayer:test",
    "runtime_compatibility": "run_nondet_unsafe mapped to legacy run_nondet_default",
    "source_bytes": len(source),
    "source_sha256": hashlib.sha256(source).hexdigest(),
    "chunk_bytes": CHUNK_BYTES,
    "chunk_count": len(chunks),
    "encoding": "GenLayer CLI bytes argument: b# followed by lowercase hex",
    "chunks": [],
}

for index, chunk in enumerate(chunks, start=1):
    name = f"chunk-{index:02d}.txt"
    encoded = f"b#{chunk.hex()}"
    (OUTPUT / name).write_text(encoded, encoding="ascii", newline="\n")
    manifest["chunks"].append(
        {
            "index": index,
            "file": name,
            "bytes": len(chunk),
            "sha256": hashlib.sha256(chunk).hexdigest(),
        }
    )

(OUTPUT / "manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n",
    encoding="utf-8",
    newline="\n",
)

print(json.dumps(manifest, indent=2))
