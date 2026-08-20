from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

from pdf_production_engine.cli import ManifestError, build, load_manifest

ROOT = Path(__file__).resolve().parents[1]


def test_public_fixture_builds_and_renders_all_pages(tmp_path: Path) -> None:
    evidence_path = build(ROOT, "examples/hello/build.yaml", tmp_path, dpi=96)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["status"] == "MACHINE_PASS"
    assert evidence["visual_status"] == "HUMAN_PIXEL_CONFIRMATION_REQUIRED"
    assert evidence["qa"]["preflight_backend"] == "PyMuPDF"
    assert evidence["qa"]["render_backend"] == "PDFium"
    assert evidence["qa"]["page_count"] >= 1
    assert evidence["qa"]["page_count"] == evidence["qa"]["rendered_page_count"]
    pdf_path = evidence_path.parent / evidence["pdf"]["filename"]
    assert pdf_path.is_file() and pdf_path.stat().st_size > 100
    renders = sorted((evidence_path.parent / "rendered").glob("page-*.png"))
    assert len(renders) == evidence["qa"]["page_count"]
    assert all(p.stat().st_size > 100 for p in renders)


def test_trusted_command_backend_wraps_consumer_publisher(tmp_path: Path) -> None:
    project = tmp_path / "consumer"
    project.mkdir()
    producer = project / "producer.py"
    producer.write_text(
        "from reportlab.lib.pagesizes import A4\n"
        "from reportlab.pdfgen import canvas\n"
        "import sys\n"
        "c = canvas.Canvas(sys.argv[1], pagesize=A4)\n"
        "c.drawString(72, 760, 'consumer publisher fixture')\n"
        "c.save()\n"
        "print('consumer publisher executed')\n",
        encoding="utf-8",
    )
    manifest = {
        "version": 1,
        "document_id": "consumer-command",
        "backend": {
            "type": "command",
            "cwd": ".",
            "command": [sys.executable, "producer.py", "{output_pdf}"],
        },
        "output": {"filename": "consumer.pdf"},
        "metadata": {"title": "Consumer fixture"},
    }
    (project / "build.yaml").write_text(yaml.safe_dump(manifest, sort_keys=False), encoding="utf-8")

    evidence_path = build(project, "build.yaml", tmp_path / "output", dpi=96)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["status"] == "MACHINE_PASS"
    assert evidence["backend"] == "command"
    assert evidence["qa"]["page_count"] == evidence["qa"]["rendered_page_count"] == 1
    backend_log = evidence_path.parent / "backend.log"
    assert backend_log.is_file()
    assert "consumer publisher executed" in backend_log.read_text(encoding="utf-8")


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
