from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).parent
OUTPUT = ROOT.parent.parent / "Docket-Agent-Tank-demo-package.zip"
THUMBNAIL = ROOT.parent / "brandkit" / "social" / "docket-youtube-thumbnail.png"
FILES = [
    "Docket-Agent-Tank-demo-1080p-captioned.mp4",
    "Docket-Agent-Tank-demo-1080p.mp4",
    "Docket-Agent-Tank-demo.srt",
    "voiceover.wav",
    "job-card.md",
    "evidence-map.md",
    "capture-plan.md",
    "script.md",
    "storyboard.md",
    "qa-report.md",
    "capture.cjs",
    "render_frames.py",
    "render_video.ps1",
]

with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED) as archive:
    for name in FILES:
        archive.write(ROOT / name, f"Docket-demo/{name}")
    for folder in ("captures", "scenes"):
        for path in sorted((ROOT / folder).glob("*.png")):
            archive.write(path, f"Docket-demo/{folder}/{path.name}")
    archive.write(THUMBNAIL, "Docket-demo/docket-youtube-thumbnail.png")

print(OUTPUT)
