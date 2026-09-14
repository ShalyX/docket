"""Package the files needed for Docket's Studio Next bootstrap deployment."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT.parent / "Docket-Studio-Next-bootstrap-deploy.zip"
FILES = [
    ROOT / "BOOTSTRAP_DEPLOY.md",
    ROOT / "contracts" / "docket_bootstrapper.py",
    ROOT / "deploy" / "bootstrap" / "docket.studio.py",
    ROOT / "deploy" / "bootstrap" / "manifest.json",
    ROOT / "deploy" / "bootstrap" / "upload-transactions.json",
    ROOT / "deploy" / "deployment-record.json",
    *sorted((ROOT / "deploy" / "bootstrap").glob("chunk-*.txt")),
]

with ZipFile(ARCHIVE, "w", compression=ZIP_DEFLATED) as archive:
    for path in FILES:
        archive.write(path, Path("Docket-bootstrap-deploy") / path.relative_to(ROOT))

print(ARCHIVE)
