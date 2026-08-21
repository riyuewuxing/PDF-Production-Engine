from __future__ import annotations

import json
from pathlib import Path

import fitz
import pytest
import yaml

from pdf_production_engine.locked_source import (
    LockedSourceError,
    _git_blob_sha,
    run_locked_pages,
)


def _make_pdf(path: Path, pages: int = 3) -> None:
    doc = fitz.open()
    try:
        for index in range(1, pages + 1):
            page = doc.new_page()
            page.insert_text((72, 72), f"synthetic locked source page {index}")
        doc.save(path)
    finally:
        doc.close()


def test_locked_source_fetches_validates_and_extracts_selected_pages(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    _make_pdf(source, pages=3)
    spec = {
        "version": 1,
        "source_id": "synthetic-public-fixture",
        "urls": [source.as_uri()],
        "selected_pages": [1, 3],
        "retries_per_url": 1,
        "expected": {
            "size_bytes": source.stat().st_size,
            "git_blob_sha": _git_blob_sha(source),
            "magic": "%PDF-",
        },
    }
    spec_path = tmp_path / "locked-source.yaml"
    spec_path.write_text(yaml.safe_dump(spec, sort_keys=False), encoding="utf-8")

    evidence_path = run_locked_pages(spec_path, tmp_path / "out")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["status"] == "MACHINE_PASS"
    assert evidence["review_status"] == "REVIEW_REQUIRED"
    assert evidence["acquisition"]["git_blob_sha"] == spec["expected"]["git_blob_sha"]
    assert evidence["extraction"]["selected_pages"] == [1, 3]
    assert evidence["extraction"]["extracted_page_count"] == 2
    selected = evidence_path.parent / "selected-pages.pdf"
    with fitz.open(selected) as pdf:
        assert pdf.page_count == 2
        assert "page 1" in pdf[0].get_text()
        assert "page 3" in pdf[1].get_text()


def test_locked_source_rejects_identity_mismatch(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    _make_pdf(source, pages=1)
    spec = {
        "version": 1,
        "urls": [source.as_uri()],
        "selected_pages": [1],
        "retries_per_url": 1,
        "expected": {
            "git_blob_sha": "0" * 40,
            "magic": "%PDF-",
        },
    }
    spec_path = tmp_path / "bad-locked-source.yaml"
    spec_path.write_text(yaml.safe_dump(spec, sort_keys=False), encoding="utf-8")

    with pytest.raises(LockedSourceError, match="all locked-source transports failed"):
        run_locked_pages(spec_path, tmp_path / "out")
