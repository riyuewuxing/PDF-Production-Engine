from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

from pdf_production_engine.cli import ManifestError, build, load_manifest
from pdf_production_engine.job_protocol import load_job, validate_job
from pdf_production_engine.resource_runner import run_block
from pdf_production_engine.sealed_handoff import generate_keypair, seal_file, unseal_file

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


def _reviewed_block(block_id: str, kind: str) -> dict:
    return {
        "block_id": block_id,
        "kind": kind,
        "required": True,
        "state": "REVIEW_PASS",
        "accepted_sha256": "a" * 64,
    }


def test_resource_stage_allows_unreviewed_independent_blocks() -> None:
    job = {
        "version": 1,
        "job_id": "figures-r1",
        "stage": "resource",
        "privacy": "public",
        "blocks": [
            {"block_id": "content", "kind": "content", "required": True, "state": "REVIEW_PASS", "accepted_sha256": "b" * 64},
            {"block_id": "figure-1", "kind": "figure", "required": True, "state": "PENDING_BUILD"},
        ],
    }
    assert validate_job(job) == []


def test_composition_is_blocked_until_every_required_block_is_reviewed() -> None:
    job = {
        "version": 1,
        "job_id": "compose-r1",
        "stage": "composition",
        "privacy": "sealed",
        "blocks": [
            _reviewed_block("content", "content"),
            {"block_id": "figure-1", "kind": "figure", "required": True, "state": "MACHINE_PASS"},
        ],
        "composition_requires": ["content", "figure-1"],
    }
    errors = validate_job(job)
    assert any(x.startswith("GATE_REVIEW_PASS_REQUIRED:composition_requires:figure-1") for x in errors)


def test_composition_passes_with_hash_bound_review_receipts(tmp_path: Path) -> None:
    job = {
        "version": 1,
        "job_id": "compose-r2",
        "stage": "composition",
        "privacy": "sealed",
        "blocks": [
            _reviewed_block("content", "content"),
            _reviewed_block("figure-1", "figure"),
            {"block_id": "composition", "kind": "composition", "required": True, "state": "PENDING_BUILD"},
        ],
        "composition_requires": ["content", "figure-1"],
    }
    path = tmp_path / "resource-job.yaml"
    path.write_text(yaml.safe_dump(job, sort_keys=False), encoding="utf-8")
    loaded = load_job(path)
    assert loaded["stage"] == "composition"


def test_review_pass_without_hash_is_rejected() -> None:
    job = {
        "version": 1,
        "job_id": "bad-review",
        "stage": "resource",
        "privacy": "public",
        "blocks": [
            {"block_id": "figure-1", "kind": "figure", "required": True, "state": "REVIEW_PASS"},
        ],
    }
    assert "BLOCK_REVIEW_HASH_INVALID:figure-1" in validate_job(job)


def test_resource_runner_executes_one_image_block_and_emits_evidence(tmp_path: Path) -> None:
    project = tmp_path / "resource-project"
    project.mkdir()
    maker = project / "make_image.py"
    maker.write_text(
        "from PIL import Image, ImageDraw\n"
        "from pathlib import Path\n"
        "import sys\n"
        "p = Path(sys.argv[1]); p.parent.mkdir(parents=True, exist_ok=True)\n"
        "im = Image.new('RGB', (320, 180), 'white')\n"
        "ImageDraw.Draw(im).rectangle((20,20,300,160), outline='black', width=3)\n"
        "im.save(p)\n",
        encoding="utf-8",
    )
    job = {
        "version": 1,
        "job_id": "image-block-fixture",
        "stage": "resource",
        "privacy": "public",
        "blocks": [
            {
                "block_id": "figure",
                "kind": "figure",
                "required": True,
                "state": "PENDING_BUILD",
                "command": [sys.executable, "make_image.py", "{output_dir}/figure.png"],
                "expected_outputs": ["figure.png"],
            }
        ],
    }
    (project / "resource-job.yaml").write_text(yaml.safe_dump(job, sort_keys=False), encoding="utf-8")
    evidence_path = run_block(project, "resource-job.yaml", "figure", tmp_path / "out", dpi=96)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["status"] == "MACHINE_PASS"
    assert evidence["review_status"] == "REVIEW_REQUIRED"
    assert evidence["block_id"] == "figure"
    assert evidence["outputs"][0]["width_px"] == 320
    assert evidence["outputs"][0]["height_px"] == 180
    assert len(evidence["outputs"][0]["sha256"]) == 64


def test_sealed_handoff_roundtrip_keeps_plaintext_out_of_transport(tmp_path: Path) -> None:
    public_key, private_key = generate_keypair()
    source = tmp_path / "private-input.zip"
    source.write_bytes(b"private consumer bytes\x00\x01")
    sealed = tmp_path / "input.sealed"
    restored = tmp_path / "restored.zip"
    seal_file(public_key, source, sealed)
    assert sealed.read_bytes() != source.read_bytes()
    assert b"private consumer bytes" not in sealed.read_bytes()
    unseal_file(private_key, sealed, restored)
    assert restored.read_bytes() == source.read_bytes()
