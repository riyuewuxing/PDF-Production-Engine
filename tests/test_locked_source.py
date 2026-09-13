from __future__ import annotations

import hashlib
import json
from pathlib import Path

import fitz
import pytest
import yaml

from pdf_production_engine.locked_source import (
    LockedSourceError,
    _git_blob_sha,
    _normalize_url,
    run_locked_pages,
)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _make_pdf(path: Path, pages: int = 3) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    try:
        for index in range(1, pages + 1):
            page = doc.new_page()
            page.insert_text((72, 72), f"synthetic locked source page {index}")
        doc.save(path)
    finally:
        doc.close()


def test_v1_url_transport_stays_backward_compatible(tmp_path: Path) -> None:
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


def test_v2_package_file_handles_private_bytes_unicode_and_spaces(tmp_path: Path) -> None:
    source = tmp_path / "inputs" / "普通高中教科书 选择性必修 第一册.pdf"
    _make_pdf(source, pages=4)
    spec = {
        "version": 2,
        "source_id": "pep-physics-selective-1",
        "identity": {
            "repository": "private/consumer",
            "path": "assets/普通高中教科书 选择性必修 第一册.pdf",
            "size_bytes": source.stat().st_size,
            "git_blob_sha": _git_blob_sha(source),
            "sha256": _sha256(source),
            "magic": "%PDF-",
        },
        "transport": {
            "kind": "package-file",
            "path": "inputs/普通高中教科书 选择性必修 第一册.pdf",
        },
        "selected_pages": [2, 4],
    }
    spec_path = tmp_path / "locked-source.yaml"
    spec_path.write_text(yaml.safe_dump(spec, allow_unicode=True, sort_keys=False), encoding="utf-8")

    evidence_path = run_locked_pages(spec_path, tmp_path / "out")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["capability"] == "locked-source-pages-v2"
    assert evidence["acquisition"]["transport_kind"] == "package-file"
    assert evidence["acquisition"]["sha256"] == spec["identity"]["sha256"]
    assert evidence["acquisition"]["git_blob_sha"] == spec["identity"]["git_blob_sha"]
    with fitz.open(evidence_path.parent / "selected-pages.pdf") as pdf:
        assert pdf.page_count == 2
        assert "page 2" in pdf[0].get_text()
        assert "page 4" in pdf[1].get_text()


def test_v2_package_file_rejects_identity_mismatch(tmp_path: Path) -> None:
    source = tmp_path / "inputs" / "source.pdf"
    _make_pdf(source, pages=1)
    spec = {
        "version": 2,
        "identity": {"git_blob_sha": "0" * 40, "magic": "%PDF-"},
        "transport": {"kind": "package-file", "path": "inputs/source.pdf"},
        "selected_pages": [1],
    }
    spec_path = tmp_path / "bad-locked-source.yaml"
    spec_path.write_text(yaml.safe_dump(spec, sort_keys=False), encoding="utf-8")

    with pytest.raises(LockedSourceError, match="git blob mismatch"):
        run_locked_pages(spec_path, tmp_path / "out")


def test_v2_package_file_rejects_path_escape(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside.pdf"
    _make_pdf(outside, pages=1)
    spec = {
        "version": 2,
        "identity": {"git_blob_sha": _git_blob_sha(outside), "magic": "%PDF-"},
        "transport": {"kind": "package-file", "path": "../outside.pdf"},
        "selected_pages": [1],
    }
    spec_path = tmp_path / "bad-path.yaml"
    spec_path.write_text(yaml.safe_dump(spec, sort_keys=False), encoding="utf-8")

    with pytest.raises(LockedSourceError, match="escapes package root"):
        run_locked_pages(spec_path, tmp_path / "out")


def test_http_url_normalization_encodes_unicode_and_spaces_without_touching_query() -> None:
    raw = "https://example.test/a/普通 高中.pdf?sig=a%2Fb&x=1"
    normalized = _normalize_url(raw)
    assert "普通" not in normalized
    assert " " not in normalized
    assert "%E6%99%AE" in normalized
    assert normalized.endswith("?sig=a%2Fb&x=1")
