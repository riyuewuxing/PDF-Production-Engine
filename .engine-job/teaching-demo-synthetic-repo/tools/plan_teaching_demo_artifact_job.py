#!/usr/bin/env python3
"""Plan one Teaching Demo Artifact Job without generating product PDFs.

The planner converts a READY portable case plus the Module Contract's provenance profile
into an explicit hash-bound input list and a durable repository snapshot. It scans
actual FIGURE markers and binds only referenced declarative components. It does not
invent content, accept blocks, start an Artifact Job, or execute build/render.
"""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path
import re
from typing import Any
import yaml

from artifact_foundation import ROOT, canonical_sha256, load_yaml, safe_repo_path, sha256_file
from check_teaching_demo_case import validate as validate_case
from provenance_snapshot import (
    build_snapshot,
    repository_binding,
    snapshot_bytes,
    snapshot_target,
    write_snapshot,
)

CONTRACT_PATH = Path("production/contracts/teacher-trial-two-pdf-v1.yaml")
REGISTRY_PATH = Path("production/contracts/module-registry-v1.yaml")
PLANNER_PATH = "tools/plan_teaching_demo_artifact_job.py"
LOCKER_PATH = "tools/lock_artifact_input_plan.py"


def _binding(root: Path, raw: str, kind: str) -> dict[str, str]:
    path = safe_repo_path(root, raw, must_exist=True)
    if not path.is_file():
        raise ValueError(f"planned binding is not a file: {raw}")
    if not isinstance(kind, str) or not kind.strip():
        raise ValueError(f"planned binding kind missing: {raw}")
    return {"path": raw, "sha256": sha256_file(path), "kind": kind}


def _dedupe_bindings(bindings: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    for binding in bindings:
        path = binding["path"]
        previous = seen.get(path)
        if previous is not None and previous != binding:
            raise ValueError(f"same input path planned with conflicting identity: {path}")
        seen[path] = binding
    return [seen[path] for path in sorted(seen)]


def _repo_rel(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _figure_markers(texts: list[str], pattern: str) -> list[str]:
    regex = re.compile(pattern)
    found: set[str] = set()
    for text in texts:
        for match in regex.findall(text):
            if isinstance(match, tuple):
                if len(match) != 1:
                    raise ValueError("figure marker regex must expose exactly one capture group")
                value = match[0]
            else:
                value = match
            if not isinstance(value, str) or not value:
                raise ValueError("figure marker regex produced an empty/non-string id")
            found.add(value)
    return sorted(found)


def _load_profile(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    contract = load_yaml(root / CONTRACT_PATH)
    if contract.get("id") != "teacher-trial-two-pdf-v1":
        raise ValueError("unexpected Teaching Demo product contract")
    profile = contract.get("artifact_job_profile")
    if not isinstance(profile, dict):
        raise ValueError("Teaching Demo artifact_job_profile is missing")
    if profile.get("plan_schema_id") != "teaching-demo-artifact-input-plan-v1":
        raise ValueError("Teaching Demo artifact plan schema drift")
    if profile.get("module_id") != "teacher_teaching_demo":
        raise ValueError("Teaching Demo artifact plan module_id drift")
    if profile.get("planner") != PLANNER_PATH:
        raise ValueError("Teaching Demo artifact planner authority drift")
    return contract, profile


def _figure_bindings(root: Path, profile: dict[str, Any], source_texts: list[str], minimum: int) -> tuple[list[str], list[dict[str, str]]]:
    policy = profile.get("figure_dependencies") or {}
    if not isinstance(policy, dict):
        raise ValueError("figure_dependencies must be a mapping")
    pattern = policy.get("marker_regex")
    if not isinstance(pattern, str) or not pattern:
        raise ValueError("figure marker_regex missing")
    markers = _figure_markers(source_texts, pattern)
    if len(markers) < minimum:
        raise ValueError(f"case requires at least {minimum} figure marker(s), found {len(markers)}")
    if not markers:
        return [], []
    registry_raw = policy.get("registry")
    component_root_raw = policy.get("component_root")
    if not isinstance(registry_raw, str) or not isinstance(component_root_raw, str):
        raise ValueError("figure registry/component_root policy missing")
    registry_path = safe_repo_path(root, registry_raw, must_exist=True)
    registry = load_yaml(registry_path)
    figures = registry.get("figures") or {}
    if not isinstance(figures, dict):
        raise ValueError("figure registry figures must be a mapping")
    component_root = safe_repo_path(root, component_root_raw, must_exist=True)
    if not component_root.is_dir():
        raise ValueError("figure component_root is not a directory")
    bindings: list[dict[str, str]] = []
    if policy.get("include_registry_when_any_figure_used") is True:
        bindings.append(_binding(root, registry_raw, "figure_registry"))
    for marker in markers:
        entry = figures.get(marker)
        if not isinstance(entry, dict):
            raise ValueError(f"unknown FIGURE marker: {marker}")
        tex = entry.get("tex")
        if not isinstance(tex, str) or not tex:
            raise ValueError(f"figure registry entry has no tex: {marker}")
        component = (component_root / tex).resolve()
        component.relative_to(component_root.resolve())
        component.relative_to(root.resolve())
        if not component.is_file():
            raise ValueError(f"figure component missing: {marker}: {tex}")
        bindings.append(_binding(root, _repo_rel(root, component), "figure_component"))
    return markers, bindings


def _snapshot_for_plan(
    root: Path,
    source_commit: str,
    input_bindings: list[dict[str, str]],
    module_contract_binding: dict[str, str],
    builder_binding: dict[str, str],
) -> tuple[dict[str, Any], dict[str, str]]:
    # Snapshot is the durable historical identity. Input bindings remain compact
    # path+SHA-256 live execution bindings; snapshot entries additionally carry Git blob IDs.
    pairs: list[tuple[str, str]] = [(x["path"], x["kind"]) for x in input_bindings]
    pairs.extend([
        (module_contract_binding["path"], module_contract_binding["kind"]),
        (builder_binding["path"], builder_binding["kind"]),
    ])
    seen: dict[str, str] = {}
    for path, kind in pairs:
        previous = seen.get(path)
        if previous is not None and previous != kind:
            raise ValueError(f"repository snapshot path has conflicting roles: {path}: {previous} vs {kind}")
        seen[path] = kind
    entries = [repository_binding(root, path, kind) for path, kind in sorted(seen.items())]
    snapshot = build_snapshot(entries, source_commit)
    target = snapshot_target(snapshot, root=root)
    payload = snapshot_bytes(snapshot)
    binding = {
        "path": _repo_rel(root, target),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "kind": "repository_snapshot",
    }
    return snapshot, binding


def build_plan(manifest_raw: str, source_commit: str, *, root: Path = ROOT) -> dict[str, Any]:
    case_errors = validate_case(manifest_raw, root=root)
    if case_errors:
        raise ValueError("case is not READY for Artifact planning: " + " | ".join(case_errors))
    manifest_path = safe_repo_path(root, manifest_raw, must_exist=True)
    manifest = load_yaml(manifest_path)
    contract, profile = _load_profile(root)
    registry = load_yaml(root / REGISTRY_PATH)
    module_id = str(profile["module_id"])
    module = (registry.get("modules") or {}).get(module_id)
    if not isinstance(module, dict) or module.get("lifecycle") != "ACTIVE":
        raise ValueError("Teaching Demo must be ACTIVE in module registry for a new plan")
    if module.get("module_contract") != CONTRACT_PATH.as_posix():
        raise ValueError("module registry Teaching Demo contract drift")
    adapter = module.get("artifact_adapter") or {}
    builder_raw = adapter.get("build") if isinstance(adapter, dict) else None
    if not isinstance(builder_raw, str) or not builder_raw:
        raise ValueError("Teaching Demo build adapter missing")

    workspace = safe_repo_path(root, manifest.get("workspace"), must_exist=True)
    if not workspace.is_dir():
        raise ValueError("manifest workspace is not a directory")
    sources = manifest.get("source") or {}
    if not isinstance(sources, dict):
        raise ValueError("manifest source must be a mapping")

    bindings: list[dict[str, str]] = []
    if profile.get("include_case_manifest") is True:
        bindings.append(_binding(root, _repo_rel(root, manifest_path), "case_manifest"))

    source_texts: list[str] = []
    planned_roles: list[dict[str, str]] = []
    roles = profile.get("workspace_source_roles") or []
    if not isinstance(roles, list) or not roles or not all(isinstance(x, str) and x for x in roles):
        raise ValueError("artifact_job_profile.workspace_source_roles invalid")
    for role in roles:
        rel = sources.get(role)
        if not isinstance(rel, str) or not rel:
            raise ValueError(f"manifest source role missing: {role}")
        path = (workspace / rel).resolve()
        path.relative_to(workspace.resolve()); path.relative_to(root.resolve())
        if not path.is_file():
            raise ValueError(f"workspace source file missing: {role}: {rel}")
        repo_rel = _repo_rel(root, path)
        bindings.append(_binding(root, repo_rel, f"case_source_{role}"))
        planned_roles.append({"role": role, "path": repo_rel})
        source_texts.append(path.read_text(encoding="utf-8"))

    dependencies = profile.get("repository_dependencies") or []
    if not isinstance(dependencies, list):
        raise ValueError("repository_dependencies must be a list")
    for item in dependencies:
        if not isinstance(item, dict):
            raise ValueError("repository dependency must be a mapping")
        raw, kind = item.get("path"), item.get("kind")
        if not isinstance(raw, str) or not isinstance(kind, str):
            raise ValueError("repository dependency path/kind invalid")
        bindings.append(_binding(root, raw, kind))
    if not any(x.get("path") == LOCKER_PATH for x in dependencies if isinstance(x, dict)):
        raise ValueError("artifact_job_profile must bind the generic input-plan locker")

    constraints = manifest.get("constraints") or {}
    minimum_figures = int(constraints.get("figure_count_min") or 0)
    markers, figure_bindings = _figure_bindings(root, profile, source_texts, minimum_figures)
    bindings.extend(figure_bindings)
    bindings = _dedupe_bindings(bindings)

    module_contract_binding = _binding(root, CONTRACT_PATH.as_posix(), "module_contract")
    builder_binding = _binding(root, builder_raw, "builder")
    repository_snapshot, snapshot_binding = _snapshot_for_plan(
        root, source_commit, bindings, module_contract_binding, builder_binding
    )
    case_id = str(manifest.get("case_id"))
    revision = int(manifest.get("instance_revision"))
    plan: dict[str, Any] = {
        "version": 1,
        "schema_id": profile["plan_schema_id"],
        "module_id": module_id,
        "case_id": case_id,
        "title": manifest.get("title"),
        "instance_revision": revision,
        "manifest": _repo_rel(root, manifest_path),
        "product_contract": contract["id"],
        "source_commit": source_commit,
        "bound_by_artifact_initializer": {
            "module_contract_binding": module_contract_binding,
            "builder_binding": builder_binding,
        },
        "repository_snapshot": repository_snapshot,
        "repository_snapshot_binding": snapshot_binding,
        "input_bindings": bindings,
        "case_source_roles": planned_roles,
        "figure_dependencies": {
            "used_marker_ids": markers,
            "count": len(markers),
            "minimum_required": minimum_figures,
        },
        "recommended_review_blocks": profile.get("recommended_review_blocks") or [],
        "execution": {
            "init_job_id_suggestion": f"teaching-demo-{case_id}-r{revision}",
            "lock_operator": LOCKER_PATH,
            "preflight": f"python tools/run_acceptance.py --scope preflight --manifest {_repo_rel(root, manifest_path)}",
            "formal_after_preflight_and_explicit_pdf_authorization": f"python tools/run_acceptance.py --scope formal --manifest {_repo_rel(root, manifest_path)}",
            "runtime_identity_required_at_lock": True,
        },
        "safety": {
            "planner_generates_product_pdf": False,
            "planner_accepts_human_review": False,
            "planner_mutates_artifact_lifecycle": False,
            "hidden_chat_memory_required": False,
            "engine_private_repository_access_required": False,
        },
    }
    plan["plan_identity_sha256"] = canonical_sha256(plan)
    return plan


def write_content_addressed_plan(plan: dict[str, Any], *, root: Path = ROOT) -> Path:
    contract, profile = _load_profile(root)
    del contract
    snapshot = plan.get("repository_snapshot")
    snapshot_binding = plan.get("repository_snapshot_binding")
    if not isinstance(snapshot, dict) or not isinstance(snapshot_binding, dict):
        raise ValueError("plan missing repository snapshot")
    snapshot_path = write_snapshot(snapshot, root=root)
    expected_snapshot_rel = _repo_rel(root, snapshot_path)
    if snapshot_binding.get("path") != expected_snapshot_rel:
        raise ValueError("plan repository_snapshot_binding path drift")
    if hashlib.sha256(snapshot_path.read_bytes()).hexdigest() != snapshot_binding.get("sha256"):
        raise ValueError("plan repository_snapshot_binding hash drift")

    output_root = safe_repo_path(root, profile.get("output_root"))
    output_root.mkdir(parents=True, exist_ok=True)
    case_id = str(plan.get("case_id") or "unknown-case")
    identity = str(plan.get("plan_identity_sha256") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", identity):
        raise ValueError("plan_identity_sha256 invalid")
    target_dir = (output_root / case_id).resolve()
    target_dir.relative_to(output_root.resolve()); target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{identity}.yaml"
    payload = yaml.safe_dump(plan, allow_unicode=True, sort_keys=False)
    if target.exists():
        if target.read_text(encoding="utf-8") != payload:
            raise ValueError("content-addressed plan path exists with different bytes")
    else:
        target.write_text(payload, encoding="utf-8")
    return target


def selftest() -> None:
    assert _figure_markers(["[[FIGURE:a]] x [[FIGURE:b]]", "[[FIGURE:a]]"], r"\[\[FIGURE:([a-z0-9-]+)\]\]") == ["a", "b"]
    deduped = _dedupe_bindings([
        {"path": "b", "sha256": "2", "kind": "k"},
        {"path": "a", "sha256": "1", "kind": "k"},
        {"path": "a", "sha256": "1", "kind": "k"},
    ])
    assert [x["path"] for x in deduped] == ["a", "b"]
    try:
        _dedupe_bindings([
            {"path": "a", "sha256": "1", "kind": "k"},
            {"path": "a", "sha256": "2", "kind": "k"},
        ])
    except ValueError:
        pass
    else:
        raise AssertionError("conflicting duplicate plan binding escaped")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--source-commit")
    parser.add_argument("--write", action="store_true", help="write immutable snapshot and content-addressed plan")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    selftest()
    if args.selftest:
        print("PASS: Teaching Demo Artifact input planner selftest")
        return 0
    if not args.manifest or not args.source_commit:
        parser.error("--manifest and --source-commit are required unless --selftest")
    try:
        plan = build_plan(args.manifest, args.source_commit)
        if args.write:
            path = write_content_addressed_plan(plan)
            print(f"PLAN_WRITTEN: {path.relative_to(ROOT)}")
            print(f"PLAN_IDENTITY_SHA256: {plan['plan_identity_sha256']}")
            print(f"SNAPSHOT: {plan['repository_snapshot_binding']['path']}")
            print(f"SOURCE_COMMIT: {plan['source_commit']}")
        else:
            print(yaml.safe_dump(plan, allow_unicode=True, sort_keys=False).rstrip())
    except Exception as exc:
        print(f"FAIL: {exc}")
        return 1
    print("NO_PRODUCT_PDF_COMPOSITION_PERFORMED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
