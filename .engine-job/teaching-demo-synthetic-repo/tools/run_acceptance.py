#!/usr/bin/env python3
"""Canonical acceptance runner for Architecture Foundation v1.

Default scope is foundation-only. Teaching Demo `preflight` performs case/readiness
and cheap content/font checks without composing product PDFs. `formal` continues into
build/check/render and still requires HUMAN page review after machine completion.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time

import process_telemetry as telemetry

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION = [
    ("check_project_state.py", []),
    ("check_tooling_routes.py", []),
    ("check_private_actions_boundary.py", []),
    ("provenance_snapshot.py", ["--selftest"]),
    ("init_artifact_job.py", ["--selftest"]),
    ("manage_artifact_job.py", ["--selftest"]),
    ("lock_artifact_input_plan.py", ["--selftest"]),
    ("check_artifact_job.py", ["--selftest"]),
    ("check_artifact_provenance.py", ["--selftest"]),
    ("check_execution_ledger.py", ["--selftest"]),
    ("init_teaching_demo_case.py", ["--selftest"]),
    ("plan_teaching_demo_artifact_job.py", ["--selftest"]),
    ("process_telemetry.py", ["--selftest"]),
    ("check_generalization_architecture.py", []),
]
LEGACY_COMPATIBILITY = [
    ("check_teaching_demo_delivery.py", ["--self-test"]),
    ("check_teaching_demo_efficiency.py", ["--selftest"]),
    ("check_teaching_demo_score.py", ["--selftest"]),
]
TEACHING_DEMO_REGRESSION = [("run_regression_suite.py", []), ("render_regression_suite.py", [])]
TEACHING_DEMO_PREFLIGHT = [
    ("check_teaching_demo_case.py", [], "case_gate"),
    ("check_teaching_demo_inputs.py", [], "prebuild"),
]
TEACHING_DEMO_FORMAL = [
    ("check_teaching_demo_case.py", [], "case_gate"),
    ("build_current_run.py", [], "build_adapter_total"),
    ("check_current_run.py", [], "formal_check"),
    ("render_current_run.py", [], "render"),
]


def run(tool: str, args: list[str] | None = None, *, telemetry_stage: str | None = None) -> None:
    cmd = [sys.executable, str(ROOT / "tools" / tool), *(args or [])]
    print(">>>", " ".join(str(x) for x in cmd), flush=True)
    start = time.perf_counter()
    proc = subprocess.run(cmd, cwd=ROOT)
    duration = time.perf_counter() - start
    if telemetry_stage:
        telemetry.record(telemetry_stage, duration, "PASS" if proc.returncode == 0 else "FAIL", detail=None if proc.returncode == 0 else f"exit={proc.returncode}")
    if proc.returncode:
        raise SystemExit(f"acceptance stage failed: {tool}: exit={proc.returncode}")


def _assert_group_unique(name: str, group) -> None:
    names = [item[0] for item in group]
    if len(names) != len(set(names)):
        raise AssertionError(f"acceptance protocol contains duplicate stages inside {name}")


def selftest() -> None:
    for name, group in (
        ("foundation", FOUNDATION),
        ("legacy", LEGACY_COMPATIBILITY),
        ("regression", TEACHING_DEMO_REGRESSION),
        ("preflight", TEACHING_DEMO_PREFLIGHT),
        ("formal", TEACHING_DEMO_FORMAL),
    ):
        _assert_group_unique(name, group)
    names = {x[0] for x in FOUNDATION + LEGACY_COMPATIBILITY + TEACHING_DEMO_REGRESSION}
    names |= {x[0] for x in TEACHING_DEMO_PREFLIGHT + TEACHING_DEMO_FORMAL}
    for name in names:
        if not (ROOT / "tools" / name).exists():
            raise AssertionError(f"acceptance tool missing: {name}")
    build_text = (ROOT / "tools" / "build_current_run.py").read_text(encoding="utf-8")
    if "validate_teaching_demo_inputs" not in build_text:
        raise AssertionError("Teaching Demo canonical build adapter lost prebuild input gate")
    render_text = (ROOT / "tools" / "render_current_run.py").read_text(encoding="utf-8")
    if "pdf_text_occupancy" not in render_text:
        raise AssertionError("Teaching Demo canonical render adapter lost occupancy gate")
    planner_text = (ROOT / "tools" / "plan_teaching_demo_artifact_job.py").read_text(encoding="utf-8")
    if "source_commit" not in planner_text or "repository_snapshot" not in planner_text or "NO_PRODUCT_PDF_COMPOSITION_PERFORMED" not in planner_text:
        raise AssertionError("Teaching Demo Artifact planner lost durable provenance/no-PDF guarantees")
    locker_text = (ROOT / "tools" / "lock_artifact_input_plan.py").read_text(encoding="utf-8")
    if "validate_snapshot_binding" not in locker_text or "input_plan" not in locker_text:
        raise AssertionError("Artifact input plan locker lost snapshot/hash revalidation")
    live_text = (ROOT / "tools" / "check_artifact_job.py").read_text(encoding="utf-8")
    historical_text = (ROOT / "tools" / "check_artifact_provenance.py").read_text(encoding="utf-8")
    if "mode=\"live\"" not in live_text or "git-history" not in historical_text:
        raise AssertionError("live/historical provenance verification split is missing")


def run_instrumented(stages, *, manifest: str | None, scope: str) -> None:
    telemetry_path = telemetry.path_for_manifest(manifest)
    telemetry.reset(telemetry_path, manifest=manifest, scope=scope)
    os.environ[telemetry.ENV] = str(telemetry_path.relative_to(ROOT))
    overall_start = time.perf_counter()
    try:
        for tool, extra, stage in stages:
            run(tool, extra + (["--manifest", manifest] if manifest else []), telemetry_stage=stage)
    except BaseException:
        telemetry.finish("FAIL", time.perf_counter() - overall_start)
        raise
    telemetry.finish("PASS", time.perf_counter() - overall_start)
    print(f"process_telemetry={telemetry_path.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", choices=["foundation", "legacy", "preflight", "regression", "formal", "full"], default="foundation")
    parser.add_argument("--manifest", default=None)
    args = parser.parse_args()
    selftest()
    for tool, extra in FOUNDATION:
        run(tool, extra)
    if args.scope == "legacy":
        for tool, extra in LEGACY_COMPATIBILITY:
            run(tool, extra)
    if args.scope == "preflight":
        run_instrumented(TEACHING_DEMO_PREFLIGHT, manifest=args.manifest, scope=args.scope)
    if args.scope in {"regression", "full"}:
        for tool, extra in TEACHING_DEMO_REGRESSION:
            run(tool, extra)
    if args.scope in {"formal", "full"}:
        run_instrumented(TEACHING_DEMO_FORMAL, manifest=args.manifest, scope=args.scope)
    print("Selected machine gate: PASS")
    if args.scope == "preflight":
        print("NO_PRODUCT_PDF_COMPOSITION_PERFORMED")
    if args.scope in {"regression", "formal", "full"}:
        print("HUMAN_PIXEL_CONFIRMATION_REQUIRED for any newly rendered final visual artifact.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
