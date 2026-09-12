#!/usr/bin/env python3
"""P3 consumer reachability around the real canonical accepted-content gate."""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))
sys.path.insert(0, str(REPO_ROOT / "examples"))

import check_teaching_demo_inputs as prebuild  # noqa: E402
import plan_teaching_demo_artifact_job as planner  # noqa: E402
from p3_canonical_accepted_fixture import (  # noqa: E402
    MANIFEST_REL,
    SOURCE_COMMIT,
    WORKSPACE_REL,
    prepare_fixture,
)


class PostAcceptanceReached(RuntimeError):
    pass


def planner_reachability(root: Path, *, accepted: bool) -> None:
    prepare_fixture(root)
    human = root / WORKSPACE_REL / "HUMAN_ACCEPTANCE_RECEIPT.yaml"
    if not accepted:
        human.unlink()

    called = {"post": False}
    original = planner.validate_case

    def post_acceptance_probe(*_args, **_kwargs):
        called["post"] = True
        raise PostAcceptanceReached("planner-post-acceptance")

    planner.validate_case = post_acceptance_probe
    try:
        if accepted:
            try:
                planner.build_plan(MANIFEST_REL, SOURCE_COMMIT, root=root)
            except PostAcceptanceReached:
                pass
            else:
                raise AssertionError(
                    "accepted planner fixture did not reach post-acceptance path"
                )
            if called["post"] is not True:
                raise AssertionError("accepted planner post-acceptance probe not called")
        else:
            try:
                planner.build_plan(MANIFEST_REL, SOURCE_COMMIT, root=root)
            except PostAcceptanceReached as exc:
                raise AssertionError(
                    "rejected planner fixture reached post-acceptance path"
                ) from exc
            except ValueError as exc:
                if "CONTENT_HUMAN_ACCEPTANCE_RECEIPT_MISSING" not in str(exc):
                    raise AssertionError(
                        f"rejected planner failed for wrong reason: {exc}"
                    ) from exc
            else:
                raise AssertionError("rejected planner fixture unexpectedly passed")
            if called["post"]:
                raise AssertionError(
                    "planner post-acceptance probe called for rejected fixture"
                )
    finally:
        planner.validate_case = original


def prebuild_reachability(root: Path, *, accepted: bool) -> None:
    prepare_fixture(root)
    human = root / WORKSPACE_REL / "HUMAN_ACCEPTANCE_RECEIPT.yaml"
    if not accepted:
        human.unlink()

    called = {"post": False}
    original = prebuild.contract_source_roles

    def post_acceptance_probe(_contract):
        called["post"] = True
        raise PostAcceptanceReached("prebuild-post-acceptance")

    prebuild.contract_source_roles = post_acceptance_probe
    try:
        if accepted:
            try:
                prebuild.validate(MANIFEST_REL, root=root, run_font_probe=False)
            except PostAcceptanceReached:
                pass
            else:
                raise AssertionError(
                    "accepted prebuild fixture did not reach post-acceptance path"
                )
            if called["post"] is not True:
                raise AssertionError("accepted prebuild post-acceptance probe not called")
        else:
            errors = prebuild.validate(
                MANIFEST_REL, root=root, run_font_probe=False
            )
            if called["post"]:
                raise AssertionError(
                    "rejected prebuild fixture reached post-acceptance path"
                )
            if not any(
                "PREBUILD_CONTENT_HUMAN_ACCEPTANCE_RECEIPT_MISSING" in item
                for item in errors
            ):
                raise AssertionError(
                    "rejected prebuild did not preserve accepted-content failure: "
                    + repr(errors)
                )
    finally:
        prebuild.contract_source_roles = original


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    base = args.workspace.resolve()
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True)

    planner_reachability(base / "planner-accepted", accepted=True)
    planner_reachability(base / "planner-rejected", accepted=False)
    prebuild_reachability(base / "prebuild-accepted", accepted=True)
    prebuild_reachability(base / "prebuild-rejected", accepted=False)

    print("P3_CONSUMER_REACHABILITY_PASS")
    print("planner_accepted_post_gate: REACHED")
    print("planner_rejected_post_gate: NOT_REACHED")
    print("prebuild_accepted_post_gate: REACHED")
    print("prebuild_rejected_post_gate: NOT_REACHED")
    print("full_artifact_plan_claimed: false")
    print("full_font_prebuild_claimed: false")
    print("product_pdf_generated: false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
