from __future__ import annotations

import json
from pathlib import Path

import pytest

from pdf_production_engine.cli import ManifestError, build, load_manifest

ROOT = Path(__file__).resolve().parents[1]


def test_public_fixture_builds_and_renders_all_pages(tmp_path: Path) -> None:
    evidence_path = build(ROOT, "examples/hello/build.yaml", tmp_path, dpi=96)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["status"] == "MACHINE_PASS"
    assert evidence["visual_status"] == "HUMAN_PIXEL_CONFIRMATION_REQUIRED"
    assert evidence["qa"]["page_count"] >= 1
    assert evidence["qa"]["page_count"] == evidence["qa"]["rendered_page_count"]
    pdf_path = evidence_path.parent / evidence["pdf"]["filename"]
    assert pdf_path.is_file() and pdf_path.stat().st_size > 100
    renders = sorted((evidence_path.parent / "rendered").glob("page-*.png"))
    assert len(renders) == evidence["qa"]["page_count"]
    assert all(p.stat().st_size > 100 for p in renders)


def test_manifest_rejects_path_escape(tmp_path: Path) -> None:
    manifest = tmp_path / "build.yaml"
    manifest.write_text(
        "version: 1\n"
        "document_id: bad\n"
        "backend:\n  type: markdown-reportlab\n"
        "source:\n  path: ../secret.md\n"
        "output:\n  filename: bad.pdf\n",
        encoding="utf-8",
    )
    with pytest.raises(ManifestError):
        load_manifest(tmp_path, "build.yaml")


def test_command_backend_requires_argv_list(tmp_path: Path) -> None:
    manifest = tmp_path / "build.yaml"
    manifest.write_text(
        "version: 1\n"
        "document_id: bad-command\n"
        "backend:\n  type: command\n  command: python unsafe.py\n"
        "output:\n  filename: bad.pdf\n",
        encoding="utf-8",
    )
    with pytest.raises(ManifestError):
        load_manifest(tmp_path, "build.yaml")
