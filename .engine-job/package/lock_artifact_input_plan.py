#!/usr/bin/env python3
"""Lock an Artifact Job from a hash-verified input plan and durable snapshot.

The content-addressed plan is an execution record generated after the source commit; the
repository snapshot is the immutable historical identity for source repository bytes.
Both are verified before delegating to the canonical Artifact Job operator.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
from pathlib import Path
import re
import tempfile
import yaml

from artifact_foundation import ROOT, binding_key, canonical_sha256, load_yaml, safe_repo_path, sha256_file, validate_binding
from manage_artifact_job import lock_inputs
from provenance_snapshot import build_snapshot, repository_binding, validate_snapshot_binding, write_snapshot

HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _verify_plan_identity(plan_path: Path, plan: dict) -> None:
    declared = plan.get("plan_identity_sha256")
    if not isinstance(declared, str) or not HEX64.fullmatch(declared):
        raise ValueError("input plan plan_identity_sha256 must be lowercase SHA-256")
    payload = deepcopy(plan); payload.pop("plan_identity_sha256", None)
    actual = canonical_sha256(payload)
    if actual != declared:
        raise ValueError(f"input plan identity mismatch: declared={declared} actual={actual}")
    if HEX64.fullmatch(plan_path.stem) and plan_path.stem != declared:
        raise ValueError("content-addressed input plan filename does not match plan identity")


def _snapshot_key_set(snapshot: dict) -> set[tuple[str, str, str]]:
    return {
        (str(x.get("path") or ""), str(x.get("sha256") or ""), str(x.get("kind") or ""))
        for x in (snapshot.get("bindings") or []) if isinstance(x, dict)
    }


def plan_pairs(root: Path, plan_raw: str) -> tuple[Path, list[tuple[str, str]], str]:
    plan_path = safe_repo_path(root, plan_raw, must_exist=True)
    if not plan_path.is_file():
        raise ValueError("input plan is not a file")
    plan = load_yaml(plan_path)
    _verify_plan_identity(plan_path, plan)

    snapshot_binding = plan.get("repository_snapshot_binding")
    snapshot, snapshot_errors = validate_snapshot_binding(root, snapshot_binding, mode="live")
    if snapshot_errors:
        raise ValueError(" | ".join(snapshot_errors))
    if snapshot is None:
        raise ValueError("input plan repository snapshot missing")
    if plan.get("repository_snapshot") != snapshot:
        raise ValueError("input plan inline repository snapshot differs from bound snapshot file")
    if plan.get("source_commit") != snapshot.get("source_commit"):
        raise ValueError("input plan source_commit differs from repository snapshot")
    snapshot_keys = _snapshot_key_set(snapshot)

    bindings = plan.get("input_bindings")
    if not isinstance(bindings, list) or not bindings:
        raise ValueError("input plan must contain non-empty input_bindings")
    pairs: list[tuple[str, str]] = []; seen: set[str] = set()
    for idx, binding in enumerate(bindings):
        errors = validate_binding(root, binding, f"input_plan.input_bindings[{idx}]")
        if errors:
            raise ValueError(" | ".join(errors))
        path = str(binding["path"]); kind = str(binding["kind"])
        if path in seen:
            raise ValueError(f"input plan contains duplicate path: {path}")
        if binding_key(binding) not in snapshot_keys:
            raise ValueError(f"input plan repository binding not covered by durable snapshot: {path}")
        seen.add(path); pairs.append((path, kind))

    initializer = plan.get("bound_by_artifact_initializer") or {}
    if not isinstance(initializer, dict):
        raise ValueError("bound_by_artifact_initializer must be a mapping")
    for label in ("module_contract_binding", "builder_binding"):
        binding = initializer.get(label)
        errors = validate_binding(root, binding, f"input_plan.{label}")
        if errors:
            raise ValueError(" | ".join(errors))
        if binding_key(binding) not in snapshot_keys:
            raise ValueError(f"input plan {label} is not covered by durable snapshot")

    snapshot_raw = str(snapshot_binding.get("path") or "")
    plan_rel = plan_path.resolve().relative_to(root.resolve()).as_posix()
    if plan_rel in seen:
        raise ValueError("input plan must not self-declare its own path; locker binds it exactly once")
    if plan_rel == snapshot_raw:
        raise ValueError("input plan and repository snapshot must be distinct files")
    pairs.append((plan_rel, "input_plan"))
    return plan_path, pairs, snapshot_raw


def lock_from_plan(root: Path, job_raw: str, plan_raw: str, runtime_name: str,
                   runtime_version: str, occurred_at: str | None = None) -> None:
    _, pairs, snapshot_raw = plan_pairs(root, plan_raw)
    lock_inputs(root, job_raw, pairs, snapshot_raw, runtime_name, runtime_version, occurred_at)


def selftest() -> None:
    with tempfile.TemporaryDirectory(prefix="qz-input-plan-") as tmp:
        root = Path(tmp)
        (root / "inputs").mkdir(); (root / "plans").mkdir(); (root / "production/contracts").mkdir(parents=True); (root / "production/provenance/repository-snapshots").mkdir(parents=True)
        (root / "production/contracts/repository-provenance-snapshot-v1.yaml").write_text("snapshot:\n  storage_root: production/provenance/repository-snapshots\n", encoding="utf-8")
        for path, text in (("inputs/a.txt", "a\n"), ("inputs/module.yaml", "id: m\n"), ("inputs/build.py", "# build\n")):
            (root / path).write_text(text, encoding="utf-8")
        entries = [
            repository_binding(root, "inputs/a.txt", "source"),
            repository_binding(root, "inputs/module.yaml", "module_contract"),
            repository_binding(root, "inputs/build.py", "builder"),
        ]
        snapshot = build_snapshot(entries, "a" * 40); snapshot_path = write_snapshot(snapshot, root=root)
        snapshot_binding = {"path": snapshot_path.relative_to(root).as_posix(), "sha256": sha256_file(snapshot_path), "kind": "repository_snapshot"}
        source_binding = {k: entries[0][k] for k in ("path", "sha256", "kind")}; module_binding = {k: entries[1][k] for k in ("path", "sha256", "kind")}; builder_binding = {k: entries[2][k] for k in ("path", "sha256", "kind")}
        payload = {
            "version": 1,
            "source_commit": "a" * 40,
            "repository_snapshot": snapshot,
            "repository_snapshot_binding": snapshot_binding,
            "bound_by_artifact_initializer": {"module_contract_binding": module_binding, "builder_binding": builder_binding},
            "input_bindings": [source_binding],
        }
        identity = canonical_sha256(payload); data = {**payload, "plan_identity_sha256": identity}
        plan = root / f"plans/{identity}.yaml"; plan.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
        _, pairs, snap = plan_pairs(root, f"plans/{identity}.yaml")
        assert pairs == [("inputs/a.txt", "source"), (f"plans/{identity}.yaml", "input_plan")]
        assert snap == snapshot_binding["path"]
        tampered = deepcopy(data); tampered["version"] = 2; plan.write_text(yaml.safe_dump(tampered, sort_keys=False), encoding="utf-8")
        try: plan_pairs(root, f"plans/{identity}.yaml")
        except ValueError: pass
        else: raise AssertionError("tampered plan identity escaped")
        plan.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        (root / "inputs/a.txt").write_text("changed\n", encoding="utf-8")
        try: plan_pairs(root, f"plans/{identity}.yaml")
        except ValueError: pass
        else: raise AssertionError("stale live repository bytes escaped plan lock")


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--root", type=Path, default=ROOT); parser.add_argument("--job"); parser.add_argument("--plan"); parser.add_argument("--runtime-name"); parser.add_argument("--runtime-version"); parser.add_argument("--occurred-at"); parser.add_argument("--selftest", action="store_true"); args = parser.parse_args()
    if args.selftest:
        selftest(); print("PASS: Artifact input plan locker selftest"); return 0
    if not all([args.job, args.plan, args.runtime_name, args.runtime_version]):
        parser.error("--job --plan --runtime-name --runtime-version are required")
    try:
        lock_from_plan(args.root.resolve(), args.job, args.plan, args.runtime_name, args.runtime_version, args.occurred_at)
    except Exception as exc:
        print(f"FAIL: {exc}"); return 1
    print("PASS: lock-artifact-input-plan")
    return 0


if __name__ == "__main__": raise SystemExit(main())
