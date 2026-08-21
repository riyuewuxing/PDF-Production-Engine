from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from .cli import ManifestError, preflight_and_render
from .job_protocol import JobProtocolError, load_job


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe_relative(root: Path, relative: str) -> Path:
    p = Path(relative)
    if not relative or p.is_absolute():
        raise JobProtocolError(f"path must be non-empty and relative: {relative!r}")
    root = root.resolve()
    target = (root / p).resolve()
    if root != target and root not in target.parents:
        raise JobProtocolError(f"path escapes build package root: {relative}")
    return target


def _inspect_output(path: Path, evidence_dir: Path, dpi: int) -> dict:
    item = {
        "filename": path.name,
        "size_bytes": path.stat().st_size,
        "sha256": _sha256(path),
    }
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        render_dir = evidence_dir / "rendered" / path.stem
        item["media_type"] = "application/pdf"
        item["pdf_qa"] = preflight_and_render(path, render_dir, dpi)
    elif suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        with Image.open(path) as im:
            item["media_type"] = f"image/{'jpeg' if suffix in {'.jpg', '.jpeg'} else suffix.lstrip('.')}"
            item["width_px"] = im.width
            item["height_px"] = im.height
            if im.width <= 0 or im.height <= 0:
                raise JobProtocolError(f"invalid image geometry: {path.name}")
    else:
        item["media_type"] = "application/octet-stream"
    return item


def run_block(root: Path, job_relative: str, block_id: str, out_root: Path, dpi: int = 144) -> Path:
    root = root.resolve()
    job_path = _safe_relative(root, job_relative)
    job = load_job(job_path)
    blocks = {b["block_id"]: b for b in job["blocks"]}
    block = blocks.get(block_id)
    if block is None:
        raise JobProtocolError(f"block not found: {block_id}")

    command = block.get("command")
    if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
        raise JobProtocolError(f"block {block_id} requires command as argv list")
    expected = block.get("expected_outputs")
    if not isinstance(expected, list) or not expected or not all(isinstance(x, str) and x for x in expected):
        raise JobProtocolError(f"block {block_id} requires expected_outputs")

    block_out = (out_root.resolve() / job["job_id"] / block_id)
    block_out.mkdir(parents=True, exist_ok=True)
    values = {
        "root": str(root),
        "output_dir": str(block_out),
    }
    argv = [token.format(**values) for token in command]
    proc = subprocess.run(argv, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (block_out / "backend.log").write_text(proc.stdout or "", encoding="utf-8")
    if proc.returncode:
        raise JobProtocolError(f"block command failed: {block_id}: exit={proc.returncode}")

    outputs = []
    for rel in expected:
        path = _safe_relative(block_out, rel)
        if not path.is_file() or path.stat().st_size <= 0:
            raise JobProtocolError(f"expected block output missing/empty: {block_id}: {rel}")
        outputs.append(_inspect_output(path, block_out, dpi))

    evidence = {
        "engine": "PDF-Production-Engine",
        "job_id": job["job_id"],
        "stage": job["stage"],
        "block_id": block_id,
        "kind": block.get("kind"),
        "status": "MACHINE_PASS",
        "review_status": "REVIEW_REQUIRED",
        "built_at": datetime.now(timezone.utc).isoformat(),
        "outputs": outputs,
    }
    evidence_path = block_out / "block-evidence.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"RESOURCE_BLOCK_MACHINE_PASS job={job['job_id']} block={block_id} outputs={len(outputs)}")
    print("REVIEW_REQUIRED: ChatGPT must inspect block evidence before composition")
    print(f"OUTPUT_DIR={block_out}")
    return evidence_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-resource-run")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--job", required=True)
    parser.add_argument("--block", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dpi", type=int, default=144)
    args = parser.parse_args(argv)
    try:
        if not 72 <= args.dpi <= 300:
            raise JobProtocolError("dpi must be between 72 and 300")
        run_block(args.root, args.job, args.block, args.out, args.dpi)
        return 0
    except (OSError, JobProtocolError, ManifestError) as exc:
        print(f"RESOURCE_BLOCK_FAIL: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
