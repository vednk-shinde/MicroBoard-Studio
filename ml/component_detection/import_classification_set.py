"""Import a folder-per-class image archive (e.g. archive.zip: <class>/<class>/<image>) for detection training.

Every file is opened and verified. Valid images are converted to RGB JPEG and written to
<out>/images/<class_slug>/. Nothing is removed silently: unreadable files, non-images, exact
duplicates and images that appear under two different classes are listed in <out>/import_report.md.

Usage:
    python ml/component_detection/import_classification_set.py <archive.zip> <out_dir>
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageOps

MIN_SIDE = 64  # smaller images carry too little detail to learn from


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main() -> int:
    archive, out = Path(sys.argv[1]), Path(sys.argv[2])
    image_root = out / "images"
    image_root.mkdir(parents=True, exist_ok=True)
    removed: list[dict] = []
    kept: Counter = Counter()
    by_hash: dict[str, list[tuple[str, str]]] = defaultdict(list)

    with zipfile.ZipFile(archive) as zipped:
        members = [name for name in zipped.namelist() if not name.endswith("/")]
        for member in members:
            class_name = member.split("/")[0]
            data = zipped.read(member)
            digest = hashlib.sha1(data).hexdigest()
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
                with Image.open(io.BytesIO(data)) as image:
                    image.seek(0)  # first frame of GIFs
                    rgb = ImageOps.exif_transpose(image).convert("RGB")
            except Exception as error:  # noqa: BLE001 - any decode failure means the file is unusable
                removed.append({"file": member, "class": class_name, "reason": f"not a readable image ({error.__class__.__name__})"})
                continue
            if min(rgb.size) < MIN_SIDE:
                removed.append({"file": member, "class": class_name, "reason": f"too small ({rgb.size[0]}x{rgb.size[1]})"})
                continue
            by_hash[digest].append((class_name, member))
            if len(by_hash[digest]) > 1:
                first_class, first_member = by_hash[digest][0]
                reason = "exact duplicate of " + first_member if first_class == class_name else f"same image also filed under '{first_class}' ({first_member})"
                removed.append({"file": member, "class": class_name, "reason": reason})
                continue
            target = image_root / slug(class_name)
            target.mkdir(exist_ok=True)
            rgb.save(target / f"{digest[:16]}.jpg", quality=92)
            kept[slug(class_name)] += 1

    # An image filed under two classes is ambiguous: drop the first copy as well and report it.
    for digest, entries in by_hash.items():
        classes = {class_name for class_name, _ in entries}
        if len(classes) > 1:
            first_class, first_member = entries[0]
            path = image_root / slug(first_class) / f"{digest[:16]}.jpg"
            if path.exists():
                path.unlink()
                kept[slug(first_class)] -= 1
                removed.append({"file": first_member, "class": first_class, "reason": f"same image filed under several classes: {sorted(classes)}"})

    summary = {"source": archive.name, "files": len(members), "kept": sum(kept.values()), "removed": len(removed), "per_class": dict(sorted(kept.items()))}
    (out / "import_summary.json").write_text(json.dumps({**summary, "removed_files": removed}, indent=2), encoding="utf-8")
    lines = [f"# Import report: `{archive.name}`", "", f"- Files in archive: {len(members)}", f"- Images kept: {summary['kept']}", f"- Removed: {len(removed)}", "",
             "## Images per class", "", "| Class | Images |", "|---|---|", *[f"| {name} | {count} |" for name, count in sorted(kept.items())], "",
             "## Removed files", "", "| Class | File | Reason |", "|---|---|---|", *[f"| {item['class']} | `{item['file']}` | {item['reason']} |" for item in removed]]
    (out / "import_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
