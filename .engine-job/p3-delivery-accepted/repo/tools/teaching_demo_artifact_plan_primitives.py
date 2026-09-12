"""Primitive library for Teaching Demo Artifact input planning.

This module intentionally has no complete ``build_plan`` orchestration, no
content-addressed plan writer, no ``main`` and no CLI.  Protected planning and
plan-write authority lives only in ``plan_teaching_demo_artifact_job.py``.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
from typing import Any

from artifact_foundation import ROOT, canonical_sha256, load_yaml, safe_repo_path, sha256_file
from provenance_snapshot import build_snapshot, repository_binding, snapshot_bytes, snapshot_target

CONTRACT_PATH = Path("production/contracts/teacher-trial-two-pdf-v1.yaml")
REGISTRY_PATH = Path("production/contracts/module-registry-v1.yaml")
PLANNER_PATH = "tools/plan_teaching_demo_artifact_job.py"
LOCKER_PATH = "tools/lock_artifact_input_plan.py"


def binding(root: Path, raw: str, kind: str) -> dict[str, str]:
    path = safe_repo_path(root, raw, must_exist=True)
    if not path.is_file():
        raise ValueError(f"planned binding is not a file: {raw}")
    if not isinstance(kind, str) or not kind.strip():
        raise ValueError(f"planned binding kind missing: {raw}")
    return {"path": raw, "sha256": sha256_file(path), "kind": kind}


def dedupe_bindings(bindings: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    for item in bindings:
        path = item["path"]
        previous = seen.get(path)
        if previous is not None and previous != item:
            raise ValueError(f"same input path planned with conflicting identity: {path}")
        seen[path] = item
    return [seen[path] for path in sorted(seen)]


def repo_rel(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def figure_markers(texts: list[str], pattern: str) -> list[str]:
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


def load_profile(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
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


def figure_bindings(
    root: Path,
    profile: dict[str, Any],
    source_texts: list[str],
    minimum: int,
) -> tuple[list[str], list[dict[str, str]]]:
    policy = profile.get("figure_dependencies") or {}
    if not isinstance(policy, dict):
        raise ValueError("figure_dependencies must be a mapping")
    pattern = policy.get("marker_regex")
    if not isinstance(pattern, str) or not pattern:
        raise ValueError("figure marker_regex missing")
    markers = figure_markers(source_texts, pattern)
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
        bindings.append(binding(root, registry_raw, "figure_registry"))
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
        bindings.append(binding(root, repo_rel(root, component), "figure_component"))
    return markers, bindings


def snapshot_for_plan(
    root: Path,
    source_commit: str,
    input_bindings: list[dict[str, str]],
    module_contract_binding: dict[str, str],
    builder_binding: dict[str, str],
) -> tuple[dict[str, Any], dict[str, str]]:
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
    snapshot_binding = {
        "path": repo_rel(root, target),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "kind": "repository_snapshot",
    }
    return snapshot, snapshot_binding


def selftest_primitives() -> None:
    assert figure_markers(
        ["[[FIGURE:a]] x [[FIGURE:b]]", "[[FIGURE:a]]"],
        r"\[\[FIGURE:([a-z0-9-]+)\]\]",
    ) == ["a", "b"]
    deduped = dedupe_bindings([
        {"path": "b", "sha256": "2", "kind": "k"},
        {"path": "a", "sha256": "1", "kind": "k"},
        {"path": "a", "sha256": "1", "kind": "k"},
    ])
    assert [x["path"] for x in deduped] == ["a", "b"]
    try:
        dedupe_bindings([
            {"path": "a", "sha256": "1", "kind": "k"},
            {"path": "a", "sha256": "2", "kind": "k"},
        ])
    except ValueError:
        pass
    else:
        raise AssertionError("conflicting duplicate plan binding escaped")
