#!/usr/bin/env python3
"""Public-safe P3 orchestration probe for ADR-018.

This fixture does not reproduce a real teaching topic. It exercises the actual
canonical composition and its real planner/prebuild consumers while replacing
the heavy evidence validators with explicit pass/fail probes. The validator
implementations retain their own selftests; this probe answers a different
question: does the sole call graph preserve product evidence requirements while
keeping Phase-B qualification out of ordinary delivery acceptance?
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any, Iterator

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

import check_teaching_demo_content as content_gate  # noqa: E402
import check_teaching_demo_inputs as prebuild  # noqa: E402
import plan_teaching_demo_artifact_job as planner  # noqa: E402


class ReachedPlannerPostAcceptance(RuntimeError):
    pass


@contextmanager
def patched(items: list[tuple[object, str, Any]]) -> Iterator[None]:
    originals: list[tuple[object, str, Any]] = []
    try:
        for obj, name, value in items:
            originals.append((obj, name, getattr(obj, name)))
            setattr(obj, name, value)
        yield
    finally:
        for obj, name, value in reversed(originals):
            setattr(obj, name, value)


def prepare_root(root: Path) -> str:
    workspace = root / "case/workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    contract_src = REPO_ROOT / content_gate.core.CONTRACT_PATH
    contract_dst = root / content_gate.core.CONTRACT_PATH
    contract_dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(contract_src, contract_dst)

    manifest = {
        "content_contract": "teaching-demo-content",
        "case_id": "synthetic-p3-delivery",
        "workspace": "case/workspace",
        "source": {"board": "board.md"},
    }
    manifest_path = root / "case/manifest.yaml"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    (workspace / "board.md").write_text("synthetic board\n", encoding="utf-8")
    (workspace / content_gate.core.BOARD_PLAN).write_text("{}\n", encoding="utf-8")
    work_packet = content_gate.core.ARCH_FILES["work_packet"]
    (workspace / work_packet).write_text(
        yaml.safe_dump({"main_sha": "a" * 40}, sort_keys=False),
        encoding="utf-8",
    )
    (root / "source.pdf").write_bytes(b"%PDF-synthetic-p3\n")
    return manifest_path.relative_to(root).as_posix()


def scenario_patches(root: Path, scenario: str) -> list[tuple[object, str, Any]]:
    def pass_list(*_args: Any, **_kwargs: Any) -> list[str]:
        return []

    def source_lock(_root: Path, _manifest: dict[str, Any]):
        if scenario == "source":
            return {}, root / "source.pdf", ["CONTENT_SOURCE_SYNTHETIC_MISSING"]
        return {"binding_digest": "b" * 64}, root / "source.pdf", []

    def source_review(*_args: Any, **_kwargs: Any) -> list[str]:
        return (
            ["CONTENT_SOURCE_REVIEW_SYNTHETIC_MISSING"]
            if scenario == "source-review"
            else []
        )

    def load_mapping(
        _workspace: Path,
        mapping: dict[str, str],
        _errors: list[str],
        _label: str,
    ) -> dict[str, dict[str, Any]]:
        return {key: {} for key in mapping}

    def semantic(*_args: Any, **_kwargs: Any) -> list[str]:
        return (
            ["CONTENT_SEMANTIC_SYNTHETIC_MISSING"]
            if scenario == "semantic"
            else []
        )

    def freeze(*_args: Any, **_kwargs: Any) -> list[str]:
        return ["CONTENT_FREEZE_SYNTHETIC_MISSING"] if scenario == "freeze" else []

    def independent_review(*_args: Any, **_kwargs: Any) -> list[str]:
        return (
            ["CONTENT_INDEPENDENT_REVIEW_SYNTHETIC_REJECT"]
            if scenario == "review"
            else []
        )

    def human_receipt(*_args: Any, **_kwargs: Any) -> list[str]:
        return (
            ["CONTENT_HUMAN_ACCEPTANCE_RECEIPT_SYNTHETIC_MISSING"]
            if scenario == "receipt"
            else []
        )

    def qualification_must_not_run(*_args: Any, **_kwargs: Any) -> list[str]:
        raise AssertionError(
            "delivery accepted path invoked Phase-B qualification activation"
        )

    return [
        (content_gate, "_validate_phase_b_activation", qualification_must_not_run),
        (content_gate, "_source_lock_binding", source_lock),
        (content_gate, "_validate_source_review", source_review),
        (content_gate, "_legacy_deterministic_scope_adapter", lambda *_a, **_k: ([], {})),
        (content_gate, "_architecture_case_supersession_adapter", pass_list),
        (content_gate, "_validate_machine_gate_state_trace_link", pass_list),
        (content_gate.core, "validate_single_line", pass_list),
        (content_gate.core, "_user_texts", lambda *_a, **_k: {}),
        (content_gate.core, "_load_mapping", load_mapping),
        (content_gate.core, "_selected_reference_receipts", lambda *_a, **_k: []),
        (content_gate.core, "validate_submission_freeze", freeze),
        (content_gate.core, "validate_independent_review", independent_review),
        (content_gate.enforcement, "validate_registry", pass_list),
        (content_gate.enforcement, "validate_source_mode", pass_list),
        (content_gate.enforcement, "validate_reference_candidates", pass_list),
        (content_gate.enforcement, "validate_release_claim_structure", pass_list),
        (content_gate.enforcement, "validate_resource_visibility", pass_list),
        (content_gate.enforcement, "validate_practice_occurrences", pass_list),
        (content_gate.enforcement, "validate_formula_typing", pass_list),
        (content_gate.enforcement, "validate_state_evidence_refs", pass_list),
        (content_gate.enforcement, "validate_machine_receipt_metadata", pass_list),
        (content_gate.enforcement, "validate_release_semantic_verification", semantic),
        (content_gate.enforcement, "validate_board_strict_after_formation", pass_list),
        (
            content_gate.enforcement,
            "validate_resource_reveal_after_verified_formation",
            pass_list,
        ),
        (
            content_gate.enforcement,
            "validate_human_acceptance_receipt",
            human_receipt,
        ),
    ]


def assert_planner_boundary(
    manifest_raw: str,
    root: Path,
    *,
    should_pass_acceptance: bool,
    expected_error: str | None = None,
) -> None:
    def reached(*_args: Any, **_kwargs: Any):
        raise ReachedPlannerPostAcceptance("planner reached validate_case")

    with patched([(planner, "validate_case", reached)]):
        try:
            planner.build_plan(manifest_raw, "a" * 40, root=root)
        except ReachedPlannerPostAcceptance:
            if not should_pass_acceptance:
                raise AssertionError(
                    "planner crossed accepted-content boundary for a negative fixture"
                )
        except ValueError as exc:
            if should_pass_acceptance:
                raise AssertionError(
                    f"planner did not cross accepted-content boundary: {exc}"
                ) from exc
            if expected_error and expected_error not in str(exc):
                raise AssertionError(
                    f"planner rejected for wrong reason: {exc}"
                ) from exc
        else:
            raise AssertionError("planner probe did not reach expected sentinel")


def assert_prebuild_boundary(
    manifest_raw: str,
    root: Path,
    *,
    should_pass: bool,
    expected_error: str | None = None,
) -> None:
    patches = [
        (prebuild.case_gate, "validate", lambda *_a, **_k: []),
        (prebuild.core, "load_product_contract", lambda *_a, **_k: {}),
        (prebuild, "contract_source_roles", lambda *_a, **_k: set()),
        (prebuild, "lint_text", lambda *_a, **_k: []),
    ]
    with patched(patches):
        errors = prebuild.validate(
            manifest_raw,
            root=root,
            run_font_probe=False,
        )
    if should_pass:
        if errors:
            raise AssertionError(f"prebuild rejected accepted fixture: {errors}")
    else:
        if not errors:
            raise AssertionError("prebuild accepted negative fixture")
        if expected_error and not any(expected_error in item for item in errors):
            raise AssertionError(
                f"prebuild rejected for wrong reason: {errors}"
            )


def run_scenario(
    manifest_raw: str,
    root: Path,
    scenario: str,
    *,
    expected_error: str | None,
) -> None:
    positive = scenario == "positive"
    with patched(scenario_patches(root, scenario)):
        errors = content_gate.validate(
            manifest_raw,
            root=root,
            require_independent=True,
        )
        if positive:
            if errors:
                raise AssertionError(
                    f"canonical accepted gate rejected legal fixture: {errors}"
                )
        else:
            if not errors:
                raise AssertionError(
                    f"canonical accepted gate accepted negative fixture: {scenario}"
                )
            if expected_error and not any(expected_error in item for item in errors):
                raise AssertionError(
                    f"canonical accepted gate rejected {scenario} for wrong reason: {errors}"
                )

        assert_planner_boundary(
            manifest_raw,
            root,
            should_pass_acceptance=positive,
            expected_error=expected_error,
        )
        assert_prebuild_boundary(
            manifest_raw,
            root,
            should_pass=positive,
            expected_error=expected_error,
        )


def main() -> int:
    # Import identity is part of the consumer proof: planner/prebuild must use
    # the same canonical content module, not a second acceptance implementation.
    if planner._content is not content_gate:
        raise AssertionError("planner does not consume canonical content gate module")
    if prebuild.content_gate is not content_gate:
        raise AssertionError("prebuild does not consume canonical content gate module")

    with tempfile.TemporaryDirectory(prefix="qz-p3-delivery-") as tmp:
        root = Path(tmp)
        manifest_raw = prepare_root(root)

        # Qualification remains blocked independently before and after delivery
        # acceptance. A forged repository activation still cannot create it.
        q = content_gate._validate_phase_b_activation(root)
        if not q or "CONTROLLER_NOT_IMPLEMENTED" not in q[0]:
            raise AssertionError(f"qualification unexpectedly active: {q}")
        activation = root / content_gate.PHASE_B_ACTIVATION_PATH
        activation.parent.mkdir(parents=True, exist_ok=True)
        activation.write_text(
            "decision: GATE_B_PASS\nreviewer_role: forged\n",
            encoding="utf-8",
        )
        forged = content_gate._validate_phase_b_activation(root)
        if not forged or "REPOSITORY_SELF_ACTIVATION_FORBIDDEN" not in forged[0]:
            raise AssertionError(
                f"forged repository Gate-B activation escaped: {forged}"
            )
        activation.unlink()

        scenarios = [
            ("positive", None),
            ("source", "CONTENT_SOURCE_SYNTHETIC_MISSING"),
            ("source-review", "CONTENT_SOURCE_REVIEW_SYNTHETIC_MISSING"),
            ("semantic", "CONTENT_SEMANTIC_SYNTHETIC_MISSING"),
            ("freeze", "CONTENT_FREEZE_SYNTHETIC_MISSING"),
            ("review", "CONTENT_INDEPENDENT_REVIEW_SYNTHETIC_REJECT"),
            ("receipt", "CONTENT_HUMAN_ACCEPTANCE_RECEIPT_SYNTHETIC_MISSING"),
        ]
        for scenario, expected in scenarios:
            run_scenario(
                manifest_raw,
                root,
                scenario,
                expected_error=expected,
            )

        # The configuration-level contract must agree with the runtime behavior.
        contract = yaml.safe_load(
            (root / content_gate.core.CONTRACT_PATH).read_text(encoding="utf-8")
        )
        architecture = contract.get("architecture_contract") or {}
        if architecture.get(
            "delivery_accepted_mode_requires_phase_b_qualification"
        ) is not False:
            raise AssertionError("contract still couples delivery to qualification")
        if architecture.get(
            "phase_b_controller_required_for_calibrated_claim"
        ) is not True:
            raise AssertionError("contract lost Phase-B calibrated-claim boundary")

    print("P3_DELIVERY_ACCEPTANCE_PROBE_PASS: 7/7 scenarios")
    print("P3_PLANNER_ACCEPTED_BOUNDARY_PASS")
    print("P3_PREBUILD_ACCEPTED_BOUNDARY_PASS")
    print("P3_QUALIFICATION_REMAINS_BLOCKED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
