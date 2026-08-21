from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import fitz
import yaml


class LockedSourceError(ValueError):
    pass


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _git_blob_sha(path: Path) -> str:
    size = path.stat().st_size
    h = hashlib.sha1()
    h.update(f"blob {size}\0".encode())
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_spec(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if data.get("version") != 1:
        raise LockedSourceError("locked source spec must use version: 1")
    urls = data.get("urls")
    if not isinstance(urls, list) or not urls or not all(isinstance(x, str) and x for x in urls):
        raise LockedSourceError("locked source spec requires non-empty urls")
    pages = data.get("selected_pages")
    if not isinstance(pages, list) or not pages or not all(isinstance(x, int) and x > 0 for x in pages):
        raise LockedSourceError("selected_pages must contain positive 1-based page numbers")
    if len(set(pages)) != len(pages):
        raise LockedSourceError("selected_pages must not contain duplicates")
    expected = data.get("expected") or {}
    if not isinstance(expected, dict):
        raise LockedSourceError("expected must be a mapping")
    if not expected.get("git_blob_sha") and not expected.get("sha256"):
        raise LockedSourceError("expected must lock git_blob_sha and/or sha256")
    if expected.get("git_blob_sha") and len(str(expected["git_blob_sha"])) != 40:
        raise LockedSourceError("expected.git_blob_sha must be a 40-character Git blob SHA")
    if expected.get("sha256") and len(str(expected["sha256"])) != 64:
        raise LockedSourceError("expected.sha256 must be a 64-character SHA-256")
    return data


def validate_locked_file(path: Path, expected: dict) -> dict:
    if not path.is_file() or path.stat().st_size <= 0:
        raise LockedSourceError("locked source output is missing or empty")
    size = path.stat().st_size
    expected_size = expected.get("size_bytes")
    if expected_size is not None and size != int(expected_size):
        raise LockedSourceError(f"size mismatch: expected {expected_size}, got {size}")
    magic = expected.get("magic")
    if magic:
        raw_magic = str(magic).encode("utf-8")
        with path.open("rb") as fh:
            if fh.read(len(raw_magic)) != raw_magic:
                raise LockedSourceError(f"magic mismatch: expected {magic!r}")
    actual_git_blob = _git_blob_sha(path)
    expected_git_blob = expected.get("git_blob_sha")
    if expected_git_blob and actual_git_blob != str(expected_git_blob):
        raise LockedSourceError(
            f"git blob mismatch: expected {expected_git_blob}, got {actual_git_blob}"
        )
    actual_sha256 = _sha256(path)
    expected_sha256 = expected.get("sha256")
    if expected_sha256 and actual_sha256 != str(expected_sha256):
        raise LockedSourceError(f"sha256 mismatch: expected {expected_sha256}, got {actual_sha256}")
    return {
        "size_bytes": size,
        "git_blob_sha": actual_git_blob,
        "sha256": actual_sha256,
    }


def fetch_locked_source(spec: dict, target: Path) -> dict:
    expected = spec.get("expected") or {}
    retries = int(spec.get("retries_per_url", 2))
    if not 1 <= retries <= 5:
        raise LockedSourceError("retries_per_url must be between 1 and 5")
    timeout = int(spec.get("timeout_seconds", 90))
    if not 5 <= timeout <= 300:
        raise LockedSourceError("timeout_seconds must be between 5 and 300")

    target.parent.mkdir(parents=True, exist_ok=True)
    attempts: list[dict] = []
    for url_index, url in enumerate(spec["urls"]):
        for attempt in range(1, retries + 1):
            part = target.with_suffix(target.suffix + ".part")
            part.unlink(missing_ok=True)
            try:
                request = Request(
                    url,
                    headers={
                        "User-Agent": "pdf-production-engine-locked-source/1.0",
                        "Accept-Encoding": "identity",
                    },
                )
                with urlopen(request, timeout=timeout) as response, part.open("wb") as out:
                    shutil.copyfileobj(response, out, length=1024 * 1024)
                verified = validate_locked_file(part, expected)
                os.replace(part, target)
                attempts.append({"url_index": url_index, "attempt": attempt, "ok": True})
                return {"url_index": url_index, "attempts": attempts, **verified}
            except (HTTPError, URLError, TimeoutError, OSError, LockedSourceError) as exc:
                part.unlink(missing_ok=True)
                attempts.append(
                    {
                        "url_index": url_index,
                        "attempt": attempt,
                        "ok": False,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )
                if attempt < retries:
                    time.sleep(0.2)
    summary = "; ".join(
        f"url#{x['url_index']} attempt#{x['attempt']}={x.get('error', 'failed')}" for x in attempts
    )
    raise LockedSourceError(f"all locked-source transports failed: {summary}")


def extract_pdf_pages(source: Path, selected_pages: list[int], target: Path) -> dict:
    try:
        src = fitz.open(source)
    except Exception as exc:
        raise LockedSourceError(f"source cannot be opened as PDF: {exc}") from exc
    try:
        total = src.page_count
        if total <= 0:
            raise LockedSourceError("source PDF has no pages")
        for page in selected_pages:
            if page > total:
                raise LockedSourceError(f"selected page {page} exceeds source page count {total}")
        out = fitz.open()
        try:
            for page in selected_pages:
                out.insert_pdf(src, from_page=page - 1, to_page=page - 1)
            target.parent.mkdir(parents=True, exist_ok=True)
            out.save(target, garbage=4, deflate=True)
        finally:
            out.close()
    finally:
        src.close()
    if not target.is_file() or target.stat().st_size <= 0:
        raise LockedSourceError("page extraction produced no PDF")
    check = fitz.open(target)
    try:
        if check.page_count != len(selected_pages):
            raise LockedSourceError(
                f"extracted page count mismatch: expected {len(selected_pages)}, got {check.page_count}"
            )
    finally:
        check.close()
    return {
        "source_page_count": total,
        "selected_pages": selected_pages,
        "extracted_page_count": len(selected_pages),
        "output_size_bytes": target.stat().st_size,
        "output_sha256": _sha256(target),
    }


def run_locked_pages(spec_path: Path, out_dir: Path) -> Path:
    spec = load_spec(spec_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pdf-engine-locked-source-") as tmp:
        source = Path(tmp) / "source.bin"
        acquisition = fetch_locked_source(spec, source)
        selected = out_dir / "selected-pages.pdf"
        extraction = extract_pdf_pages(source, spec["selected_pages"], selected)

    evidence = {
        "engine": "PDF-Production-Engine",
        "capability": "locked-source-pages-v1",
        "source_id": spec.get("source_id"),
        "status": "MACHINE_PASS",
        "review_status": "REVIEW_REQUIRED",
        "acquisition": acquisition,
        "expected": spec.get("expected") or {},
        "extraction": extraction,
        "output": {
            "filename": selected.name,
            "sha256": extraction["output_sha256"],
        },
    }
    evidence_path = out_dir / "source-evidence.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return evidence_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-locked-pages")
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        evidence = run_locked_pages(args.spec, args.out)
        print(f"LOCKED_SOURCE_MACHINE_PASS evidence={evidence}")
        print("REVIEW_REQUIRED: inspect selected-pages.pdf pixels before accepting source-page block")
        return 0
    except (OSError, LockedSourceError, yaml.YAMLError) as exc:
        print(f"LOCKED_SOURCE_FAIL: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
