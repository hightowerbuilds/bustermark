"""Prepare disposable native acceptance assets; run `bun run build` first."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("kind", choices=["print", "split", "spread", "assistant", "scheme", "command-bar", "attachments"])
parser.add_argument("--only", choices=["courier", "polish", "emphasis"], help="run a single section of the spread smoke test")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
dist = Path(tempfile.mkdtemp(prefix=f"buster-mac-{args.kind}-smoke-", dir="/private/tmp"))
shutil.copytree(root / "dist", dist, dirs_exist_ok=True)
harness = f"native-macos-{args.kind}-smoke.js"
shutil.copy2(root / "scripts" / harness, dist / harness)
index = dist / "index.html"
only = f'<script>window.__SMOKE_ONLY__ = "{args.only}";</script>' if args.only else ""
index.write_text(index.read_text().replace("</body>", f'{only}<script src="/{harness}"></script></body>'))
# Tauri internals are read-only. Route only this disposable bundle through the
# harness fixture; the normal app never includes the hook or harness.
hook = {"print": "__PRINT_SMOKE_INVOKE__", "attachments": "__ATTACH_SMOKE_INVOKE__"}.get(args.kind)
if hook:
    routed = 0
    for asset in (dist / "assets").glob("*.js"):
        content = asset.read_text()
        routed += content.count("window.__TAURI_INTERNALS__.invoke(")
        asset.write_text(content.replace("window.__TAURI_INTERNALS__.invoke(",
            f"(window.{hook} || window.__TAURI_INTERNALS__.invoke)("))
    if routed == 0:
        raise RuntimeError("Could not route invoke in the disposable bundle")
identifier = f"com.lukehightower.buster.parity-smoke-{args.kind}-{uuid.uuid4().hex}"
config = {"identifier": identifier, "build": {"frontendDist": str(dist)},
    "app": {"windows": [{"title": f"BusterMark {args.kind.title()} Smoke", "width": 1400,
                         "height": 900, "closable": True}]}}
prefix = Path(f"/private/tmp/bustermark-macos-{args.kind}-smoke")
Path(f"{prefix}-config.json").write_text(json.dumps(config))
Path(f"{prefix}-dist.txt").write_text(str(dist))
notes = Path.home() / "Library/Application Support" / identifier / "Notes"
if args.kind == "scheme":
    # A calm shader for the last stage, saved where the app keeps backgrounds (not selected yet).
    backgrounds = notes.parent / "backgrounds"
    backgrounds.mkdir(parents=True, exist_ok=True)
    (backgrounds / "bg-smoke.wgsl").write_text(
        "@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {\n"
        "  let uv = pos.xy / u.resolution;\n"
        "  let w = 0.5 + 0.5 * sin(uv.x * 5.0 + uv.y * 3.0 + u.time * 0.2);\n"
        "  return mix(u.paper, u.accent, w * 0.35 * u.strength);\n}\n")
    (backgrounds / "index.json").write_text(json.dumps({"version": 1, "selected": None, "strength": 0.35, "animate": False,
        "items": [{"id": "bg-smoke", "name": "Smoke waves", "prompt": "", "createdAt": 1, "updatedAt": 1}]}))
if args.kind == "attachments":
    # Real files to drop and pick: solid-color PNGs (one larger than the 1568 px shrink),
    # a text file with a word the model must repeat, and files the chat must refuse.
    import struct, zlib
    def png(width, height, rgb):
        row = b"\x00" + bytes(rgb) * width
        chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(row * height, 9)) + chunk(b"IEND", b""))
    fixtures = notes / "attach-fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / "red.png").write_bytes(png(64, 64, (220, 20, 20)))
    (fixtures / "big-blue.png").write_bytes(png(3000, 2000, (20, 40, 220)))
    (fixtures / "marigold.txt").write_text("Field notes.\nThe secret word is marigold.\n")
    (fixtures / "huge.txt").write_text("a" * (300 * 1024))
    (fixtures / "report.pdf").write_bytes(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n\x00\x00")
    for i in range(1, 10):
        (fixtures / f"t{i}.txt").write_text(f"small file {i}\n")
Path(f"{prefix}-root.txt").write_text(str(notes))
print(f"Config: {prefix}-config.json")
print(f"Report: {notes}/{harness.removesuffix('.js')}-result.json")
