#!/usr/bin/env python3
"""Historical provenance verifier for an Artifact Job.

Unlike the live Artifact checker, this tool never asks mutable current repository paths
to prove old repository input bytes. It validates the immutable snapshot file, checks
that the job's repository bindings are covered by that snapshot, and can optionally
verify every snapshot entry against the recorded Git source commit.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import tempfile
from typing import Any
import yaml

from artifact_foundation import (
    ROOT,
    artifact_input_fingerprint,
    binding_key,
    is_sha256,
    load_yaml,
    validate_binding,
)
from provenance_snapshot import (
    build_snapshot,
    repository_binding,
    validate_snapshot_binding,
    write_snapshot,
)

ARTIFACT_CONTRACT = Path("production/contracts/artifact-job-v1.yaml")


def _key(binding: Any) -> tuple[str, str, str] | None:
    if not isinstance(binding, dict):
        return None
    return binding_key(binding)


def validate(data: dict[str, Any], root: Path = ROOT, *, mode: str = "structure") -> list[str]:
    if mode not in {"structure", "git-history"}:
        return [f"historical provenance mode unsupported: {mode}"]
    errors: list[str] = []
    try:
        contract = load_yaml(root / ARTIFACT_CONTRACT)
    except Exception as exc:
        return [f"artifact contract load failed: {exc}"]
    state = data.get("state")
    states = list(contract.get("states") or [])
    if state not in states:
        return [f"job state invalid: {state!r}"]
    if states.index(state) < states.index("INPUTS_LOCKED"):
        return ["historical provenance requires INPUTS_LOCKED or later"]

    provenance = data.get("build_provenance")
    if not isinstance(provenance, dict):
        return ["build_provenance must be a mapping"]
    snapshot_binding = provenance.get("source_snapshot_binding")
    snapshot, found = validate_snapshot_binding(root, snapshot_binding, mode=mode)
    errors.extend(found)
    if snapshot is None:
        return errors

    snapshot_keys = {
        (str(x.get("path") or ""), str(x.get("sha256") or ""), str(x.get("kind") or ""))
        for x in (snapshot.get("bindings") or []) if isinstance(x, dict)
    }
    snapshot_policy = (contract.get("build_provenance") or {}).get("source_snapshot") or {}
    exempt_kinds = set(snapshot_policy.get("snapshot_exempt_input_kinds") or [])

    module_binding = provenance.get("module_contract_binding")
    builder_binding = provenance.get("builder_binding")
    for label, binding in (
        ("build_provenance.module_contract_binding", module_binding),
        ("build_provenance.builder_binding", builder_binding),
    ):
        errors.extend(validate_binding(root, binding, label, require_file=False))
        key = _key(binding)
        if key is not None and key not in snapshot_keys:
            errors.append(f"{label}: binding not covered by durable repository snapshot")

    inputs = data.get("input_bindings")
    if not isinstance(inputs, list) or not inputs:
        errors.append("input_bindings must be a non-empty list")
        inputs = []
    for idx, binding in enumerate(inputs):
        label = f"input_bindings[{idx}]"
        kind = binding.get("kind") if isinstance(binding, dict) else None
        # Generated content-addressed execution records (currently input_plan) are not
        # source-commit files and therefore remain directly hash-verified.
        if kind in exempt_kinds:
            errors.extend(validate_binding(root, binding, label, require_file=True))
            continue
        errors.extend(validate_binding(root, binding, label, require_file=False))
        key = _key(binding)
        if key is not None and key not in snapshot_keys:
            errors.append(f"{label}: repository binding not covered by durable snapshot")

    runtime = provenance.get("runtime_identity")
    if not isinstance(runtime, dict):
        errors.append("runtime_identity must be a mapping")
    fingerprint = provenance.get("input_fingerprint")
    if not is_sha256(fingerprint):
        errors.append("input_fingerprint must be lowercase SHA-256")
    else:
        try:
            expected = artifact_input_fingerprint(
                data.get("module_id"), module_binding, builder_binding, runtime, inputs, snapshot_binding
            )
            if fingerprint != expected:
                errors.append(f"input_fingerprint mismatch: declared={fingerprint} expected={expected}")
        except Exception as exc:
            errors.append(f"cannot derive historical input fingerprint: {exc}")
    return errors


def selftest() -> int:
    with tempfile.TemporaryDirectory(prefix="qz-historical-provenance-") as tmp:
        root = Path(tmp)
        (root / "production/contracts").mkdir(parents=True)
        (root / "production/provenance/repository-snapshots").mkdir(parents=True)
        (root / "content").mkdir(); (root / "tools").mkdir(); (root / "plans").mkdir()
        (root / ARTIFACT_CONTRACT).write_text(
            "states: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\n"
            "build_provenance:\n  source_snapshot:\n    snapshot_exempt_input_kinds: [input_plan]\n",
            encoding="utf-8",
        )
        (root / "production/contracts/repository-provenance-snapshot-v1.yaml").write_text(
            "snapshot:\n  storage_root: production/provenance/repository-snapshots\n", encoding="utf-8"
        )
        (root / "content/source.txt").write_text("source-v1\n", encoding="utf-8")
        (root / "content/module.yaml").write_text("id: m\n", encoding="utf-8")
        (root / "tools/build.py").write_text("# build v1\n", encoding="utf-8")
        entries = [
            repository_binding(root, "content/source.txt", "source"),
            repository_binding(root, "content/module.yaml", "module_contract"),
            repository_binding(root, "tools/build.py", "builder"),
        ]
        snapshot = build_snapshot(entries, "a" * 40)
        snapshot_path = write_snapshot(snapshot, root=root)
        from artifact_foundation import sha256_file
        snapshot_binding = {"path": snapshot_path.relative_to(root).as_posix(), "sha256": sha256_file(snapshot_path), "kind": "repository_snapshot"}
        plan = root / "plans/p.yaml"; plan.write_text("plan: 1\n", encoding="utf-8")
        source_binding = {k: entries[0][k] for k in ("path", "sha256", "kind")}
        module_binding = {k: entries[1][k] for k in ("path", "sha256", "kind")}
        builder_binding = {k: entries[2][k] for k in ("path", "sha256", "kind")}
        plan_binding = {"path": "plans/p.yaml", "sha256": sha256_file(plan), "kind": "input_plan"}
        inputs = [source_binding, plan_binding]
        runtime = {"name": "python", "version": "3.12"}
        job = {
            "state": "INPUTS_LOCKED", "module_id": "synthetic", "input_bindings": inputs,
            "build_provenance": {
                "module_contract_binding": module_binding,
                "builder_binding": builder_binding,
                "source_snapshot_binding": snapshot_binding,
                "runtime_identity": runtime,
                "input_fingerprint": artifact_input_fingerprint("synthetic", module_binding, builder_binding, runtime, inputs, snapshot_binding),
            },
        }
        if validate(job, root):
            print("FAIL: historical provenance rejected valid snapshot", validate(job, root)); return 1
        # Mutable working-tree source changes must not invalidate historical proof.
        (root / "content/source.txt").write_text("source-v2\n", encoding="utf-8")
        if validate(job, root):
            print("FAIL: historical provenance depended on current source bytes", validate(job, root)); return 1
        # But a mutated content-addressed plan record remains invalid.
        plan.write_text("plan: 2\n", encoding="utf-8")
        if not validate(job, root):
            print("FAIL: changed input_plan escaped historical verification"); return 1
    print("PASS: historical artifact provenance selftest")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", type=Path)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--mode", choices=["structure", "git-history"], default="structure")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.job:
        parser.error("--job or --selftest is required")
    try:
        data = load_yaml(args.job)
        errors = validate(data, args.root.resolve(), mode=args.mode)
    except Exception as exc:
        print(f"FAIL: historical artifact provenance: {exc}")
        return 1
    if errors:
        print("FAIL: historical artifact provenance")
        for error in errors: print("- " + error)
        return 1
    print(f"PASS: historical artifact provenance [{args.mode}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
