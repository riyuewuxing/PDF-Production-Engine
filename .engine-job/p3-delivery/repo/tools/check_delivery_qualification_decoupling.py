#!/usr/bin/env python3
"""Guard the P3 separation between product delivery and process qualification."""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from artifact_foundation import ROOT, load_yaml

STATUS = Path("production/process/teaching-demo-content/STATUS.yaml")
ARTIFACT_CONTRACT = Path("production/contracts/artifact-job-v1.yaml")
QUALIFICATION_CONTRACT = Path("production/contracts/system-qualification-v1.yaml")
LEGACY_DELIVERY_CONTRACT = Path("production/contracts/teaching-demo-delivery-state-machine-v1.yaml")
ENGINE_HANDOFF = Path("contracts/engine-handoff.yaml")
RESOURCE_POLICY = Path("production/resource-build-efficiency-policy-v1.yaml")
RESOURCE_CHECKLIST = Path("production/resource-build-operation-checklist-v1.yaml")

DEPENDENCY_KEYS = {
    "requires",
    "prerequisites",
    "depends_on",
    "blocked_by",
    "unlock_requires",
    "required_gates",
}
QUALIFICATION_TOKENS = ("calibrated_claim", "gate_b", "qualification")


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(_strings(item))
        return out
    if isinstance(value, dict):
        out = []
        for key, item in value.items():
            out.append(str(key))
            out.extend(_strings(item))
        return out
    return []


def _formal_pdf_dependency_errors(node: Any, path: tuple[str, ...] = ()) -> list[str]:
    errors: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            current = path + (str(key),)
            in_formal_pdf_rule = any(part == "formal_pdf" for part in current)
            if in_formal_pdf_rule and str(key) in DEPENDENCY_KEYS:
                lowered = " ".join(_strings(value)).lower()
                for token in QUALIFICATION_TOKENS:
                    if token in lowered:
                        errors.append(
                            f"delivery/qualification coupling forbidden at {'.'.join(current)}: {token}"
                        )
            errors.extend(_formal_pdf_dependency_errors(value, current))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            errors.extend(_formal_pdf_dependency_errors(value, path + (str(index),)))
    return errors


def _authority_policy_errors(
    engine_handoff: dict[str, Any],
    resource_policy: dict[str, Any],
    resource_checklist: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    handoff_unlock = engine_handoff.get("unlock_policy")
    if not isinstance(handoff_unlock, dict):
        errors.append("engine handoff unlock_policy mapping missing")
    else:
        if handoff_unlock.get("formal_pdf") != "bounded_release":
            errors.append("engine handoff formal_pdf unlock policy must be bounded_release")
        if handoff_unlock.get("phase_b") != "independent_evidence_line":
            errors.append("engine handoff phase_b must remain an independent evidence line")

    policy_qualification = resource_policy.get("system_qualification")
    if not isinstance(policy_qualification, dict) or policy_qualification.get("separate_from_delivery") is not True:
        errors.append("resource build efficiency policy must keep system qualification separate from delivery")

    publication = resource_checklist.get("publication")
    if not isinstance(publication, dict) or publication.get("system_qualification_required") is not False:
        errors.append("resource build checklist must not require system qualification for publication")
    return errors


def validate(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    status = load_yaml(root / STATUS)
    artifact = load_yaml(root / ARTIFACT_CONTRACT)
    qualification_contract = load_yaml(root / QUALIFICATION_CONTRACT)
    legacy_delivery = load_yaml(root / LEGACY_DELIVERY_CONTRACT)
    engine_handoff = load_yaml(root / ENGINE_HANDOFF)
    resource_policy = load_yaml(root / RESOURCE_POLICY)
    resource_checklist = load_yaml(root / RESOURCE_CHECKLIST)

    delivery = status.get("delivery")
    qualification = status.get("qualification")
    unlock = status.get("unlock_policy")
    if not isinstance(delivery, dict):
        errors.append("STATUS.delivery mapping missing")
        return errors
    if not isinstance(qualification, dict):
        errors.append("STATUS.qualification mapping missing")
        return errors
    if not isinstance(unlock, dict):
        errors.append("STATUS.unlock_policy mapping missing")
        return errors

    formal = delivery.get("formal_pdf")
    if not isinstance(formal, dict):
        errors.append("STATUS.delivery.formal_pdf mapping missing")
    else:
        if formal.get("policy") != "bounded_release":
            errors.append("delivery.formal_pdf.policy must be bounded_release")
        required = formal.get("requires")
        expected = {
            "accepted_content",
            "source_provenance",
            "stable_engine_anchor",
            "machine_verification",
            "final_render",
            "full_page_human_acceptance",
        }
        if not isinstance(required, list) or not expected.issubset(set(required)):
            errors.append("delivery.formal_pdf.requires lost mandatory delivery evidence")
        if formal.get("qualification_prerequisites") != []:
            errors.append("delivery.formal_pdf.qualification_prerequisites must be empty")
        if formal.get("state") not in {"BLOCKED", "READY", "REVIEW_REQUIRED", "ACCEPTED"}:
            errors.append("delivery.formal_pdf.state is invalid")

    legacy = status.get("protected_downstream")
    if not isinstance(legacy, dict):
        errors.append("STATUS.protected_downstream compatibility mirror missing")
    else:
        if legacy.get("compatibility_mirror") is not True:
            errors.append("protected_downstream must be marked compatibility_mirror=true")
        if legacy.get("authoritative_delivery_state") != "delivery.formal_pdf":
            errors.append("protected_downstream must point delivery authority to delivery.formal_pdf")
        if legacy.get("authoritative_qualification_state") != "qualification.calibrated_claim":
            errors.append("protected_downstream must point qualification authority to qualification.calibrated_claim")
        if legacy.get("cross_lane_prerequisite_authority") is not False:
            errors.append("protected_downstream must not act as cross-lane prerequisite authority")

    calibrated = qualification.get("calibrated_claim")
    if not isinstance(calibrated, dict):
        errors.append("STATUS.qualification.calibrated_claim mapping missing")
    else:
        if calibrated.get("gate") != "INDEPENDENT_GATE_B":
            errors.append("qualification.calibrated_claim.gate must be INDEPENDENT_GATE_B")
        if calibrated.get("affects_delivery") is not False:
            errors.append("qualification.calibrated_claim.affects_delivery must be false")

    if unlock.get("formal_pdf") != "bounded_release":
        errors.append("unlock_policy.formal_pdf must be bounded_release")
    if unlock.get("calibrated_claim") != "independent_gate_b_only":
        errors.append("unlock_policy.calibrated_claim must be independent_gate_b_only")

    artifact_qualification = artifact.get("qualification")
    if not isinstance(artifact_qualification, dict):
        errors.append("artifact contract qualification mapping missing")
    else:
        if artifact_qualification.get("part_of_delivery_state_machine") is not False:
            errors.append("artifact contract must keep qualification outside delivery state machine")
        if artifact_qualification.get("contract") != QUALIFICATION_CONTRACT.as_posix():
            errors.append("artifact contract qualification authority drift")

    if qualification_contract.get("separate_from_delivery") is not True:
        errors.append("system qualification contract must declare separate_from_delivery=true")
    rule = str(qualification_contract.get("rule") or "").lower()
    if "never invalidates" not in rule or "delivery" not in rule:
        errors.append("system qualification rule must preserve accepted delivery artifacts")

    closure = legacy_delivery.get("final_closure_qualification")
    if not isinstance(closure, dict) or closure.get("lane") != "independent":
        errors.append("legacy delivery contract qualification lane must remain independent")

    errors.extend(_authority_policy_errors(engine_handoff, resource_policy, resource_checklist))

    # Current structured authorities must not smuggle qualification into a
    # formal_pdf dependency edge. Historical review/evidence files are excluded.
    for label, value in (
        (STATUS.as_posix(), status),
        (ARTIFACT_CONTRACT.as_posix(), artifact),
        (QUALIFICATION_CONTRACT.as_posix(), qualification_contract),
        (LEGACY_DELIVERY_CONTRACT.as_posix(), legacy_delivery),
        (ENGINE_HANDOFF.as_posix(), engine_handoff),
        (RESOURCE_POLICY.as_posix(), resource_policy),
        (RESOURCE_CHECKLIST.as_posix(), resource_checklist),
    ):
        for item in _formal_pdf_dependency_errors(value):
            errors.append(f"{label}: {item}")

    return errors


def selftest() -> None:
    good = {
        "delivery": {
            "formal_pdf": {
                "requires": ["machine_verification", "full_page_human_acceptance"],
                "qualification_prerequisites": [],
            }
        }
    }
    if _formal_pdf_dependency_errors(good):
        raise AssertionError("decoupled delivery rule rejected")
    bad = {
        "delivery": {
            "formal_pdf": {
                "requires": ["machine_verification", "calibrated_claim"],
            }
        }
    }
    found = _formal_pdf_dependency_errors(bad)
    if not any("calibrated_claim" in item for item in found):
        raise AssertionError("calibrated_claim prerequisite escaped")
    bad2 = {
        "formal_pdf": {
            "blocked_by": ["GATE_B_NOT_COMPLETE"],
        }
    }
    found = _formal_pdf_dependency_errors(bad2)
    if not any("gate_b" in item for item in found):
        raise AssertionError("Gate B blocker escaped")

    good_policy = _authority_policy_errors(
        {"unlock_policy": {"formal_pdf": "bounded_release", "phase_b": "independent_evidence_line"}},
        {"system_qualification": {"separate_from_delivery": True}},
        {"publication": {"system_qualification_required": False}},
    )
    if good_policy:
        raise AssertionError(f"decoupled authority policy rejected: {good_policy}")

    bad_policy = _authority_policy_errors(
        {"unlock_policy": {"formal_pdf": "gate_b_required", "phase_b": "delivery_prerequisite"}},
        {"system_qualification": {"separate_from_delivery": False}},
        {"publication": {"system_qualification_required": True}},
    )
    if len(bad_policy) != 4:
        raise AssertionError(f"coupled authority policy escaped: {bad_policy}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        selftest()
    errors = validate(args.root.resolve())
    if errors:
        print("FAIL: delivery/qualification decoupling")
        for error in errors:
            print(f"- {error}")
        return 1
    print("PASS: delivery/qualification decoupling")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
