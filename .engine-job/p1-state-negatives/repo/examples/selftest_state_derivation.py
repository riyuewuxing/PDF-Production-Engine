#!/usr/bin/env python3
"""Isolated P1 regression/negative tests for deterministic state derivation."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import shutil
import sys
import tempfile

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

from derive_state import project_repository, write_projection  # noqa: E402
from gen_handoff import rendered_handoff  # noqa: E402
from check_state_derivation import validate as check_projection  # noqa: E402


LIFECYCLE = [
    "JOB_CREATED",
    "INPUTS_LOCKED",
    "BLOCKS_ACCEPTED",
    "BUILT",
    "MACHINE_VERIFIED",
    "HUMAN_ACCEPTED",
    "PUBLISHED",
]


def dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(value, allow_unicode=True, sort_keys=False, width=120),
        encoding="utf-8",
    )


def ledger(job_id: str, through: str, *, surface: bool = False) -> dict:
    stop = LIFECYCLE.index(through) + 1
    events = []
    for seq, typ in enumerate(LIFECYCLE[:stop], start=1):
        event = {
            "seq": seq,
            "event_id": f"{job_id}:{seq:04d}",
            "occurred_at": f"2026-01-01T00:00:{seq:02d}Z",
            "type": typ,
            "actor": "Selftest",
        }
        if surface:
            event["execution_surface"] = "isolated-selftest"
        events.append(event)
    return {
        "version": 1,
        "contract": "production/contracts/execution-ledger-v1.yaml",
        "job_id": job_id,
        "events": events,
        "derived": {"artifact_state": through},
    }


def job(
    job_id: str,
    module_id: str,
    through: str,
    ledger_path: str,
    *,
    output: bool = False,
) -> dict:
    binding = {
        "path": f"outputs/{job_id}.pdf",
        "sha256": ("a" if module_id == "teacher_teaching_demo" else "b") * 64,
        "kind": "pdf",
    }
    outputs = [binding] if output else []
    human = {
        "state": "REVIEW_PASS" if through in {"HUMAN_ACCEPTED", "PUBLISHED"} else "PENDING",
        "reviewer": "Selftest",
        "reviewed_at": "2026-01-01T00:00:06Z" if through in {"HUMAN_ACCEPTED", "PUBLISHED"} else None,
        "accepted_outputs": outputs if through in {"HUMAN_ACCEPTED", "PUBLISHED"} else [],
    }
    publication = {
        "state": "PUBLISHED" if through == "PUBLISHED" else "NOT_PUBLISHED",
        "published_at": "2026-01-01T00:00:07Z" if through == "PUBLISHED" else None,
        "outputs": outputs if through == "PUBLISHED" else [],
    }
    return {
        "version": 1,
        "job_id": job_id,
        "module_id": module_id,
        "state": through,
        "module_contract": "contracts/example.yaml",
        "execution_ledger": ledger_path,
        "input_bindings": [],
        "build_provenance": {},
        "blocks": [],
        "outputs": outputs,
        "machine_evidence": [{"kind": "module_check"}] if through in {"MACHINE_VERIFIED", "HUMAN_ACCEPTED", "PUBLISHED"} else [],
        "human_acceptance": human,
        "publication": publication,
    }


def build_root(root: Path) -> None:
    # Exercise the exact repository execution-ledger contract rather than
    # duplicating the assertion policy inside this fixture.
    ledger_contract = yaml.safe_load(
        (REPO_ROOT / "production/contracts/execution-ledger-v1.yaml").read_text(encoding="utf-8")
    )
    assert isinstance(ledger_contract, dict)
    assert ledger_contract.get("execution_assertions")
    dump(root / "production/contracts/execution-ledger-v1.yaml", ledger_contract)
    dump(
        root / "production/contracts/module-registry-v1.yaml",
        {
            "version": 1,
            "allowed_lifecycle": ["ACTIVE", "FROZEN", "DEFERRED", "EXTERNAL", "RETIRED"],
            "modules": {
                "teacher_teaching_demo": {"lifecycle": "ACTIVE"},
                "teacher_structured_interview": {"lifecycle": "FROZEN"},
            },
        },
    )
    dump(root / "CURRENT_STATE.yaml", {"version": 1, "authority": "selftest"})
    (root / "HANDOFF.md").write_text("# selftest handoff\n", encoding="utf-8")
    (root / "outputs").mkdir(parents=True, exist_ok=True)

    pairs = [
        (
            "teacher_teaching_demo",
            "demo-r1",
            "BLOCKS_ACCEPTED",
            False,
        ),
        (
            "teacher_structured_interview",
            "structured-r1",
            "PUBLISHED",
            True,
        ),
    ]
    for module_id, job_id, stage, has_output in pairs:
        job_rel = f"production/artifact-jobs/{module_id}/{job_id}.yaml"
        ledger_rel = f"production/execution-ledgers/{module_id}/{job_id}.yaml"
        dump(root / job_rel, job(job_id, module_id, stage, ledger_rel, output=has_output))
        dump(root / ledger_rel, ledger(job_id, stage, surface=module_id == "teacher_structured_interview"))


def expect_failure(fn, label: str) -> None:
    try:
        fn()
    except Exception:
        return
    raise AssertionError(f"{label}: expected failure")


def main() -> int:
    checks = 0
    with tempfile.TemporaryDirectory(prefix="qz-state-selftest-") as tmp:
        root = Path(tmp)
        build_root(root)

        # 1. Heterogeneous positive: ACTIVE + unrelated FROZEN module, no case special-casing.
        projection = project_repository(root)
        modules = {x["module_id"] for x in projection["state_projection"]["jobs"]}
        assert modules == {"teacher_teaching_demo", "teacher_structured_interview"}
        assert projection["next_action"]["current"] is None
        assert projection["next_action"]["next_action"]["kind"] == "NO_ACTIVE_JOB"
        checks += 1

        # 2. Determinism.
        assert project_repository(root) == project_repository(root)
        checks += 1

        # 3. Committed-view checker positive after generation.
        write_projection(root, projection)
        (root / "HANDOFF.md").write_text(rendered_handoff(root), encoding="utf-8")
        assert check_projection(root) == []
        checks += 1

        # 4. Hand-edited derived view is rejected.
        original_next = (root / "NEXT_ACTION.yaml").read_text(encoding="utf-8")
        (root / "NEXT_ACTION.yaml").write_text(original_next + "# drift\n", encoding="utf-8")
        # YAML comment does not change semantic data, so mutate a value instead.
        next_data = yaml.safe_load((root / "NEXT_ACTION.yaml").read_text(encoding="utf-8"))
        next_data["next_action"]["kind"] = "RUN_GATE"
        dump(root / "NEXT_ACTION.yaml", next_data)
        assert any("NEXT_ACTION.yaml" in error for error in check_projection(root))
        (root / "NEXT_ACTION.yaml").write_text(original_next, encoding="utf-8")
        checks += 1

        demo_ledger_path = root / "production/execution-ledgers/teacher_teaching_demo/demo-r1.yaml"
        baseline = yaml.safe_load(demo_ledger_path.read_text(encoding="utf-8"))

        # 5. seq gap rejected.
        bad = deepcopy(baseline)
        bad["events"][1]["seq"] = 99
        dump(demo_ledger_path, bad)
        expect_failure(lambda: project_repository(root), "seq gap")
        dump(demo_ledger_path, baseline)
        checks += 1

        # 6. lifecycle jump rejected.
        bad = deepcopy(baseline)
        bad["events"][1]["type"] = "BLOCKS_ACCEPTED"
        dump(demo_ledger_path, bad)
        expect_failure(lambda: project_repository(root), "lifecycle jump")
        dump(demo_ledger_path, baseline)
        checks += 1

        # 7. PASS-class execution assertion without execution_surface is rejected.
        bad = deepcopy(baseline)
        bad["events"][-1]["assertion"] = "PASS"
        bad["events"][-1].pop("execution_surface", None)
        dump(demo_ledger_path, bad)
        expect_failure(lambda: project_repository(root), "PASS without execution_surface")
        dump(demo_ledger_path, baseline)
        checks += 1

        # 8. BLOCKED assertion without a non-empty blocked_by list is rejected.
        bad = deepcopy(baseline)
        bad["events"][-1]["assertion"] = "BLOCKED"
        bad["events"][-1].pop("blocked_by", None)
        dump(demo_ledger_path, bad)
        expect_failure(lambda: project_repository(root), "BLOCKED without blocked_by")
        dump(demo_ledger_path, baseline)
        checks += 1

        # 9. Duplicate committed current deliverables for one logical key are rejected.
        catalog_path = root / "outputs/CATALOG.yaml"
        baseline_catalog = yaml.safe_load(catalog_path.read_text(encoding="utf-8"))
        bad_catalog = deepcopy(baseline_catalog)
        current_items = [
            item for item in bad_catalog.get("deliverables", [])
            if isinstance(item, dict) and item.get("current") is True
        ]
        assert len(current_items) == 1
        bad_catalog["deliverables"].append(deepcopy(current_items[0]))
        dump(catalog_path, bad_catalog)
        assert any(
            "duplicate current logical_key" in error
            for error in check_projection(root)
        )
        dump(catalog_path, baseline_catalog)
        checks += 1

        # 10. declared job state must equal ledger projection.
        demo_job_path = root / "production/artifact-jobs/teacher_teaching_demo/demo-r1.yaml"
        baseline_job = yaml.safe_load(demo_job_path.read_text(encoding="utf-8"))
        bad_job = deepcopy(baseline_job)
        bad_job["state"] = "PUBLISHED"
        dump(demo_job_path, bad_job)
        expect_failure(lambda: project_repository(root), "declared/projected mismatch")
        dump(demo_job_path, baseline_job)
        checks += 1

        # 11. Unknown module cannot bypass the canonical module registry.
        bad_job = deepcopy(baseline_job)
        bad_job["module_id"] = "invented_parallel_module"
        dump(demo_job_path, bad_job)
        expect_failure(lambda: project_repository(root), "unknown module")
        dump(demo_job_path, baseline_job)
        checks += 1

    if checks != 11:
        print(f"FAIL: expected 11 checks, got {checks}")
        return 1
    print("SELFTEST OK: 11/11")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
