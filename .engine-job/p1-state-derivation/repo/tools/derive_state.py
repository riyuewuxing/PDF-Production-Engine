#!/usr/bin/env python3
"""Deterministic Artifact execution-state projection.

This tool does not create a second execution ledger. It reads the canonical
Artifact Jobs and their existing execution ledgers, validates the lifecycle
prefix, and derives compatibility views used by project handoff/indexing.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from artifact_foundation import ROOT, load_yaml, parse_iso8601, safe_repo_path

LEDGER_CONTRACT = Path("production/contracts/execution-ledger-v1.yaml")
MODULE_REGISTRY = Path("production/contracts/module-registry-v1.yaml")
JOBS_ROOT = Path("production/artifact-jobs")
CURRENT_STATE = Path("CURRENT_STATE.yaml")
NEXT_ACTION = Path("NEXT_ACTION.yaml")
CATALOG = Path("outputs/CATALOG.yaml")
LEGACY_CATALOG = Path("outputs/CATALOG.md")

ACTION_BY_STAGE = {
    "JOB_CREATED": ("FIX_INPUT", "INPUTS_LOCKED"),
    "INPUTS_LOCKED": ("RUN_GATE", "BLOCKS_ACCEPTED"),
    "BLOCKS_ACCEPTED": ("RUN_GATE", "BUILT"),
    "BUILT": ("RUN_GATE", "MACHINE_VERIFIED"),
    "MACHINE_VERIFIED": ("AWAIT_HUMAN", "HUMAN_ACCEPTED"),
    "HUMAN_ACCEPTED": ("RUN_GATE", "PUBLISHED"),
    "PUBLISHED": (None, None),
}


def _yaml_text(value: Any) -> str:
    return yaml.safe_dump(
        value,
        allow_unicode=True,
        sort_keys=False,
        width=120,
        default_flow_style=False,
    )


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _latest_at(events: list[dict[str, Any]]) -> str | None:
    values = [
        str(event.get("occurred_at"))
        for event in events
        if isinstance(event, dict) and parse_iso8601(event.get("occurred_at"))
    ]
    if not values:
        return None
    return max(values, key=_dt)


def _binding_key(binding: Any) -> tuple[str, str, str]:
    if not isinstance(binding, dict):
        return ("", "", "")
    return (
        str(binding.get("path") or ""),
        str(binding.get("sha256") or ""),
        str(binding.get("kind") or ""),
    )


def _validate_ledger_structure(
    ledger: dict[str, Any],
    contract: dict[str, Any],
    *,
    ledger_path: str,
) -> tuple[str, list[str]]:
    errors: list[str] = []
    events = ledger.get("events")
    if not isinstance(events, list) or not events:
        return "", [f"{ledger_path}: events must be a non-empty list"]

    allowed_event_types = set(contract.get("event_types") or [])
    lifecycle = list(contract.get("lifecycle_transition_types") or [])
    if not lifecycle:
        errors.append(f"{LEDGER_CONTRACT}: lifecycle_transition_types missing")

    seen_ids: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for index, raw in enumerate(events, start=1):
        label = f"{ledger_path}: event[{index - 1}]"
        if not isinstance(raw, dict):
            errors.append(f"{label}: must be mapping")
            continue
        normalized.append(raw)
        if raw.get("seq") != index:
            errors.append(f"{label}: seq must be contiguous and equal {index}")
        event_id = raw.get("event_id")
        if not isinstance(event_id, str) or not event_id:
            errors.append(f"{label}: event_id required")
        elif event_id in seen_ids:
            errors.append(f"{label}: duplicate event_id {event_id}")
        else:
            seen_ids.add(event_id)
        typ = raw.get("type")
        if typ not in allowed_event_types:
            errors.append(f"{label}: unsupported type {typ!r}")
        if not parse_iso8601(raw.get("occurred_at")):
            errors.append(f"{label}: occurred_at must be ISO-8601")
        if not isinstance(raw.get("actor"), str) or not raw.get("actor"):
            errors.append(f"{label}: actor required")

    transitions = [
        str(event.get("type"))
        for event in normalized
        if event.get("type") in lifecycle
    ]
    if not transitions:
        errors.append(f"{ledger_path}: lifecycle must start with JOB_CREATED")
        return "", errors
    if len(transitions) != len(set(transitions)):
        errors.append(f"{ledger_path}: duplicate lifecycle transition")
    expected = lifecycle[: len(transitions)]
    if transitions != expected:
        errors.append(
            f"{ledger_path}: lifecycle transitions must be ordered prefix: "
            + " -> ".join(lifecycle)
        )
    return transitions[-1], errors


def _job_action(job_path: str, stage: str) -> dict[str, Any]:
    kind, target = ACTION_BY_STAGE.get(stage, (None, None))
    if kind is None:
        return {
            "kind": None,
            "required_transition": None,
            "command": None,
            "why": "job is already PUBLISHED",
            "is_blocked": False,
            "blocked_by": [],
        }
    command: str | None = None
    if stage == "MACHINE_VERIFIED":
        command = (
            "independent HUMAN review required; use manage_artifact_job.py "
            "human-accept/human-reject only after real review"
        )
    elif stage == "HUMAN_ACCEPTED":
        command = f"python tools/manage_artifact_job.py publish --job {job_path}"
    elif stage == "JOB_CREATED":
        command = (
            f"python tools/manage_artifact_job.py lock-inputs --job {job_path} "
            "<required module inputs>"
        )
    else:
        command = (
            f"progress {job_path} through canonical Artifact tooling to {target}; "
            "do not infer this historical job is globally current"
        )
    return {
        "kind": kind,
        "required_transition": target,
        "command": command,
        "why": f"declared/projected Artifact stage is {stage}",
        "is_blocked": False,
        "blocked_by": [],
    }


def _job_projection(
    root: Path,
    job_path: Path,
    ledger_contract: dict[str, Any],
    registry: dict[str, Any],
) -> dict[str, Any]:
    rel_job = job_path.relative_to(root).as_posix()
    job = load_yaml(job_path)
    job_id = job.get("job_id")
    module_id = job.get("module_id")
    if not isinstance(job_id, str) or not job_id:
        raise ValueError(f"{rel_job}: job_id required")
    if not isinstance(module_id, str) or not module_id:
        raise ValueError(f"{rel_job}: module_id required")

    modules = registry.get("modules") or {}
    module = modules.get(module_id)
    if not isinstance(module, dict):
        raise ValueError(f"{rel_job}: module_id {module_id!r} missing from module registry")
    lifecycle = module.get("lifecycle")

    ledger_raw = job.get("execution_ledger")
    ledger_path = safe_repo_path(root, ledger_raw, must_exist=True)
    rel_ledger = ledger_path.relative_to(root).as_posix()
    ledger = load_yaml(ledger_path)
    if ledger.get("job_id") != job_id:
        raise ValueError(f"{rel_job}: ledger job_id mismatch: {rel_ledger}")
    if ledger.get("contract") != LEDGER_CONTRACT.as_posix():
        raise ValueError(f"{rel_ledger}: wrong execution ledger contract")

    projected_state, errors = _validate_ledger_structure(
        ledger, ledger_contract, ledger_path=rel_ledger
    )
    if errors:
        raise ValueError("; ".join(errors))
    if job.get("state") != projected_state:
        raise ValueError(
            f"{rel_job}: declared state {job.get('state')!r} != ledger projection "
            f"{projected_state!r}"
        )

    events = [event for event in ledger.get("events") or [] if isinstance(event, dict)]
    last_at = _latest_at(events)
    surfaces = sorted(
        {
            str(event.get("execution_surface"))
            for event in events
            if isinstance(event.get("execution_surface"), str)
            and event.get("execution_surface")
        }
    )
    missing_instrumentation_status = (
        (ledger_contract.get("legacy_missing_instrumentation") or {}).get("status")
        or "UNKNOWN_MISSING_INSTRUMENTATION"
    )
    instrumentation = (
        "EXECUTION_SURFACE_OBSERVED"
        if surfaces
        else str(missing_instrumentation_status)
    )

    return {
        "job_id": job_id,
        "module_id": module_id,
        "module_lifecycle": lifecycle,
        "job_path": rel_job,
        "ledger_path": rel_ledger,
        "stage": projected_state,
        "last_event_at": last_at,
        "event_count": len(events),
        "instrumentation": instrumentation,
        "execution_surfaces": surfaces,
        "candidate_next_action": _job_action(rel_job, projected_state),
        "_job": job,
    }


def _discover_jobs(root: Path) -> list[Path]:
    base = root / JOBS_ROOT
    if not base.exists():
        return []
    return sorted(path for path in base.rglob("*.yaml") if path.is_file())


def _catalog_from_jobs(jobs: list[dict[str, Any]], as_of: str | None) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for item in jobs:
        job = item["_job"]
        published_bindings = {
            _binding_key(binding)
            for binding in (job.get("publication") or {}).get("outputs") or []
            if isinstance(binding, dict)
        }
        human_bindings = {
            _binding_key(binding)
            for binding in (job.get("human_acceptance") or {}).get("accepted_outputs") or []
            if isinstance(binding, dict)
        }
        machine_present = bool(job.get("machine_evidence"))
        for binding in job.get("outputs") or []:
            if not isinstance(binding, dict):
                continue
            path = str(binding.get("path") or "")
            digest = str(binding.get("sha256") or "")
            kind = str(binding.get("kind") or "")
            if not path or not digest or not kind:
                continue
            key = _binding_key(binding)
            logical_key = f"{item['module_id']}::{kind}::{Path(path).name}"
            candidates.append(
                {
                    "id": f"{item['job_id']}::{path}",
                    "logical_key": logical_key,
                    "module_id": item["module_id"],
                    "job_id": item["job_id"],
                    "kind": kind,
                    "path": path,
                    "sha256": digest,
                    "revision": item["job_id"],
                    "job_stage": item["stage"],
                    "last_event_at": item["last_event_at"],
                    "published": item["stage"] == "PUBLISHED" and key in published_bindings,
                    "acceptance": {
                        "machine": "PRESENT" if machine_present else "NOT_RECORDED",
                        "human": "ACCEPTED" if key in human_bindings else "NOT_ACCEPTED",
                        "ref": item["job_path"],
                    },
                }
            )

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in candidates:
        groups[item["logical_key"]].append(item)

    for values in groups.values():
        published = [x for x in values if x["published"]]
        winner: dict[str, Any] | None = None
        if published:
            winner = max(
                published,
                key=lambda x: (
                    _dt(x["last_event_at"]).timestamp() if x["last_event_at"] else float("-inf"),
                    x["job_id"],
                ),
            )
        for item in values:
            item["current"] = bool(winner and item["id"] == winner["id"])
            item["superseded_by"] = (
                winner["id"]
                if winner and item["published"] and item["id"] != winner["id"]
                else None
            )

    deliverables = sorted(candidates, key=lambda x: (x["logical_key"], x["job_id"], x["path"]))
    for item in deliverables:
        item.pop("published", None)
        item.pop("last_event_at", None)

    return {
        "version": 1,
        "generated": True,
        "scope": "artifact-job-outputs-only",
        "as_of": as_of,
        "derived_from": {
            "artifact_jobs": JOBS_ROOT.as_posix(),
            "execution_ledger_contract": LEDGER_CONTRACT.as_posix(),
        },
        "legacy_catalog": {
            "path": LEGACY_CATALOG.as_posix(),
            "role": "historical narrative and receipt inventory; not rewritten by this projection",
        },
        "deliverables": deliverables,
    }


def project_repository(root: Path = ROOT) -> dict[str, Any]:
    root = root.resolve()
    ledger_contract = load_yaml(root / LEDGER_CONTRACT)
    registry = load_yaml(root / MODULE_REGISTRY)
    jobs = [
        _job_projection(root, path, ledger_contract, registry)
        for path in _discover_jobs(root)
    ]

    last_values = [item["last_event_at"] for item in jobs if item["last_event_at"]]
    as_of = max(last_values, key=_dt) if last_values else None
    counts = Counter(item["stage"] for item in jobs)
    instrumentation = Counter(item["instrumentation"] for item in jobs)

    public_jobs = []
    for item in jobs:
        public_jobs.append({k: v for k, v in item.items() if k != "_job"})

    next_action = {
        "version": 1,
        "generated": True,
        "scope": "artifact-execution",
        "as_of": as_of,
        "derived_from": {
            "artifact_jobs": JOBS_ROOT.as_posix(),
            "execution_ledger_contract": LEDGER_CONTRACT.as_posix(),
            "module_registry": MODULE_REGISTRY.as_posix(),
        },
        "current": None,
        "selection_policy": "explicit-job-id-only",
        "job_actions": [
            {
                "job_id": item["job_id"],
                "module_id": item["module_id"],
                "stage": item["stage"],
                "candidate_next_action": item["candidate_next_action"],
            }
            for item in public_jobs
        ],
        "next_action": {
            "kind": "NO_ACTIVE_JOB",
            "command": None,
            "why": (
                "No canonical active Artifact Job selector exists. Historical/incomplete "
                "jobs are inventory only and must not be inferred as the current project task."
            ),
            "is_blocked": False,
            "blocked_by": [],
        },
    }

    catalog = _catalog_from_jobs(jobs, as_of)
    state_projection = {
        "generated": True,
        "schema_version": 1,
        "scope": "artifact-execution",
        "as_of": as_of,
        "derived_from": {
            "artifact_jobs": JOBS_ROOT.as_posix(),
            "execution_ledger_contract": LEDGER_CONTRACT.as_posix(),
            "module_registry": MODULE_REGISTRY.as_posix(),
        },
        "job_count": len(public_jobs),
        "state_counts": dict(sorted(counts.items())),
        "instrumentation_counts": dict(sorted(instrumentation.items())),
        "current_job": None,
        "current_selection_policy": "explicit-job-id-only",
        "historical_incomplete_jobs_are_not_current": True,
        "jobs": public_jobs,
    }
    return {
        "state_projection": state_projection,
        "next_action": next_action,
        "catalog": catalog,
    }


def rendered_current_state(root: Path, projection: dict[str, Any]) -> dict[str, Any]:
    state = load_yaml(root / CURRENT_STATE)
    state["artifact_execution_projection"] = projection["state_projection"]
    return state


def write_projection(root: Path, projection: dict[str, Any]) -> None:
    root = root.resolve()
    (root / NEXT_ACTION).write_text(_yaml_text(projection["next_action"]), encoding="utf-8")
    (root / CATALOG).parent.mkdir(parents=True, exist_ok=True)
    (root / CATALOG).write_text(_yaml_text(projection["catalog"]), encoding="utf-8")
    current = rendered_current_state(root, projection)
    (root / CURRENT_STATE).write_text(_yaml_text(current), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        projection = project_repository(args.root)
        if args.write:
            write_projection(args.root, projection)
            print("PASS: derived Artifact execution projection written")
        else:
            print(_yaml_text(projection["state_projection"]), end="")
    except Exception as exc:
        print(f"FAIL: state derivation: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
