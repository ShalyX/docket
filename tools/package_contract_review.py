"""Create a minimal, secret-free Docket contract review archive."""

from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


SOURCE_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_PATH = SOURCE_ROOT.parent / "Docket-Studio-Next-contract-review.zip"
ARCHIVE_ROOT = "Docket-contract-review"
REVIEW_FILES = (
    "TEAM_REVIEW.md",
    "TEAM_REPLY.md",
    "STUDIO_NEXT_PREFLIGHT.md",
    "README.md",
    "ARCHITECTURE.md",
    "docket.yml",
    "requirements.txt",
    "contracts/docket.py",
    "deploy/deployment-record.json",
    "deploy/dispute-pilot-attempt-1.json",
    "deploy/dispute-pilot-case.json",
    "frontend/public/release-manifest.json",
    "tests/direct/test_docket.py",
    "tests/direct/conftest.py",
)


def archive_name(relative_path: str) -> str:
    return f"{ARCHIVE_ROOT}/{relative_path}"


with ZipFile(ARCHIVE_PATH, "w", compression=ZIP_DEFLATED) as archive:
    checksums = []
    for relative_path in REVIEW_FILES:
        path = SOURCE_ROOT / relative_path
        content = path.read_bytes()
        archive.writestr(archive_name(relative_path), content)
        checksums.append(f"{sha256(content).hexdigest()}  {relative_path}")
    archive.writestr(archive_name("SHA256SUMS.txt"), "\n".join(checksums) + "\n")

print(ARCHIVE_PATH)
