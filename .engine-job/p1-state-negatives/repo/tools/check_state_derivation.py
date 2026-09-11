#!/usr/bin/env python3
"""Fail closed when committed execution-state views differ from ledger projection."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
from typing import Any

import yaml

from artifact_foundation import ROOT, load_yaml
from derive_state import (
    CATALOG,
    CURRENT_STATE,
    NEXT_ACTION,
    project_repository,
)
from gen_handoff import HANDOFF, rendered_handoff


def _load_optional(path: Path) -> Any:
    if not path.is_file():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def validate(root: Path = ROOT) -> list[str]:
    root = root.resolve()
    errors: list[str] = []
    try:
        first = project_repository(root)
        second = project_repository(root)
    except Exception as exc:
        return [f"projection failed: {exc}"]

    if first != second:
        errors.append("projection is not deterministic across two reads")

    current_path = root / CURRENT_STATE
    if not current_path.is_file():
        errors.append(f"missing {CURRENT_STATE}")
    else:
        current = load_yaml(current_path)
        if current.get("artifact_execution_projection") != first["state_projection"]:
            errors.append("CURRENT_STATE.yaml artifact_execution_projection is stale or hand-edited")

    next_value = _load_optional(root / NEXT_ACTION)
    if next_value is None:
        errors.append(f"missing {NEXT_ACTION}")
    elif next_value != first["next_action"]:
        errors.append(f"{NEXT_ACTION} is stale or hand-edited")

    catalog_value = _load_optional(root / CATALOG)
    if catalog_value is None:
        errors.append(f"missing {CATALOG}")
    else:
        committed_deliverables = catalog_value.get("deliverables") or []
        committed_current_counts = Counter(
            item.get("logical_key")
            for item in committed_deliverables
            if isinstance(item, dict) and item.get("current") is True
        )
        committed_duplicates = sorted(
            key for key, count in committed_current_counts.items()
            if key is not None and count > 1
        )
        if committed_duplicates:
            errors.append(
                "committed catalog has duplicate current logical_key values: "
                + ", ".join(str(x) for x in committed_duplicates)
            )
        if catalog_value != first["catalog"]:
            errors.append(f"{CATALOG} is stale or hand-edited")

    handoff_path = root / HANDOFF
    if not handoff_path.is_file():
        errors.append(f"missing {HANDOFF}")
    else:
        committed = handoff_path.read_text(encoding="utf-8")
        try:
            expected = rendered_handoff(root)
        except Exception as exc:
            errors.append(f"HANDOFF projection failed: {exc}")
        else:
            if committed != expected:
                errors.append("HANDOFF generated Artifact execution snapshot is stale or hand-edited")

    deliverables = first["catalog"].get("deliverables") or []
    current_counts = Counter(
        item.get("logical_key")
        for item in deliverables
        if isinstance(item, dict) and item.get("current") is True
    )
    duplicates = sorted(key for key, count in current_counts.items() if count > 1)
    if duplicates:
        errors.append("catalog has duplicate current logical_key values: " + ", ".join(duplicates))

    next_action = first["next_action"].get("next_action") or {}
    if first["next_action"].get("current") is None:
        if next_action.get("kind") != "NO_ACTIVE_JOB":
            errors.append("no explicit current job must derive NO_ACTIVE_JOB")
        if next_action.get("is_blocked") is not False:
            errors.append("NO_ACTIVE_JOB is not a blocker")
    if next_action.get("blocked_by") and next_action.get("kind") != "BLOCKED":
        errors.append("blocked_by requires kind=BLOCKED")

    projection = first["state_projection"]
    if projection.get("current_job") is not None:
        errors.append("P1 must not infer current_job from historical/incomplete inventory")
    if projection.get("historical_incomplete_jobs_are_not_current") is not True:
        errors.append("anti-regression historical-job rule missing")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    errors = validate(args.root)
    if errors:
        print("FAIL: execution state derivation")
        for error in errors:
            print("- " + error)
        return 1
    print("PASS: execution state derivation is deterministic and committed views match")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
