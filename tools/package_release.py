"""Create the shareable Docket pilot-release source archive."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


SOURCE_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_PATH = SOURCE_ROOT.parent / "Docket-Studio-Next-ready-2026-09-14.zip"
EXCLUDED_DIRECTORIES = {
    ".git",
    ".tooling-check",
    ".tooling-genvm-executor",
    ".npm-cache",
    ".pytest_cache",
    "__pycache__",
    "artifacts",
    "demo-production",
    "dist",
    "node_modules",
}


def include(path: Path) -> bool:
    relative = path.relative_to(SOURCE_ROOT)
    if any(part in EXCLUDED_DIRECTORIES for part in relative.parts):
        return False
    if any(part.startswith("pytest-cache-files-") for part in relative.parts):
        return False
    if path.suffix in {".pyc", ".pyo"}:
        return False
    if path.name.endswith(".local.json"):
        return False
    return not (path.name.startswith(".env") and path.name != ".env.example")


with ZipFile(ARCHIVE_PATH, "w", compression=ZIP_DEFLATED) as archive:
    for path in sorted(SOURCE_ROOT.rglob("*")):
        if path.is_file() and include(path):
            archive.write(path, path.relative_to(SOURCE_ROOT.parent))

print(ARCHIVE_PATH)
