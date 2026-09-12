#!/usr/bin/env python3
"""Public-safe P2b integration fixture: Artifact Job -> build package.

This is an engineering fixture only. It contains no textbook, candidate, or
business bytes. The emitted package is intentionally privacy=public so the
public Engine may consume it as runtime evidence.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

from artifact_foundation import artifact_input_fingerprint, sha256_file  # noqa: E402
from build_packager import build_package, verify_package  # noqa: E402
from check_artifact_job import validate as validate_artifact_job  # noqa: E402
from provenance_snapshot import (  # noqa: E402
    build_snapshot,
    repository_binding,
    snapshot_binding,
    write_snapshot,
)


ARTIFACT_CONTRACT = """states: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]
allowed_module_lifecycle_for_new_job: [ACTIVE, FROZEN]
required_top_level: [version, job_id, module_id, state, module_contract, execution_ledger, input_bindings, build_provenance, blocks, outputs, machine_evidence, human_acceptance, publication]
binding:
  identity_fields: [path, sha256, kind]
  path_policy: repository-relative-only
  hash_algorithm: SHA-256
  hash_change_invalidates_acceptance: true
engine_stage_spec:
  role: deterministic_packaging_instruction_not_planner
  binding_kind: engine_stage_spec
  schema_id: qiuzhidaren-engine-stage-spec-v1
  required_from_state: INPUTS_LOCKED
  stages: [resource, composition, final]
  privacy_values: [public, session, sealed]
  input_modes: [selected_locked, all_locked, outputs_only]
  resource_input_mode: selected_locked
  composition_input_mode: all_locked
  final_input_mode: outputs_only
  engine_block_kinds: [content, figure, chart, source-page, asset, composition, final-pdf]
  engine_pending_state: PENDING_BUILD
  engine_job_filename: resource-job.yaml
  command_placeholders: [root, output_dir]
build_provenance:
  runtime_required_fields: [name, version]
  source_snapshot:
    snapshot_exempt_input_kinds: [input_plan]
ledger_evidence_events: {}
machine_boundary:
  module_check_evidence_kind: module_check
  visual_render_evidence_kind: final_render_manifest
"""

LEDGER_CONTRACT = """lifecycle_transition_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]
event_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]
attempt_event_types: []
"""

HANDOFF_CONTRACT = """version: 2
engine:
  repository: riyuewuxing/PDF-Production-Engine
  pin_mode: commit
  ref: f4229338d2c6fce3d248360402ee13f550a3f967
  commit: f4229338d2c6fce3d248360402ee13f550a3f967
  cli_contract: schemas/resource-job-v1.yaml
  cli_contract_sha256: e1c18ad73306aad7f2b926b921d482d014d1b41e4ce4e989f475a397323d8264
  transport: chatgpt-session-mediated
  additional_contracts: []
handoff:
  package: build-package/<job_id>.zip
  manifest: manifest.json
  receipt: provenance-receipt.json
"""

PROVENANCE_CONTRACT = """snapshot:
  storage_root: production/provenance/repository-snapshots
"""


def dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(value, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def prepare_fixture(root: Path, *, include_helper_in_stage: bool) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "production/contracts").mkdir(parents=True, exist_ok=True)
    (root / "content").mkdir(parents=True, exist_ok=True)
    (root / "tools").mkdir(parents=True, exist_ok=True)

    (root / "production/contracts/artifact-job-v1.yaml").write_text(
        ARTIFACT_CONTRACT, encoding="utf-8"
    )
    (root / "production/contracts/execution-ledger-v1.yaml").write_text(
        LEDGER_CONTRACT, encoding="utf-8"
    )
    (root / "production/contracts/repository-provenance-snapshot-v1.yaml").write_text(
        PROVENANCE_CONTRACT, encoding="utf-8"
    )
    (root / "contracts").mkdir(parents=True, exist_ok=True)
    (root / "contracts/engine-handoff.yaml").write_text(
        HANDOFF_CONTRACT, encoding="utf-8"
    )

    module_contract = root / "content/module.yaml"
    module_contract.write_text("id: synthetic-p2b\n", encoding="utf-8")
    source = root / "content/input.txt"
    source.write_text("deterministic fixture input\n", encoding="utf-8")
    helper = root / "tools/helper.py"
    helper.write_text(
        "def transform(value: str) -> str:\n"
        "    return value.strip().upper() + '\\n'\n",
        encoding="utf-8",
    )
    builder = root / "tools/build.py"
    builder.write_text(
        "from pathlib import Path\n"
        "import sys\n"
        "from helper import transform\n"
        "src = Path(sys.argv[1])\n"
        "out = Path(sys.argv[2])\n"
        "out.parent.mkdir(parents=True, exist_ok=True)\n"
        "out.write_text(transform(src.read_text(encoding='utf-8')), encoding='utf-8')\n",
        encoding="utf-8",
    )

    stage_paths = ["content/input.txt", "tools/build.py"]
    if include_helper_in_stage:
        stage_paths.append("tools/helper.py")
    stage_spec = {
        "version": 1,
        "schema_id": "qiuzhidaren-engine-stage-spec-v1",
        "stage": "resource",
        "privacy": "public",
        "input_mode": "selected_locked",
        "input_paths": stage_paths,
        "block": {
            "block_id": "fixture-resource",
            "kind": "asset",
            "required": True,
            "command": [
                "python",
                "repo/tools/build.py",
                "repo/content/input.txt",
                "{output_dir}/result.txt",
            ],
            "expected_outputs": ["result.txt"],
        },
    }
    stage_path = root / "content/resource-stage.yaml"
    dump(stage_path, stage_spec)

    registry = {
        "allowed_lifecycle": ["ACTIVE", "FROZEN", "DEFERRED", "EXTERNAL", "RETIRED"],
        "modules": {
            "synthetic_p2b": {
                "lifecycle": "ACTIVE",
                "module_contract": "content/module.yaml",
                "artifact_adapter": {"build": "tools/build.py"},
            }
        },
    }
    dump(root / "production/contracts/module-registry-v1.yaml", registry)

    source_commit = "a" * 40
    snapshot_entries = [
        repository_binding(root, "content/module.yaml", "module_contract"),
        repository_binding(root, "content/input.txt", "source"),
        repository_binding(root, "content/resource-stage.yaml", "engine_stage_spec"),
        repository_binding(root, "tools/build.py", "builder"),
        repository_binding(root, "tools/helper.py", "builder_dependency"),
    ]
    snapshot = build_snapshot(snapshot_entries, source_commit)
    snapshot_path = write_snapshot(snapshot, root=root)
    snap_binding = snapshot_binding(snapshot, snapshot_path, root=root)

    inputs = [
        {
            "path": "content/input.txt",
            "sha256": sha256_file(source),
            "kind": "source",
        },
        {
            "path": "content/resource-stage.yaml",
            "sha256": sha256_file(stage_path),
            "kind": "engine_stage_spec",
        },
        {
            "path": "tools/build.py",
            "sha256": sha256_file(builder),
            "kind": "builder",
        },
        {
            "path": "tools/helper.py",
            "sha256": sha256_file(helper),
            "kind": "builder_dependency",
        },
    ]
    module_binding = {
        "path": "content/module.yaml",
        "sha256": sha256_file(module_contract),
        "kind": "module_contract",
    }
    builder_binding = {
        "path": "tools/build.py",
        "sha256": sha256_file(builder),
        "kind": "builder",
    }
    runtime = {"name": "python", "version": "3.12"}
    provenance = {
        "module_contract_binding": module_binding,
        "builder_binding": builder_binding,
        "source_snapshot_binding": snap_binding,
        "runtime_identity": runtime,
    }
    provenance["input_fingerprint"] = artifact_input_fingerprint(
        "synthetic_p2b",
        module_binding,
        builder_binding,
        runtime,
        inputs,
        snap_binding,
    )

    ledger = {
        "contract": "production/contracts/execution-ledger-v1.yaml",
        "job_id": "p2b-public-fixture",
        "events": [
            {
                "seq": 1,
                "event_id": "p2b:0001",
                "occurred_at": "2026-01-01T00:00:01Z",
                "type": "JOB_CREATED",
                "actor": "P2BFixture",
            },
            {
                "seq": 2,
                "event_id": "p2b:0002",
                "occurred_at": "2026-01-01T00:00:02Z",
                "type": "INPUTS_LOCKED",
                "actor": "P2BFixture",
            },
        ],
        "derived": {
            "artifact_state": "INPUTS_LOCKED",
            "generation_review_cycles": 0,
            "build_count": 0,
            "final_render_count": 0,
            "review_reject_count": 0,
        },
    }
    dump(root / "ledger.yaml", ledger)

    job = {
        "version": 1,
        "job_id": "p2b-public-fixture",
        "module_id": "synthetic_p2b",
        "state": "INPUTS_LOCKED",
        "module_contract": "content/module.yaml",
        "execution_ledger": "ledger.yaml",
        "input_bindings": inputs,
        "build_provenance": provenance,
        "blocks": [],
        "outputs": [],
        "machine_evidence": [],
        "human_acceptance": {"state": "PENDING"},
        "publication": {"state": "NOT_PUBLISHED"},
    }
    job_path = root / "job.yaml"
    dump(job_path, job)
    found = validate_artifact_job(job, root)
    if found:
        raise AssertionError("valid P2b Artifact fixture rejected: " + " | ".join(found))
    return job_path


def expect_failure(fn, needle: str) -> None:
    try:
        fn()
    except Exception as exc:
        if needle not in str(exc):
            raise AssertionError(
                f"expected failure containing {needle!r}, got {exc!r}"
            ) from exc
    else:
        raise AssertionError(f"expected failure containing {needle!r}")


def run_fixture(workspace: Path, out_dir: Path) -> dict[str, str]:
    if workspace.exists():
        shutil.rmtree(workspace)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    root = workspace / "positive"
    job_path = prepare_fixture(root, include_helper_in_stage=True)

    out_a = out_dir / "a"
    out_b = out_dir / "b"
    zip_a, manifest_a = build_package(
        root,
        job_path.relative_to(root).as_posix(),
        out_a,
        "resource",
        "fixture-resource",
        "content/resource-stage.yaml",
    )
    zip_b, _ = build_package(
        root,
        job_path.relative_to(root).as_posix(),
        out_b,
        "resource",
        "fixture-resource",
        "content/resource-stage.yaml",
    )
    if zip_a.read_bytes() != zip_b.read_bytes():
        raise AssertionError("same locked Artifact fixture produced different package bytes")
    manifest = verify_package(zip_a, manifest_name="manifest.json")
    if manifest.get("stage_scope") != "resource":
        raise AssertionError("fixture package stage drift")

    negative = workspace / "missing-helper"
    bad_job = prepare_fixture(negative, include_helper_in_stage=False)
    expect_failure(
        lambda: build_package(
            negative,
            bad_job.relative_to(negative).as_posix(),
            out_dir / "missing-helper",
            "resource",
            "fixture-resource",
            "content/resource-stage.yaml",
        ),
        "missing repo-local Python imports",
    )

    drift = workspace / "drift"
    drift_job = prepare_fixture(drift, include_helper_in_stage=True)
    (drift / "content/input.txt").write_text("drifted input\n", encoding="utf-8")
    expect_failure(
        lambda: build_package(
            drift,
            drift_job.relative_to(drift).as_posix(),
            out_dir / "drift",
            "resource",
            "fixture-resource",
            "content/resource-stage.yaml",
        ),
        "artifact job is not valid",
    )

    return {
        "package": str(zip_a),
        "manifest": str(manifest_a),
        "fixture_root": str(root),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    result = run_fixture(args.workspace.resolve(), args.out_dir.resolve())
    print("P2B_FIXTURE_PASS")
    print(f"P2B_FIXTURE_PACKAGE={result['package']}")
    print(f"P2B_FIXTURE_MANIFEST={result['manifest']}")
    print(f"P2B_FIXTURE_ROOT={result['fixture_root']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
