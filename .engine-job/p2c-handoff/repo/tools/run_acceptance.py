#!/usr/bin/env python3
"""Canonical acceptance runner for Architecture Foundation v1.

Default scope is foundation-only. Teaching Demo `preflight` performs case/readiness
and cheap content/font checks without composing product PDFs. `phase-b` runs the
adversarial semantic/provenance eval harness without opening accepted mode.
`formal` continues into build/check/render and still requires HUMAN page review
after machine completion. Protected-route selftests attack both producer and
consumer bypasses; they are not a substitute for exact-repository runtime evidence.
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
    ("build_packager.py", ["self-test"]),
    ("handoff.py", ["self-test"]),
    ("check_delivery_qualification_decoupling.py", ["--self-test"]),
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
PHASE_B_EVAL = [("check_teaching_demo_phase_b_eval.py", ["--selftest"])]
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


def _assert_cli_entrypoint(tool: str) -> None:
    """Reject facade scripts that import correctly but silently exit 0 as a CLI."""
    path = ROOT / "tools" / tool
    text = path.read_text(encoding="utf-8")
    if 'if __name__ == "__main__":' not in text or "raise SystemExit(main())" not in text:
        raise AssertionError(f"acceptance CLI facade lost executable main entrypoint: {tool}")


def _artifact_transaction_precommit_selftest() -> None:
    """A verifier rejection must occur before any canonical job/ledger write."""
    import manage_artifact_job as manager

    original_ledger = manager.validate_ledger
    original_candidate = manager.validate_job_candidate
    original_write = manager._write_yaml
    writes: list[Path] = []

    def write_trap(path: Path, _data: dict) -> None:
        writes.append(path)
        raise AssertionError(f"canonical mutation reached before candidate gate: {path}")

    try:
        manager.validate_ledger = lambda *_args, **_kwargs: []
        manager.validate_job_candidate = lambda *_args, **_kwargs: ["SYNTHETIC_PRECOMMIT_REJECT"]
        manager._write_yaml = write_trap

        try:
            manager._transaction(
                ROOT,
                ROOT / "synthetic-job.yaml",
                {},
                {},
                ROOT / "synthetic-ledger.yaml",
                {},
                {},
            )
        except ValueError as exc:
            if "SYNTHETIC_PRECOMMIT_REJECT" not in str(exc):
                raise AssertionError(f"pair transaction failed for wrong reason: {exc}") from exc
        else:
            raise AssertionError("pair transaction escaped failing precommit validator")
        if writes:
            raise AssertionError(f"pair transaction mutated canonical state before gate: {writes}")

        try:
            manager._ledger_transaction(
                ROOT,
                {},
                ROOT / "synthetic-ledger.yaml",
                {},
                {},
            )
        except ValueError as exc:
            if "SYNTHETIC_PRECOMMIT_REJECT" not in str(exc):
                raise AssertionError(f"ledger-only transaction failed for wrong reason: {exc}") from exc
        else:
            raise AssertionError("ledger-only transaction escaped failing precommit validator")
        if writes:
            raise AssertionError(f"ledger-only transaction mutated canonical state before gate: {writes}")
    finally:
        manager.validate_ledger = original_ledger
        manager.validate_job_candidate = original_candidate
        manager._write_yaml = original_write


def _module_input_lock_dispatch_selftest() -> None:
    """Prove a declared module verifier is unavoidable at the live Artifact checker."""
    import tempfile

    import yaml

    import check_artifact_job as artifact_gate
    from artifact_foundation import sha256_file

    states = ("JOB_CREATED", "INPUTS_LOCKED")
    framework = {
        "module_input_lock_verification": {
            "allowed_modes": ["canonical-plan-reconstruction-v1"],
        }
    }
    with tempfile.TemporaryDirectory(prefix="qz-lock-consumer-") as tmp:
        root = Path(tmp)
        (root / "content").mkdir()
        (root / "tools").mkdir()
        (root / "plans").mkdir()
        contract = root / "content/module.yaml"
        verifier = root / "tools/verifier.py"
        plan = root / "plans/plan.yaml"
        verifier.write_text(
            "def verify_live_job_input_plan(*, root, job, plan_binding):\n"
            "    return ['SYNTHETIC_CONSUMER_LOCK']\n",
            encoding="utf-8",
        )
        plan.write_text("version: 1\n", encoding="utf-8")
        contract.write_text(
            yaml.safe_dump(
                {
                    "artifact_job_profile": {
                        "input_lock_verification": {
                            "mode": "canonical-plan-reconstruction-v1",
                            "required_from_state": "INPUTS_LOCKED",
                            "input_plan_binding_kind": "input_plan",
                            "verifier": {
                                "path": "tools/verifier.py",
                                "function": "verify_live_job_input_plan",
                                "binding_kind": "input_plan_live_verifier",
                            },
                        }
                    }
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        plan_binding = {
            "path": "plans/plan.yaml",
            "sha256": sha256_file(plan),
            "kind": "input_plan",
        }
        verifier_binding = {
            "path": "tools/verifier.py",
            "sha256": sha256_file(verifier),
            "kind": "input_plan_live_verifier",
        }
        job = {
            "module_contract": "content/module.yaml",
            "input_bindings": [plan_binding, verifier_binding],
        }
        found = artifact_gate._module_input_lock_verification_errors(
            job, root, framework, states, 1
        )
        if not any("SYNTHETIC_CONSUMER_LOCK" in error for error in found):
            raise AssertionError(f"module input-lock verifier result escaped live gate: {found}")

        no_plan = dict(job)
        no_plan["input_bindings"] = [verifier_binding]
        found = artifact_gate._module_input_lock_verification_errors(
            no_plan, root, framework, states, 1
        )
        if not any("requires exactly one 'input_plan' binding" in error for error in found):
            raise AssertionError(f"direct generic lock without plan escaped: {found}")

    _artifact_transaction_precommit_selftest()


def _formal_render_lock_selftest() -> None:
    """Attack the formal renderer through its import-level complete function."""
    import render_current_run as renderer

    original_gate = renderer.validate_teaching_demo_inputs
    original_load = renderer.load_cfg
    original_selftest = renderer.selftest
    original_rmtree = renderer.shutil.rmtree
    original_render_pdf = renderer.render_pdf
    touched = {"mutation": False}

    class TrapRenderDir:
        def exists(self):
            touched["mutation"] = True
            raise AssertionError("formal render directory inspected before accepted-content gate")

        def mkdir(self, *args, **kwargs):
            touched["mutation"] = True
            raise AssertionError("formal render directory created before accepted-content gate")

    def forbidden_mutation(*args, **kwargs):
        touched["mutation"] = True
        raise AssertionError("formal render mutation reached while accepted content was locked")

    try:
        renderer.selftest = lambda: None
        renderer.load_cfg = lambda _raw=None: (
            ROOT / "synthetic-render-lock.yaml",
            {},
            ROOT / "outputs/current-run",
            TrapRenderDir(),
        )
        renderer.validate_teaching_demo_inputs = (
            lambda *_args, **_kwargs: ["SYNTHETIC_ACCEPTED_CONTENT_LOCK"]
        )
        renderer.shutil.rmtree = forbidden_mutation
        renderer.render_pdf = forbidden_mutation
        try:
            renderer.render_product("synthetic-render-lock.yaml")
        except SystemExit as exc:
            if "formal render input gate failed before QA render" not in str(exc):
                raise AssertionError(f"canonical formal renderer failed for wrong reason: {exc}") from exc
        else:
            raise AssertionError("canonical formal renderer import escaped accepted-content lock")
        if touched["mutation"]:
            raise AssertionError("formal render touched QA output before accepted-content PASS")
    finally:
        renderer.validate_teaching_demo_inputs = original_gate
        renderer.load_cfg = original_load
        renderer.selftest = original_selftest
        renderer.shutil.rmtree = original_rmtree
        renderer.render_pdf = original_render_pdf


def _protected_route_selftest() -> None:
    """Attack ADR-015/016 protected operations through import and consumer bypasses."""
    import build_current_run as builder
    import plan_teaching_demo_artifact_job as planner
    import publisher_core as publisher
    import publisher_core_legacy as publisher_legacy
    import verify_teaching_demo_artifact_plan as plan_verifier

    for module, label in ((publisher, "publisher_core"), (publisher_legacy, "publisher_core_legacy")):
        if hasattr(module, "main"):
            raise AssertionError(f"protected publisher library regained complete main: {label}")
    for forbidden in ("build_plan", "write_content_addressed_plan", "main"):
        if hasattr(plan_verifier, forbidden):
            raise AssertionError(f"plan consumer verifier leaked protected producer symbol: {forbidden}")
    plan_verifier.selftest()
    if (ROOT / "tools/plan_teaching_demo_artifact_job_legacy.py").exists():
        raise AssertionError("legacy complete Artifact planner route reappeared")
    if (ROOT / "tools/teaching_demo_process_eval_core.py").exists():
        raise AssertionError("duplicate process-evaluation complete entry reappeared")

    original_build_gate = builder.validate_teaching_demo_inputs
    original_record = builder.telemetry.record
    original_clean = publisher.clean_outputs
    build_side_effect = {"reached": False}

    def forbidden_clean_outputs():
        build_side_effect["reached"] = True
        raise AssertionError("product output cleanup reached while accepted content was locked")

    try:
        builder.validate_teaching_demo_inputs = lambda *_args, **_kwargs: ["SYNTHETIC_ACCEPTED_CONTENT_LOCK"]
        builder.telemetry.record = lambda *_args, **_kwargs: None
        publisher.clean_outputs = forbidden_clean_outputs
        try:
            builder.build_product("synthetic-does-not-need-to-exist.yaml")
        except SystemExit as exc:
            if "prebuild input gate failed before composition" not in str(exc):
                raise AssertionError(f"canonical builder failed for the wrong reason: {exc}") from exc
        else:
            raise AssertionError("canonical builder import escaped accepted-content lock")
        if build_side_effect["reached"]:
            raise AssertionError("canonical builder touched product output before accepted-content PASS")
    finally:
        builder.validate_teaching_demo_inputs = original_build_gate
        builder.telemetry.record = original_record
        publisher.clean_outputs = original_clean

    original_content_gate = planner._content.validate
    original_snapshot_write = planner.write_snapshot
    plan_side_effect = {"reached": False}

    def forbidden_snapshot_write(*_args, **_kwargs):
        plan_side_effect["reached"] = True
        raise AssertionError("Artifact snapshot write reached while accepted content was locked")

    try:
        planner._content.validate = lambda *_args, **_kwargs: ["SYNTHETIC_ACCEPTED_CONTENT_LOCK"]
        planner.write_snapshot = forbidden_snapshot_write
        try:
            planner.build_plan("synthetic-does-not-need-to-exist.yaml", "0" * 40, root=ROOT)
        except ValueError as exc:
            if "canonical content is not independently accepted" not in str(exc):
                raise AssertionError(f"canonical planner failed for the wrong reason: {exc}") from exc
        else:
            raise AssertionError("canonical planner import escaped accepted-content lock")

        try:
            planner.write_content_addressed_plan(
                {"manifest": "synthetic-does-not-need-to-exist.yaml", "source_commit": "0" * 40},
                root=ROOT,
            )
        except ValueError as exc:
            if "canonical content is not independently accepted" not in str(exc):
                raise AssertionError(f"canonical plan writer failed for the wrong reason: {exc}") from exc
        else:
            raise AssertionError("canonical plan writer import escaped accepted-content lock")
        if plan_side_effect["reached"]:
            raise AssertionError("canonical planner wrote downstream state before accepted-content PASS")
    finally:
        planner._content.validate = original_content_gate
        planner.write_snapshot = original_snapshot_write

    _module_input_lock_dispatch_selftest()
    _formal_render_lock_selftest()


def selftest(scope: str | None = None) -> None:
    groups = (
        ("foundation", FOUNDATION),
        ("legacy", LEGACY_COMPATIBILITY),
        ("regression", TEACHING_DEMO_REGRESSION),
        ("phase-b", PHASE_B_EVAL),
        ("preflight", TEACHING_DEMO_PREFLIGHT),
        ("formal", TEACHING_DEMO_FORMAL),
    )
    for name, group in groups:
        _assert_group_unique(name, group)

    _protected_route_selftest()

    required: set[str] = set()
    if scope in (None, "foundation", "full", "legacy", "regression"):
        required |= {x[0] for x in FOUNDATION}
    if scope in (None, "legacy"):
        required |= {x[0] for x in LEGACY_COMPATIBILITY}
    if scope in (None, "regression", "full"):
        required |= {x[0] for x in TEACHING_DEMO_REGRESSION}
    if scope in (None, "phase-b"):
        required |= {x[0] for x in PHASE_B_EVAL}
    if scope in (None, "preflight"):
        required |= {x[0] for x in TEACHING_DEMO_PREFLIGHT}
    if scope in (None, "formal", "full"):
        required |= {x[0] for x in TEACHING_DEMO_FORMAL}
    for name in required:
        if not (ROOT / "tools" / name).exists():
            raise AssertionError(f"acceptance tool missing for scope={scope}: {name}")

    if scope in (None, "foundation", "full", "legacy", "regression"):
        _assert_cli_entrypoint("plan_teaching_demo_artifact_job.py")
        _assert_cli_entrypoint("check_teaching_demo_process_evaluation.py")
    if scope in (None, "phase-b"):
        _assert_cli_entrypoint("check_teaching_demo_phase_b_eval.py")
        provenance_text = (ROOT / "tools/verify_teaching_demo_semantic_provenance.py").read_text(encoding="utf-8")
        if 'if __name__ == "__main__":' in provenance_text:
            raise AssertionError("Phase-B semantic provenance verifier must remain library-only")
        if "verify_controller_receipt" not in provenance_text or "HMAC-SHA256" not in provenance_text:
            raise AssertionError("Phase-B semantic provenance verifier contract missing")
    if scope in (None, "preflight", "formal", "full"):
        _assert_cli_entrypoint("check_teaching_demo_inputs.py")
        _assert_cli_entrypoint("build_current_run.py")
        _assert_cli_entrypoint("render_current_run.py")
        build_text = (ROOT / "tools/build_current_run.py").read_text(encoding="utf-8")
        if "validate_teaching_demo_inputs" not in build_text:
            raise AssertionError("Teaching Demo canonical build adapter lost prebuild input gate")
        render_text = (ROOT / "tools/render_current_run.py").read_text(encoding="utf-8")
        if "pdf_text_occupancy" not in render_text or "validate_teaching_demo_inputs" not in render_text:
            raise AssertionError("Teaching Demo canonical render adapter lost occupancy/accepted-content gate")

    if scope in (None, "foundation", "full"):
        planner_text = (ROOT / "tools/plan_teaching_demo_artifact_job.py").read_text(encoding="utf-8")
        for token in (
            "source_commit",
            "repository_snapshot",
            "content_acceptance_capsule",
            "human_acceptance_receipt",
            "NO_PRODUCT_PDF_COMPOSITION_PERFORMED",
        ):
            if token not in planner_text:
                raise AssertionError(f"Teaching Demo Artifact planner lost required provenance token: {token}")
        locker_text = (ROOT / "tools/lock_artifact_input_plan.py").read_text(encoding="utf-8")
        if "validate_snapshot_binding" not in locker_text or "input_plan" not in locker_text:
            raise AssertionError("Artifact input plan locker lost snapshot/hash revalidation")
        live_text = (ROOT / "tools/check_artifact_job.py").read_text(encoding="utf-8")
        historical_text = (ROOT / "tools/check_artifact_provenance.py").read_text(encoding="utf-8")
        if "mode=\"live\"" not in live_text or "git-history" not in historical_text:
            raise AssertionError("live/historical provenance verification split is missing")
        if "_module_input_lock_verification_errors" not in live_text or "_validate_transaction_candidate" not in live_text:
            raise AssertionError("live Artifact checker lost consumer/precommit verification path")


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
    parser.add_argument(
        "--scope",
        choices=["foundation", "legacy", "phase-b", "preflight", "regression", "formal", "full"],
        default="foundation",
    )
    parser.add_argument("--manifest", default=None)
    parser.add_argument(
        "--phase-b-live-result",
        action="store_true",
        help="For --scope phase-b only, also verify the canonical external trusted semantic execution result.",
    )
    args = parser.parse_args()
    if args.phase_b_live_result and args.scope != "phase-b":
        parser.error("--phase-b-live-result requires --scope phase-b")
    selftest(args.scope)
    # Artifact preflight/formal are intentionally runnable from a minimal, hash-bound
    # execution package. Repository-wide foundation gates run in foundation/full (and
    # before legacy/regression), not as hidden prerequisites of every artifact build.
    if args.scope in {"foundation", "full", "legacy", "regression"}:
        for tool, extra in FOUNDATION:
            run(tool, extra)
    if args.scope == "legacy":
        for tool, extra in LEGACY_COMPATIBILITY:
            run(tool, extra)
    if args.scope == "phase-b":
        for tool, extra in PHASE_B_EVAL:
            run(tool, extra)
        if args.phase_b_live_result:
            run("check_teaching_demo_phase_b_eval.py", ["--verify-live-result"])
    if args.scope == "preflight":
        run_instrumented(TEACHING_DEMO_PREFLIGHT, manifest=args.manifest, scope=args.scope)
    if args.scope in {"regression", "full"}:
        for tool, extra in TEACHING_DEMO_REGRESSION:
            run(tool, extra)
    if args.scope in {"formal", "full"}:
        run_instrumented(TEACHING_DEMO_FORMAL, manifest=args.manifest, scope=args.scope)
    print("Selected machine gate: PASS")
    if args.scope == "phase-b":
        print("PHASE_B_EVAL_ONLY_GATE_B_NOT_AUTHORIZED")
        print("ACCEPTED_MODE_REMAINS_FAIL_CLOSED")
    if args.scope == "preflight":
        print("NO_PRODUCT_PDF_COMPOSITION_PERFORMED")
    if args.scope in {"regression", "formal", "full"}:
        print("HUMAN_PIXEL_CONFIRMATION_REQUIRED for any newly rendered final visual artifact.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
