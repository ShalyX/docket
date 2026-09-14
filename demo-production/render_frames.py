from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).parent
CAPTURES = ROOT / "captures"
SCENES = ROOT / "scenes"
SCENES.mkdir(exist_ok=True)

W, H = 1920, 1080
CREAM = "#f2eee4"
GREEN = "#0f3d2e"
DEEP = "#08271f"
MINT = "#9ed6a5"
CORAL = "#e45b42"
INK = "#15231d"
MUTED = "#9aac9f"
SERIF = Path(r"C:\Windows\Fonts\georgiab.ttf")
SANS = Path(r"C:\Windows\Fonts\arial.ttf")
MONO = Path(r"C:\Windows\Fonts\consola.ttf")


def font(path, size):
    return ImageFont.truetype(str(path), size)


def wrap(draw, text, fnt, max_width):
    words = text.split()
    lines, line = [], ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=fnt)[2] <= max_width:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def base(light=False):
    im = Image.new("RGB", (W, H), CREAM if light else DEEP)
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, W, 12), fill=CORAL)
    draw.text((72, 48), "DOCKET", font=font(MONO, 28), fill=CORAL if light else MINT)
    draw.text((W - 320, 51), "ONCHAIN JUSTICE", font=font(MONO, 19), fill="#687b70" if light else MUTED)
    return im


def label(draw, text, x=72, y=145, light=False):
    draw.text((x, y), text.upper(), font=font(MONO, 22), fill=CORAL if light else MINT)


def title(draw, text, x, y, width, size=64, color=CREAM, spacing=8):
    fnt = font(SERIF, size)
    lines = wrap(draw, text, fnt, width)
    line_h = size + spacing
    for index, line in enumerate(lines):
        draw.text((x, y + index * line_h), line, font=fnt, fill=color)
    return y + len(lines) * line_h


def subtitle(draw, text, x, y, width, color=MUTED, size=28):
    fnt = font(SANS, size)
    for index, line in enumerate(wrap(draw, text, fnt, width)):
        draw.text((x, y + index * (size + 12)), line, font=fnt, fill=color)


def place_capture(im, name, box, shadow=True):
    shot = Image.open(CAPTURES / name).convert("RGB")
    max_w, max_h = box[2] - box[0], box[3] - box[1]
    shot.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    x = box[0] + (max_w - shot.width) // 2
    y = box[1] + (max_h - shot.height) // 2
    if shadow:
        mask = Image.new("L", (shot.width + 50, shot.height + 50), 0)
        ImageDraw.Draw(mask).rounded_rectangle((18, 18, shot.width + 32, shot.height + 32), 18, fill=180)
        blur = mask.filter(ImageFilter.GaussianBlur(18))
        shade = Image.new("RGB", mask.size, "#000000")
        im.paste(shade, (x - 25, y - 15), blur)
    im.paste(shot, (x, y))


def save(im, number):
    im.save(SCENES / f"scene-{number:02}.png", quality=95)


im = base()
d = ImageDraw.Draw(im)
label(d, "The settlement problem")
d.text((72, 225), "70%", font=font(SERIF, 220), fill=MINT)
title(d, "of the agreement shipped.", 650, 255, 1100, 74)
subtitle(d, "Should escrow pay 0% or 100%?", 655, 470, 1000, CREAM, 42)
d.rounded_rectangle((650, 610, 1670, 710), 18, outline="#315f50", width=3)
d.rectangle((650, 610, 1364, 710), fill=MINT)
d.rectangle((1364, 610, 1670, 710), fill=CORAL)
d.text((650, 755), "The missing 30% still matters.", font=font(MONO, 24), fill=MUTED)
save(im, 1)

im = base(light=True)
d = ImageDraw.Draw(im)
label(d, "Verified deployment", light=True)
title(d, "A live settlement engine.", 72, 190, 640, 62, INK)
subtitle(d, "Studio Next · source hash matched · 11 required methods · four recorded cases", 76, 360, 650, "#53635a", 27)
place_capture(im, "verified-release.png", (760, 130, 1840, 970))
save(im, 2)

im = base()
d = ImageDraw.Draw(im)
label(d, "Terms before review")
title(d, "One GEN. Three weighted criteria.", 72, 205, 760, 70)
subtitle(d, "The requester froze the checklist before delivery. The worker submitted a public PR, exact commit, and successful Actions run.", 76, 430, 680, CREAM, 30)
place_capture(im, "dispute-overview.png", (800, 180, 1800, 470))
d.rounded_rectangle((820, 570, 1780, 825), 20, fill=GREEN, outline="#2e6a55", width=2)
d.text((875, 620), "docket.yml", font=font(MONO, 34), fill=MINT)
d.text((1210, 620), "PR + commit", font=font(MONO, 34), fill=CREAM)
d.text((1510, 620), "CI run", font=font(MONO, 34), fill=CREAM)
d.line((1040, 700, 1170, 700), fill=CORAL, width=5)
d.line((1420, 700, 1480, 700), fill=CORAL, width=5)
d.text((875, 750), "Bound into one public evidence record", font=font(SANS, 28), fill=MUTED)
save(im, 3)

im = base()
d = ImageDraw.Draw(im)
label(d, "Validator result")
title(d, "Two passed. One failed.", 72, 185, 760, 76)
subtitle(d, "GenLayer validators independently fetched the public evidence and evaluated each frozen criterion.", 76, 390, 690, CREAM, 30)
place_capture(im, "dispute-review.png", (790, 120, 1860, 1010))
d.text((75, 700), "PASS", font=font(MONO, 40), fill=MINT)
d.text((260, 700), "PASS", font=font(MONO, 40), fill=MINT)
d.text((445, 700), "FAIL", font=font(MONO, 40), fill=CORAL)
save(im, 4)

im = base()
d = ImageDraw.Draw(im)
label(d, "Onchain settlement")
title(d, "The verdict became the payout.", 72, 190, 780, 74)
subtitle(d, "0.7 GEN to the worker. 0.3 GEN returned to the requester. Finalized transaction. Zero contract balance.", 76, 410, 690, CREAM, 30)
place_capture(im, "dispute-resolution.png", (810, 180, 1840, 820))
d.text((840, 850), "FINALIZED · FINISHED_WITH_RETURN", font=font(MONO, 23), fill=MINT)
save(im, 5)

im = base(light=True)
d = ImageDraw.Draw(im)
label(d, "Why GenLayer", light=True)
title(d, "Evidence in. Weighted payment out.", 72, 180, 1100, 68, INK)
nodes = [(100, 520, 500, 700, "PUBLIC GITHUB", "PR · COMMIT · CI"), (760, 520, 1160, 700, "GENLAYER", "CRITERION VERDICTS"), (1420, 520, 1820, 700, "CONTRACT", "DETERMINISTIC SPLIT")]
for x1, y1, x2, y2, top, bottom in nodes:
    d.rounded_rectangle((x1, y1, x2, y2), 18, fill="#fffaf0", outline="#b8c1b9", width=3)
    d.text((x1 + 35, y1 + 35), top, font=font(MONO, 25), fill=CORAL)
    d.text((x1 + 35, y1 + 100), bottom, font=font(SANS, 25), fill=INK)
for start, end in [((525, 610), (730, 610)), ((1185, 610), (1390, 610))]:
    d.line((*start, *end), fill=GREEN, width=8)
    d.polygon([(end[0], end[1]), (end[0] - 24, end[1] - 14), (end[0] - 24, end[1] + 14)], fill=GREEN)
subtitle(d, "Validators judge the evidence. The contract owns state and arithmetic.", 420, 810, 1100, "#53635a", 32)
save(im, 6)

im = base()
d = ImageDraw.Draw(im)
label(d, "Ordinary path")
title(d, "Requester accepts. Full escrow releases.", 72, 195, 770, 66)
subtitle(d, "The same deployed contract also finalized the 100/0 path.", 76, 430, 650, CREAM, 30)
place_capture(im, "acceptance-resolution.png", (800, 200, 1840, 820))
save(im, 7)

im = base(light=True)
d = ImageDraw.Draw(im)
label(d, "Consensus appeals", light=True)
title(d, "A real appeal lifecycle, not a UI promise.", 72, 170, 740, 62, INK)
subtitle(d, "A separate founder-operated case exercised GenLayer's native appeal path through finality.", 76, 405, 650, "#53635a", 29)
place_capture(im, "appeal-consensus.png", (800, 110, 1850, 1010))
save(im, 8)

im = base()
d = ImageDraw.Draw(im)
label(d, "Docket")
title(d, "Release what shipped.", 72, 210, 1100, 100)
subtitle(d, "The GitHub-native primitive works end to end. External pilot next.", 78, 500, 1100, CREAM, 34)
d.text((78, 650), "CONTRACT", font=font(MONO, 21), fill=MINT)
d.text((78, 700), "0xa6f640F8…810Af7B3", font=font(MONO, 34), fill=CREAM)
d.text((78, 800), "PUBLIC PROOF REPO", font=font(MONO, 21), fill=MINT)
d.text((78, 850), "github.com/ShalyX/touchline-relay", font=font(MONO, 32), fill=CREAM)
d.text((1500, 840), "AGENT TANK", font=font(MONO, 24), fill=CORAL)
save(im, 9)

print(SCENES)
