#!/usr/bin/env python3
"""Initialize a synchronized Artifact Job + append-only execution ledger."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import yaml

from artifact_foundation import ROOT, load_yaml, parse_iso8601, safe_repo_path, sha256_file

REGISTRY = Path("production/contracts/module-registry-v1.yaml")
ARTIFACT_CONTRACT = Path("production/contracts/artifact-job-v1.yaml")
LEDGER_CONTRACT = Path("production/contracts/execution-ledger-v1.yaml")


def _target(root: Path, raw: str) -> Path:
    path = safe_repo_path(root, raw)
    if path.exists():
        raise ValueError(f"target already exists: {raw}")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _binding(root: Path, raw: str, kind: str) -> dict:
    path = safe_repo_path(root, raw, must_exist=True)
    if not path.is_file():
        raise ValueError(f"binding source is not a file: {raw}")
    return {"path": raw, "sha256": sha256_file(path), "kind": kind}


def initialize(root: Path, module_id: str, job_id: str, job_raw: str, ledger_raw: str, occurred_at: str | None = None) -> tuple[Path, Path]:
    registry = load_yaml(root / REGISTRY)
    artifact_contract = load_yaml(root / ARTIFACT_CONTRACT)
    module = (registry.get("modules") or {}).get(module_id)
    if not isinstance(module, dict):
        raise ValueError(f"unknown module_id: {module_id}")
    allowed = set(artifact_contract.get("allowed_module_lifecycle_for_new_job") or [])
    if module.get("lifecycle") not in allowed:
        raise ValueError(f"module lifecycle cannot start Artifact Job: {module.get('lifecycle')}")
    module_contract = module.get("module_contract")
    if not isinstance(module_contract, str) or not module_contract:
        raise ValueError("module has no module_contract")
    adapter = module.get("artifact_adapter") or {}
    builder = adapter.get("build") if isinstance(adapter, dict) else None
    if not isinstance(builder, str) or not builder:
        raise ValueError("module has no build adapter")
    module_contract_binding = _binding(root, module_contract, "module_contract")
    builder_binding = _binding(root, builder, "builder")
    safe_repo_path(root, LEDGER_CONTRACT.as_posix(), must_exist=True)
    if not isinstance(job_id, str) or not job_id.strip():
        raise ValueError("job_id is required")
    job_path = _target(root, job_raw)
    ledger_path = _target(root, ledger_raw)
    job_rel = job_path.relative_to(root.resolve()).as_posix()
    ledger_rel = ledger_path.relative_to(root.resolve()).as_posix()
    if job_rel == ledger_rel:
        raise ValueError("job and ledger paths must differ")
    ts = occurred_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if not parse_iso8601(ts):
        raise ValueError("occurred_at must be ISO-8601")
    ledger = {
        "version": 1,
        "contract": LEDGER_CONTRACT.as_posix(),
        "job_id": job_id,
        "events": [{"seq": 1, "event_id": f"{job_id}:0001", "occurred_at": ts, "type": "JOB_CREATED", "actor": "ChatGPT"}],
        "derived": {"artifact_state": "JOB_CREATED", "generation_review_cycles": 0, "build_count": 0, "final_render_count": 0, "review_reject_count": 0},
    }
    job = {
        "version": 1,
        "job_id": job_id,
        "module_id": module_id,
        "state": "JOB_CREATED",
        "module_contract": module_contract,
        "execution_ledger": ledger_rel,
        "input_bindings": [],
        "build_provenance": {
            "module_contract_binding": module_contract_binding,
            "builder_binding": builder_binding,
            "source_snapshot_binding": None,
            "runtime_identity": {"name": None, "version": None},
            "input_fingerprint": None,
        },
        "blocks": [],
        "outputs": [],
        "machine_evidence": [],
        "human_acceptance": {"state": "PENDING", "reviewer": "ChatGPT", "reviewed_at": None, "accepted_outputs": []},
        "publication": {"state": "NOT_PUBLISHED", "published_at": None, "outputs": []},
        "qualification_ref": None,
    }
    ledger_path.write_text(yaml.safe_dump(ledger, allow_unicode=True, sort_keys=False), encoding="utf-8")
    job_path.write_text(yaml.safe_dump(job, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return job_path, ledger_path


def selftest() -> int:
    with tempfile.TemporaryDirectory(prefix="qz-init-job-") as tmp:
        root = Path(tmp); (root / "production/contracts").mkdir(parents=True); (root / "content").mkdir(); (root / "tools").mkdir()
        (root / ARTIFACT_CONTRACT).write_text("allowed_module_lifecycle_for_new_job: [ACTIVE, FROZEN]\n", encoding="utf-8")
        (root / LEDGER_CONTRACT).write_text("version: 1\n", encoding="utf-8")
        (root / "content/contract.yaml").write_text("id: synthetic\n", encoding="utf-8")
        (root / "tools/build.py").write_text("# synthetic builder\n", encoding="utf-8")
        (root / REGISTRY).write_text(
            "modules:\n  synthetic:\n    lifecycle: ACTIVE\n    module_contract: content/contract.yaml\n    artifact_adapter:\n      build: tools/build.py\n",
            encoding="utf-8",
        )
        job, ledger = initialize(root, "synthetic", "job-1", "production/jobs/job-1.yaml", "production/jobs/job-1-ledger.yaml", "2026-01-01T00:00:00Z")
        j = load_yaml(job); l = load_yaml(ledger)
        if j.get("state") != "JOB_CREATED" or l.get("derived", {}).get("artifact_state") != "JOB_CREATED": print("FAIL: initial state drift"); return 1
        if (l.get("events") or [{}])[0].get("type") != "JOB_CREATED": print("FAIL: first ledger event missing"); return 1
        provenance = j.get("build_provenance") or {}
        if (provenance.get("module_contract_binding") or {}).get("kind") != "module_contract": print("FAIL: module contract provenance missing"); return 1
        if (provenance.get("builder_binding") or {}).get("kind") != "builder": print("FAIL: builder provenance missing"); return 1
        if provenance.get("source_snapshot_binding") is not None: print("FAIL: source snapshot must be unset before INPUTS_LOCKED"); return 1
        try: initialize(root, "synthetic", "job-2", "../escape.yaml", "production/jobs/job-2-ledger.yaml")
        except ValueError: pass
        else: print("FAIL: traversal target accepted"); return 1
        try: initialize(root, "synthetic", "job-3", "production/jobs/job-3.yaml", "production/jobs/job-3-ledger.yaml", "not-a-time")
        except ValueError: pass
        else: print("FAIL: invalid timestamp accepted"); return 1
    print("PASS: init artifact job selftest"); return 0


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--module-id"); parser.add_argument("--job-id"); parser.add_argument("--job"); parser.add_argument("--ledger"); parser.add_argument("--root", type=Path, default=ROOT); parser.add_argument("--selftest", action="store_true"); args = parser.parse_args()
    if args.selftest: return selftest()
    if not all([args.module_id, args.job_id, args.job, args.ledger]): parser.error("--module-id --job-id --job --ledger are required")
    try:
        job, ledger = initialize(args.root.resolve(), args.module_id, args.job_id, args.job, args.ledger)
    except Exception as exc:
        print(f"FAIL: {exc}"); return 1
    print(f"CREATED: {job.relative_to(args.root.resolve())}")
    print(f"CREATED: {ledger.relative_to(args.root.resolve())}")
    return 0

if __name__ == "__main__": raise SystemExit(main())
