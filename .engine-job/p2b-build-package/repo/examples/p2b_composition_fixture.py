#!/usr/bin/env python3
"""Public-safe P2b composition fixture for full locked-input transport."""
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
from p2b_build_package_fixture import (  # noqa: E402
    ARTIFACT_CONTRACT,
    HANDOFF_CONTRACT,
    LEDGER_CONTRACT,
    PROVENANCE_CONTRACT,
    dump,
)


def binding(root: Path, raw: str, kind: str) -> dict[str, str]:
    return {
        "path": raw,
        "sha256": sha256_file(root / raw),
        "kind": kind,
    }


def prepare_fixture(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    for directory in (
        "production/contracts",
        "content",
        "tools",
        "templates",
        "assets",
        "accepted",
        "contracts",
    ):
        (root / directory).mkdir(parents=True, exist_ok=True)

    (root / "production/contracts/artifact-job-v1.yaml").write_text(
        ARTIFACT_CONTRACT, encoding="utf-8"
    )
    (root / "production/contracts/execution-ledger-v1.yaml").write_text(
        LEDGER_CONTRACT, encoding="utf-8"
    )
    (root / "production/contracts/repository-provenance-snapshot-v1.yaml").write_text(
        PROVENANCE_CONTRACT, encoding="utf-8"
    )
    (root / "contracts/engine-handoff.yaml").write_text(
        HANDOFF_CONTRACT, encoding="utf-8"
    )

    (root / "content/module.yaml").write_text(
        "id: synthetic-p2b-composition\n", encoding="utf-8"
    )
    (root / "content/input.txt").write_text(
        "composition source\n", encoding="utf-8"
    )
    (root / "templates/layout.txt").write_text(
        "TEMPLATE[{body}]\n", encoding="utf-8"
    )
    (root / "assets/font-token.txt").write_text(
        "SYNTHETIC_FONT_TOKEN\n", encoding="utf-8"
    )
    (root / "tools/helper.py").write_text(
        "def normalize(value: str) -> str:\n"
        "    return value.strip().upper()\n",
        encoding="utf-8",
    )
    (root / "tools/build.py").write_text(
        "from pathlib import Path\n"
        "import sys\n"
        "from helper import normalize\n"
        "src = Path(sys.argv[1]).read_text(encoding='utf-8')\n"
        "template = Path(sys.argv[2]).read_text(encoding='utf-8')\n"
        "font = Path(sys.argv[3]).read_text(encoding='utf-8').strip()\n"
        "out = Path(sys.argv[4])\n"
        "out.parent.mkdir(parents=True, exist_ok=True)\n"
        "body = normalize(src) + '|' + font\n"
        "out.write_text(template.format(body=body), encoding='utf-8')\n",
        encoding="utf-8",
    )

    stage_spec = {
        "version": 1,
        "schema_id": "qiuzhidaren-engine-stage-spec-v1",
        "stage": "composition",
        "privacy": "public",
        "input_mode": "all_locked",
        "input_paths": [],
        "prerequisite_kinds": {"accepted-content": "content"},
        "block": {
            "block_id": "fixture-composition",
            "kind": "composition",
            "required": True,
            "command": [
                "python",
                "repo/tools/build.py",
                "repo/content/input.txt",
                "repo/templates/layout.txt",
                "repo/assets/font-token.txt",
                "{output_dir}/composed.txt",
            ],
            "expected_outputs": ["composed.txt"],
        },
    }
    dump(root / "content/composition-stage.yaml", stage_spec)

    registry = {
        "allowed_lifecycle": ["ACTIVE", "FROZEN", "DEFERRED", "EXTERNAL", "RETIRED"],
        "modules": {
            "synthetic_p2b_composition": {
                "lifecycle": "ACTIVE",
                "module_contract": "content/module.yaml",
                "artifact_adapter": {"build": "tools/build.py"},
            }
        },
    }
    dump(root / "production/contracts/module-registry-v1.yaml", registry)

    source_binding = binding(root, "content/input.txt", "source")
    accepted_manifest = {"version": 1, "bindings": [source_binding]}
    dump(root / "accepted/content.yaml", accepted_manifest)
    (root / "accepted/content-evidence.json").write_text(
        '{"status":"REVIEW_PASS","reviewer":"ChatGPT","fixture":true}\n',
        encoding="utf-8",
    )

    source_commit = "b" * 40
    snapshot_entries = [
        repository_binding(root, "content/module.yaml", "module_contract"),
        repository_binding(root, "content/input.txt", "source"),
        repository_binding(
            root, "content/composition-stage.yaml", "engine_stage_spec"
        ),
        repository_binding(root, "tools/build.py", "builder"),
        repository_binding(root, "tools/helper.py", "builder_dependency"),
        repository_binding(root, "templates/layout.txt", "template"),
        repository_binding(root, "assets/font-token.txt", "font_asset"),
    ]
    snapshot = build_snapshot(snapshot_entries, source_commit)
    snapshot_path = write_snapshot(snapshot, root=root)
    snap_binding = snapshot_binding(snapshot, snapshot_path, root=root)

    inputs = [
        source_binding,
        binding(root, "content/composition-stage.yaml", "engine_stage_spec"),
        binding(root, "tools/build.py", "builder"),
        binding(root, "tools/helper.py", "builder_dependency"),
        binding(root, "templates/layout.txt", "template"),
        binding(root, "assets/font-token.txt", "font_asset"),
    ]
    module_binding = binding(root, "content/module.yaml", "module_contract")
    builder_binding = binding(root, "tools/build.py", "builder")
    runtime = {"name": "python", "version": "3.12"}
    provenance = {
        "module_contract_binding": module_binding,
        "builder_binding": builder_binding,
        "source_snapshot_binding": snap_binding,
        "runtime_identity": runtime,
    }
    provenance["input_fingerprint"] = artifact_input_fingerprint(
        "synthetic_p2b_composition",
        module_binding,
        builder_binding,
        runtime,
        inputs,
        snap_binding,
    )

    ledger = {
        "contract": "production/contracts/execution-ledger-v1.yaml",
        "job_id": "p2b-composition-fixture",
        "events": [
            {
                "seq": 1,
                "event_id": "p2bc:0001",
                "occurred_at": "2026-01-01T00:00:01Z",
                "type": "JOB_CREATED",
                "actor": "P2BFixture",
            },
            {
                "seq": 2,
                "event_id": "p2bc:0002",
                "occurred_at": "2026-01-01T00:00:02Z",
                "type": "INPUTS_LOCKED",
                "actor": "P2BFixture",
            },
            {
                "seq": 3,
                "event_id": "p2bc:0003",
                "occurred_at": "2026-01-01T00:00:03Z",
                "type": "BLOCKS_ACCEPTED",
                "actor": "P2BFixture",
            },
        ],
        "derived": {
            "artifact_state": "BLOCKS_ACCEPTED",
            "generation_review_cycles": 0,
            "build_count": 0,
            "final_render_count": 0,
            "review_reject_count": 0,
        },
    }
    dump(root / "ledger.yaml", ledger)

    job = {
        "version": 1,
        "job_id": "p2b-composition-fixture",
        "module_id": "synthetic_p2b_composition",
        "state": "BLOCKS_ACCEPTED",
        "module_contract": "content/module.yaml",
        "execution_ledger": "ledger.yaml",
        "input_bindings": inputs,
        "build_provenance": provenance,
        "blocks": [
            {
                "block_id": "accepted-content",
                "state": "REVIEW_PASS",
                "reviewer": "ChatGPT",
                "reviewed_at": "2026-01-01T00:00:04Z",
                "artifact_binding": binding(
                    root, "accepted/content.yaml", "artifact_manifest"
                ),
                "evidence_binding": binding(
                    root,
                    "accepted/content-evidence.json",
                    "block_review_evidence",
                ),
            }
        ],
        "outputs": [],
        "machine_evidence": [],
        "human_acceptance": {"state": "PENDING"},
        "publication": {"state": "NOT_PUBLISHED"},
    }
    job_path = root / "job.yaml"
    dump(job_path, job)
    found = validate_artifact_job(job, root)
    if found:
        raise AssertionError(
            "valid P2b composition Artifact fixture rejected: " + " | ".join(found)
        )
    return job_path


def run_fixture(workspace: Path, out_dir: Path) -> dict[str, str]:
    if workspace.exists():
        shutil.rmtree(workspace)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    root = workspace / "composition"
    job_path = prepare_fixture(root)

    out_a = out_dir / "a"
    out_b = out_dir / "b"
    zip_a, manifest_a = build_package(
        root,
        job_path.relative_to(root).as_posix(),
        out_a,
        "composition",
        "fixture-composition",
        "content/composition-stage.yaml",
    )
    zip_b, _ = build_package(
        root,
        job_path.relative_to(root).as_posix(),
        out_b,
        "composition",
        "fixture-composition",
        "content/composition-stage.yaml",
    )
    if zip_a.read_bytes() != zip_b.read_bytes():
        raise AssertionError("composition package bytes are not deterministic")

    manifest = verify_package(zip_a, manifest_name="manifest.json")
    archived = {item["archive_path"] for item in manifest.get("files") or []}
    required = {
        "repo/tools/build.py",
        "repo/tools/helper.py",
        "repo/templates/layout.txt",
        "repo/assets/font-token.txt",
        "repo/content/input.txt",
        "repo/content/composition-stage.yaml",
        "repo/accepted/content.yaml",
        "repo/accepted/content-evidence.json",
    }
    missing = sorted(required - archived)
    if missing:
        raise AssertionError(
            "composition dependency closure missing expected files: "
            + ", ".join(missing)
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
    print("P2B_COMPOSITION_FIXTURE_PASS")
    print(f"P2B_COMPOSITION_PACKAGE={result['package']}")
    print(f"P2B_COMPOSITION_MANIFEST={result['manifest']}")
    print(f"P2B_COMPOSITION_ROOT={result['fixture_root']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
