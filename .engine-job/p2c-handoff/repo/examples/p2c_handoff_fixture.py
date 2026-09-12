#!/usr/bin/env python3
"""Public-safe P2c handoff roundtrip fixture.

The fixture proves orchestration semantics only. It uses synthetic public bytes,
does not exercise a generic binary dispatcher, and does not claim product HUMAN
acceptance or publication.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))
sys.path.insert(0, str(REPO_ROOT / "examples"))

import handoff  # noqa: E402
from p2b_build_package_fixture import prepare_fixture  # noqa: E402


ENGINE_REPOSITORY = "riyuewuxing/PDF-Production-Engine"
ENGINE_COMMIT = "f4229338d2c6fce3d248360402ee13f550a3f967"


def run(command: list[str], cwd: Path) -> str:
    proc = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    output = proc.stdout or ""
    print(">>>", " ".join(command))
    print(output, end="")
    if proc.returncode:
        raise AssertionError(
            f"fixture command failed exit={proc.returncode}: {command}"
        )
    return output


def safe_extract(package: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    with zipfile.ZipFile(package, "r") as zf:
        for info in zf.infolist():
            target = (destination / info.filename).resolve()
            if destination.resolve() != target and destination.resolve() not in target.parents:
                raise AssertionError(f"unsafe package member: {info.filename}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zf.read(info))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()

    base = args.workspace.resolve()
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True)
    root = base / "private-side"
    job_path = prepare_fixture(root, include_helper_in_stage=True)

    # P2b's historical synthetic helper carries a deliberately minimal handoff
    # contract. P2c must exercise the current single authority, not that old copy.
    current_handoff = REPO_ROOT / "contracts/engine-handoff.yaml"
    fixture_handoff = root / "contracts/engine-handoff.yaml"
    fixture_handoff.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(current_handoff, fixture_handoff)

    out_dir = root / "handoff-output"
    package, manifest, request = handoff.prepare(
        root,
        job_raw=job_path.relative_to(root).as_posix(),
        stage="resource",
        stage_spec="content/resource-stage.yaml",
        block_id="fixture-resource",
        out_dir=out_dir,
        strict_engine=False,
    )
    request_doc = json.loads(request.read_text(encoding="utf-8"))
    if request_doc["dispatch"]["performed"] is not False:
        raise AssertionError("prepare falsely claimed dispatch")
    if request_doc["automatic_review_pass"] is not False:
        raise AssertionError("prepare falsely claimed review pass")
    if request_doc["automatic_human_acceptance"] is not False:
        raise AssertionError("prepare falsely claimed HUMAN acceptance")
    if request_doc["automatic_publication"] is not False:
        raise AssertionError("prepare falsely claimed publication")

    execution_root = base / "engine-side/unpacked"
    safe_extract(package, execution_root)
    run(
        [sys.executable, "-m", "pdf_production_engine.job_protocol",
         str(execution_root / "resource-job.yaml")],
        REPO_ROOT,
    )

    engine_out = root / "returned/engine-output"
    run(
        [
            sys.executable,
            "-m",
            "pdf_production_engine.resource_runner",
            "--root",
            str(execution_root),
            "--job",
            "resource-job.yaml",
            "--block",
            "fixture-resource",
            "--out",
            str(engine_out),
        ],
        REPO_ROOT,
    )

    block_dir = engine_out / "p2b-public-fixture/fixture-resource"
    evidence = block_dir / "block-evidence.json"
    receipt = root / "returned/provenance-receipt.json"
    handoff.make_receipt(
        request_path=request,
        package_path=package,
        evidence_path=evidence,
        result_dir=block_dir,
        engine_repository=ENGINE_REPOSITORY,
        engine_commit=ENGINE_COMMIT,
        out_path=receipt,
    )

    verified, review = handoff.verify_result(
        root,
        request_raw=request.relative_to(root).as_posix(),
        receipt_raw=receipt.relative_to(root).as_posix(),
        evidence_raw=evidence.relative_to(root).as_posix(),
        result_dir_raw=block_dir.relative_to(root).as_posix(),
        out_dir_raw="returned/verified",
    )
    verified_doc = json.loads(verified.read_text(encoding="utf-8"))
    review_doc = json.loads(review.read_text(encoding="utf-8"))

    if verified_doc.get("status") != "VERIFIED_MACHINE_RESULT":
        raise AssertionError("returned result was not independently verified")
    if review_doc.get("status") != "WAITING_FOR_BLOCK_REVIEW":
        raise AssertionError("resource roundtrip did not pause at block review")
    if review_doc.get("automatic_state_mutation") is not False:
        raise AssertionError("roundtrip mutated Artifact state automatically")
    if review_doc.get("automatic_publication") is not False:
        raise AssertionError("roundtrip published automatically")
    result = (block_dir / "result.txt").read_text(encoding="utf-8")
    if result != "DETERMINISTIC FIXTURE INPUT\n":
        raise AssertionError(f"unexpected Engine fixture output: {result!r}")

    print("P2C_HANDOFF_ROUNDTRIP_PASS")
    print(f"source_job={job_path.relative_to(root).as_posix()}")
    print(f"package={package.relative_to(root).as_posix()}")
    print(f"manifest={manifest.relative_to(root).as_posix()}")
    print(f"request={request.relative_to(root).as_posix()}")
    print(f"receipt={receipt.relative_to(root).as_posix()}")
    print(f"verified={verified.relative_to(root).as_posix()}")
    print(f"review_pack={review.relative_to(root).as_posix()}")
    print("generic_binary_dispatch_claimed=false")
    print("private_business_bytes_used=false")
    print("automatic_state_mutation=false")
    print("automatic_human_acceptance=false")
    print("automatic_publication=false")
    print("product_pdf_generated=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
