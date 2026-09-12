"""Executable Phase-A enforcement primitives for Teaching Demo Content.

Library only; no CLI and no aggregate acceptance function. The contract is the
requirement authority. This module binds every MACHINE_DETERMINISTIC/HARD
requirement to an executable primitive runner, stable failure family, negative
probe identity, and lifecycle stage.

Release claims remain unverified until visible-span structure and the blocking
Science/Evidence Judge establish them. RRA4 additionally makes answer-bearing
full exposure explicit: discovery/scaffold resources may never use
``RESOURCE_SHOW visibility: FULL`` anywhere in the event stream; the first full
exposure across all resource events must be a ``RESOURCE_REVEAL`` strictly after
verified formation.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import tempfile
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
REFERENCE_ROOT_REL = Path(
    "production/reference-materials/teacher_teaching_demo/"
    "purchased-transcript-selection-2026-08-27"
)

ENFORCEMENT_SPECS: dict[str, dict[str, str]] = {
    "REQ-SRC-ID-001": {
        "validator_id": "exact_repository_source_identity",
        "failure_code": "CONTENT_SOURCE_EVIDENCE_UNVERIFIED",
        "probe_id": "P0_SOURCE_IDENTITY_FORGERY",
        "stage": "SOURCE_LOCKED",
        "runner": "checker:_source_lock_binding",
    },
    "REQ-INT-001": {
        "validator_id": "actual_interaction_chain",
        "failure_code": "CONTENT_ACTUAL_INTERACTION_CHAIN_INCOMPLETE",
        "probe_id": "F1_INTERACTION_CHAIN",
        "stage": "MACHINE_GATED",
        "runner": "core:validate_architecture_case",
    },
    "REQ-REL-002": {
        "validator_id": "visible_span_release_claim_structure",
        "failure_code": "CONTENT_RELEASE_VISIBLE_SPAN_BINDING_INVALID",
        "probe_id": "GATEA_P1_BARE_FALSE_EARLY_RELEASE_METADATA",
        "stage": "MACHINE_GATED",
        "runner": "local:validate_release_claim_structure",
    },
    "REQ-RES-001": {
        "validator_id": "actual_resource_show",
        "failure_code": "CONTENT_ACTUAL_RESOURCE_NOT_SHOWN",
        "probe_id": "M05_RESOURCE_NOT_SHOWN",
        "stage": "MACHINE_GATED",
        "runner": "core:validate_architecture_case",
    },
    "REQ-RES-002": {
        "validator_id": "answer_resource_visibility_state",
        "failure_code": "CONTENT_ACTUAL_ANSWER_RESOURCE_PREMATURE",
        "probe_id": "GATEA_RRA3_P1_05_FULL_SHOW_BYPASS",
        "stage": "MACHINE_GATED",
        "runner": "local:validate_resource_visibility",
    },
    "REQ-RES-004": {
        "validator_id": "answer_resource_first_full_exposure_after_verified_formation",
        "failure_code": "CONTENT_ANSWER_RESOURCE_REVEAL_BEFORE_VERIFIED_FORMATION",
        "probe_id": "GATEA_RRA3_P1_05_FIRST_FULL_EXPOSURE",
        "stage": "SEMANTIC_JUDGED",
        "runner": "local:validate_resource_reveal_after_verified_formation",
    },
    "REQ-BRD-001": {
        "validator_id": "actual_board_lineage",
        "failure_code": "CONTENT_ACTUAL_FINAL_BOARD_NOT_EVENT_ACCUMULATION",
        "probe_id": "M07_BOARD_LINEAGE",
        "stage": "MACHINE_GATED",
        "runner": "core:validate_architecture_case",
    },
    "REQ-BRD-002": {
        "validator_id": "strict_board_after_verified_formation",
        "failure_code": "CONTENT_ACTUAL_BOARD_BEFORE_FORMATION",
        "probe_id": "GATEA_P1_FALSE_RELEASE_BOARD_CAUSALITY",
        "stage": "SEMANTIC_JUDGED",
        "runner": "local:validate_board_strict_after_formation",
    },
    "REQ-PRC-001": {
        "validator_id": "practice_scope_occurrence_and_text_binding",
        "failure_code": "CONTENT_ACTUAL_PRACTICE_INVENTORY_DRIFT",
        "probe_id": "M11_M12_PRACTICE_SCOPE_OCCURRENCE",
        "stage": "MACHINE_GATED",
        "runner": "local:validate_practice_occurrences",
    },
    "REQ-TIM-001": {
        "validator_id": "final_spoken_coverage",
        "failure_code": "CONTENT_ACTUAL_SPOKEN_COVERAGE_NOT_COMPLETE",
        "probe_id": "R2_TIMING_SUMMARY_SUBSTITUTION",
        "stage": "MACHINE_GATED",
        "runner": "core:validate_architecture_case",
    },
    "REQ-TIM-002": {
        "validator_id": "formula_like_text_must_be_oralize_event",
        "failure_code": "CONTENT_ACTUAL_FORMULA_ORALIZATION_MISSING",
        "probe_id": "M10_UNTYPED_FORMULA",
        "stage": "MACHINE_GATED",
        "runner": "local:validate_formula_typing",
    },
    "REQ-TIM-003": {
        "validator_id": "event_timing_recompute",
        "failure_code": "CONTENT_ACTUAL_TIMING_NOT_RECOMPUTABLE",
        "probe_id": "R2_TIMING_EXECUTABILITY",
        "stage": "MACHINE_GATED",
        "runner": "core:validate_architecture_case",
    },
    "REQ-TIM-004": {
        "validator_id": "measured_requires_rehearsal",
        "failure_code": "CONTENT_MEASURED_WITHOUT_REHEARSAL_EVIDENCE",
        "probe_id": "F4_MEASURED_WITHOUT_REHEARSAL",
        "stage": "MACHINE_GATED",
        "runner": "core:_validate_legacy_deterministic",
    },
    "REQ-REF-001": {
        "validator_id": "canonical_reference_candidate_set",
        "failure_code": "CONTENT_REFERENCE_CANDIDATE_COMPARISON_INCOMPLETE",
        "probe_id": "M15_FAKE_DUPLICATE_OR_STALE_REFERENCE_CANDIDATE",
        "stage": "EVIDENCE_READY",
        "runner": "local:validate_reference_candidates",
    },
    "REQ-REF-002": {
        "validator_id": "canonical_reference_receipt",
        "failure_code": "CONTENT_REFERENCE_RECEIPT_NOT_VERIFIED",
        "probe_id": "F6_REFERENCE_RECEIPT",
        "stage": "EVIDENCE_READY",
        "runner": "core:_selected_reference_receipts",
    },
    "REQ-FRZ-001": {
        "validator_id": "submission_freeze_exact_bytes",
        "failure_code": "CONTENT_SUBMISSION_FREEZE_STALE",
        "probe_id": "F5_STALE_FREEZE",
        "stage": "SUBMISSION_FROZEN",
        "runner": "core:validate_submission_freeze",
    },
    "REQ-FRZ-002": {
        "validator_id": "gate_evidence_binding_closure",
        "failure_code": "CONTENT_GATE_EVIDENCE_STALE",
        "probe_id": "M14_STALE_GATE_EVIDENCE",
        "stage": "SUBMISSION_FROZEN",
        "runner": "checker:_expanded_expected_submission_bindings",
    },
    "REQ-STA-001": {
        "validator_id": "durable_state_trace_and_evidence",
        "failure_code": "CONTENT_ARCH_STATE_TRACE_SEQUENCE_DRIFT",
        "probe_id": "P_STATE_TRACE_FORGERY",
        "stage": "SUBMISSION_FROZEN",
        "runner": "local:validate_state_evidence_refs",
    },
    "REQ-STA-002": {
        "validator_id": "script_facts_before_machine_gate",
        "failure_code": "CONTENT_MACHINE_GATE_WITHOUT_SCRIPT_FACTS",
        "probe_id": "P_NO_FACTS_NO_MACHINE_GATE",
        "stage": "MACHINE_GATED",
        "runner": "core:validate_architecture_case",
    },
    "REQ-STA-003": {
        "validator_id": "blocking_unknown_fail_closed",
        "failure_code": "CONTENT_BLOCKING_SEMANTIC_UNKNOWN",
        "probe_id": "M13_BLOCKING_UNKNOWN",
        "stage": "SEMANTIC_JUDGED",
        "runner": "core:_validate_judge_document",
    },
    "REQ-REV-001": {
        "validator_id": "semantic_judge_evidence_binding",
        "failure_code": "CONTENT_SEMANTIC_JUDGE_EVIDENCE_INVALID",
        "probe_id": "P_JUDGE_EVIDENCE_FORGERY",
        "stage": "SEMANTIC_JUDGED",
        "runner": "core:_validate_judge_document",
    },
    "REQ-ACC-001": {
        "validator_id": "post_freeze_human_acceptance_receipt",
        "failure_code": "CONTENT_HUMAN_ACCEPTANCE_RECEIPT_INVALID",
        "probe_id": "P_POST_FREEZE_STATE_LOOP",
        "stage": "HUMAN_ACCEPTED",
        "runner": "local:validate_human_acceptance_receipt",
    },
    "REQ-WPK-001": {
        "validator_id": "phase_specific_work_packet",
        "failure_code": "CONTENT_ARCH_WORK_PACKET_INVALID",
        "probe_id": "P_WORK_PACKET_FORGERY",
        "stage": "SUBMISSION_FROZEN",
        "runner": "core:validate_architecture_case",
    },
}

STAGE_ORDER = (
    "SOURCE_LOCKED", "EVIDENCE_READY", "IR_READY", "SCRIPT_BUILT",
    "SCRIPT_FACTS_DERIVED", "MACHINE_GATED", "SEMANTIC_JUDGED",
    "SUBMISSION_FROZEN", "HUMAN_ACCEPTED",
)
MACHINE_GATE_MAX_STAGE = STAGE_ORDER.index("MACHINE_GATED")
HUMAN_ACCEPTANCE_FILENAME = "HUMAN_ACCEPTANCE_RECEIPT.yaml"
HUMAN_ACCEPTANCE_SCHEMA = "teaching-demo-human-acceptance-v1"
FORMULA_LIKE = re.compile(
    r"(?:\\frac\s*\{|[A-Za-zΔ][A-Za-z0-9Δ_]*\s*(?:=|/|×|·|\^)\s*[A-Za-z0-9Δ(+\-]|[A-Za-zΔ]\s*/\s*[A-Za-zΔ])"
)
PRACTICE_SCOPES = {"trial_event", "support_product"}
RELEASE_SEMANTIC_REQUIREMENT_ID = "REQ-REL-001"
VISIBLE_RELEASE_EVENT_TYPES = {
    "SPEAK", "FORMULA_ORALIZE", "ASK", "INVITE", "WAIT", "STUDENT_RESPONSE",
    "PARAPHRASE", "FEEDBACK", "SCAFFOLD", "PRACTICE", "TRANSITION", "CLOSE",
}


def _stable(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _yaml(path: Path) -> dict[str, Any]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(doc, dict):
        raise ValueError(f"top-level YAML must be mapping: {path}")
    return doc


def _safe_repo_path(root: Path, raw: Any) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("repository-relative path required")
    rel = Path(raw)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"unsafe repository path: {raw}")
    path = (root / rel).resolve()
    path.relative_to(root.resolve())
    if not path.is_file():
        raise ValueError(f"repository file missing: {raw}")
    return path


def registry_digest() -> str:
    return _stable(ENFORCEMENT_SPECS)


def machine_gate_requirement_ids(contract: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for item in contract.get("requirement_registry") or []:
        if not isinstance(item, dict):
            continue
        if item.get("severity") != "HARD" or item.get("enforcement_class") != "MACHINE_DETERMINISTIC":
            continue
        rid = item.get("requirement_id")
        spec = ENFORCEMENT_SPECS.get(str(rid))
        if not isinstance(rid, str) or spec is None:
            continue
        stage = spec.get("stage")
        if stage in STAGE_ORDER and STAGE_ORDER.index(stage) <= MACHINE_GATE_MAX_STAGE:
            out.add(rid)
    return out


def validate_registry(contract: dict[str, Any]) -> list[str]:
    machine_rows: dict[str, dict[str, Any]] = {}
    rows_by_id: dict[str, dict[str, Any]] = {}
    for item in contract.get("requirement_registry") or []:
        if not isinstance(item, dict):
            continue
        rid = item.get("requirement_id")
        if isinstance(rid, str):
            rows_by_id[rid] = item
            if item.get("severity") == "HARD" and item.get("enforcement_class") == "MACHINE_DETERMINISTIC":
                machine_rows[rid] = item
    errors: list[str] = []
    missing = sorted(set(machine_rows) - set(ENFORCEMENT_SPECS))
    orphan = sorted(set(ENFORCEMENT_SPECS) - set(machine_rows))
    if missing:
        errors.append(f"CONTENT_ENFORCEMENT_REGISTRY_MISSING_MACHINE_REQ:{missing}")
    if orphan:
        errors.append(f"CONTENT_ENFORCEMENT_REGISTRY_ORPHAN_SPEC:{orphan}")
    for rid in sorted(set(machine_rows) & set(ENFORCEMENT_SPECS)):
        row = machine_rows[rid]
        spec = ENFORCEMENT_SPECS[rid]
        if row.get("failure_code") != spec["failure_code"]:
            errors.append(f"CONTENT_ENFORCEMENT_FAILURE_CODE_DRIFT:{rid}:{row.get('failure_code')}!={spec['failure_code']}")
        if not all(spec.get(k) for k in ("validator_id", "failure_code", "probe_id", "stage", "runner")):
            errors.append(f"CONTENT_ENFORCEMENT_SPEC_INCOMPLETE:{rid}")
            continue
        if spec["stage"] not in STAGE_ORDER:
            errors.append(f"CONTENT_ENFORCEMENT_STAGE_INVALID:{rid}:{spec['stage']}")
        runner = spec["runner"]
        if ":" not in runner:
            errors.append(f"CONTENT_ENFORCEMENT_RUNNER_INVALID:{rid}:{runner}")
        else:
            kind, target = runner.split(":", 1)
            if kind not in {"local", "core", "checker"} or not target:
                errors.append(f"CONTENT_ENFORCEMENT_RUNNER_INVALID:{rid}:{runner}")
            elif kind == "local" and not callable(globals().get(target)):
                errors.append(f"CONTENT_ENFORCEMENT_LOCAL_RUNNER_MISSING:{rid}:{target}")
    if (rows_by_id.get("REQ-SRC-ID-001") or {}).get("enforcement_class") != "MACHINE_DETERMINISTIC":
        errors.append("CONTENT_SOURCE_IDENTITY_REQUIREMENT_NOT_MACHINE")
    if (rows_by_id.get("REQ-SRC-REV-001") or {}).get("enforcement_class") != "HUMAN_ONLY":
        errors.append("CONTENT_SOURCE_VISUAL_REVIEW_REQUIREMENT_NOT_HUMAN_ONLY")
    if (rows_by_id.get(RELEASE_SEMANTIC_REQUIREMENT_ID) or {}).get("enforcement_class") != "SEMANTIC_JUDGE":
        errors.append("CONTENT_RELEASE_SEMANTIC_REQUIREMENT_NOT_SEMANTIC_JUDGE")
    return errors


def make_machine_gate_receipt(*, source_commit: str, bindings: dict[str, str], requirement_ids: set[str],
                              state_trace_prefix: list[dict[str, Any]]) -> dict[str, Any]:
    requirements: list[dict[str, Any]] = []
    for rid in sorted(requirement_ids):
        spec = ENFORCEMENT_SPECS.get(rid)
        if spec is None:
            raise ValueError(f"machine requirement missing executable spec: {rid}")
        requirements.append({
            "requirement_id": rid, "verdict": "PASS", "validator_id": spec["validator_id"],
            "failure_code": spec["failure_code"], "probe_id": spec["probe_id"], "runner": spec["runner"],
        })
    receipt: dict[str, Any] = {
        "schema_id": "teaching-demo-machine-gate-v1", "state": "MACHINE_GATED",
        "source_commit": source_commit, "bindings": dict(sorted(bindings.items())),
        "enforcement_registry_digest": registry_digest(),
        "state_trace_prefix_digest": _stable(state_trace_prefix), "requirements": requirements,
    }
    receipt["receipt_digest"] = _stable(receipt)
    return receipt


def validate_source_mode(manifest: dict[str, Any]) -> list[str]:
    mode = (((manifest.get("input") or {}).get("source_pages") or {}).get("mode"))
    return [] if mode == "repository-pdf" else [f"CONTENT_SOURCE_REMOTE_NOT_MATERIALIZED:{mode!r}"]


def _event_docs(workspace: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    events_doc = _yaml(workspace / "SCRIPT_EVENTS.yaml")
    events = events_doc.get("events") or []
    if not isinstance(events, list):
        raise ValueError("SCRIPT_EVENTS.events must be list")
    return [x for x in events if isinstance(x, dict)], _yaml(workspace / "SCRIPT_FACTS.yaml")


def _release_claims_from_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    claims: list[dict[str, Any]] = []
    for ordinal, event in enumerate(events):
        for claim in event.get("release_claims") or []:
            if not isinstance(claim, dict):
                continue
            claims.append({
                "knowledge_id": claim.get("knowledge_id"),
                "event_id": event.get("event_id"),
                "event_type": event.get("type"),
                "cycle_id": event.get("cycle_id"),
                "ordinal": ordinal,
                "visible_span": claim.get("visible_span"),
            })
    return claims


def upgrade_script_facts(base_facts: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    """Replace author-metadata first_release with deterministic unverified release claims."""
    out = dict(base_facts)
    out.pop("first_release", None)
    out.pop("facts_sha256", None)
    out["schema_id"] = "teaching-demo-script-facts-v2"
    out["release_claims"] = _release_claims_from_events(events)
    out["facts_sha256"] = _stable(out)
    return out


def _formed_knowledge_ids(workspace: Path) -> list[str]:
    cycles = (_yaml(workspace / "STUDENT_STATE_LEDGER.yaml").get("cycles") or [])
    out: list[str] = []
    for cycle in cycles:
        if not isinstance(cycle, dict):
            continue
        for kid in cycle.get("formed_knowledge_ids") or []:
            out.append(str(kid))
    return out


def _validate_release_claims(events: list[dict[str, Any]], formed_ids: list[str]) -> list[str]:
    errors: list[str] = []
    seen: list[str] = []
    for event in events:
        eid = str(event.get("event_id"))
        bare = event.get("releases") or []
        if bare:
            errors.append(f"CONTENT_RELEASE_BARE_METADATA_FORBIDDEN:{eid}:{[str(x) for x in bare]}")
        claims = event.get("release_claims") or []
        if not isinstance(claims, list):
            errors.append(f"CONTENT_RELEASE_CLAIMS_INVALID:{eid}")
            continue
        if claims and event.get("type") not in VISIBLE_RELEASE_EVENT_TYPES:
            errors.append(
                f"CONTENT_RELEASE_VISIBLE_SPAN_BINDING_INVALID:{eid}:event_type_not_rendered:{event.get('type')}"
            )
        text = event.get("text")
        for index, claim in enumerate(claims):
            if not isinstance(claim, dict):
                errors.append(f"CONTENT_RELEASE_CLAIM_INVALID:{eid}:{index}")
                continue
            kid, span = claim.get("knowledge_id"), claim.get("visible_span")
            if not isinstance(kid, str) or not kid.strip() or not isinstance(span, str) or not span.strip():
                errors.append(f"CONTENT_RELEASE_VISIBLE_SPAN_BINDING_INVALID:{eid}:{index}")
                continue
            if not isinstance(text, str) or text.count(span) != 1:
                errors.append(f"CONTENT_RELEASE_VISIBLE_SPAN_BINDING_INVALID:{eid}:{kid}:{span!r}")
            seen.append(kid)
    if len(seen) != len(set(seen)):
        errors.append("CONTENT_RELEASE_KNOWLEDGE_CLAIM_DUPLICATE")
    if sorted(seen) != sorted(formed_ids):
        errors.append(f"CONTENT_RELEASE_KNOWLEDGE_COVERAGE_DRIFT:expected={sorted(formed_ids)}:actual={sorted(seen)}")
    return errors


def validate_release_claim_structure(workspace: Path) -> list[str]:
    events, facts = _event_docs(workspace)
    errors = _validate_release_claims(events, _formed_knowledge_ids(workspace))
    expected_claims = _release_claims_from_events(events)
    if facts.get("schema_id") != "teaching-demo-script-facts-v2":
        errors.append("CONTENT_RELEASE_SCRIPT_FACTS_SCHEMA_NOT_V2")
    if facts.get("release_claims") != expected_claims:
        errors.append("CONTENT_RELEASE_SCRIPT_FACTS_CLAIMS_NOT_DERIVED")
    if "first_release" in facts:
        errors.append("CONTENT_RELEASE_UNVERIFIED_FIRST_RELEASE_FORBIDDEN")
    return errors


def _release_verification_errors(claims: list[dict[str, Any]], judge: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    verifications = judge.get("release_verifications")
    if not isinstance(verifications, list):
        return ["CONTENT_RELEASE_SEMANTIC_VERIFICATIONS_MISSING"]
    expected = [(str(c.get("knowledge_id")), str(c.get("event_id")), str(c.get("visible_span"))) for c in claims]
    actual: list[tuple[str, str, str]] = []
    required_global_refs: set[str] = set()
    for index, item in enumerate(verifications):
        if not isinstance(item, dict):
            errors.append(f"CONTENT_RELEASE_SEMANTIC_VERIFICATION_INVALID:{index}")
            continue
        kid, eid, span = str(item.get("knowledge_id")), str(item.get("event_id")), str(item.get("visible_span"))
        actual.append((kid, eid, span))
        verdict = item.get("verdict")
        if verdict != "PASS":
            errors.append(f"CONTENT_SEMANTIC_RELEASE_CLAIM_NOT_ESTABLISHED:{kid}:{eid}:{verdict}")
        if not isinstance(item.get("reason"), str) or not item.get("reason", "").strip():
            errors.append(f"CONTENT_RELEASE_SEMANTIC_REASON_MISSING:{kid}:{eid}")
        confidence = item.get("confidence")
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= float(confidence) <= 1:
            errors.append(f"CONTENT_RELEASE_SEMANTIC_CONFIDENCE_INVALID:{kid}:{eid}")
        refs = item.get("evidence_refs")
        required = {f"event:{eid}", f"exact-text:{span}"}
        if not isinstance(refs, list) or not required.issubset(set(str(x) for x in refs)):
            errors.append(f"CONTENT_RELEASE_SEMANTIC_EVIDENCE_REFS_INVALID:{kid}:{eid}")
        required_global_refs |= required
    if actual != expected:
        errors.append(f"CONTENT_RELEASE_SEMANTIC_COVERAGE_DRIFT:expected={expected}:actual={actual}")
    verdicts = judge.get("verdicts") or []
    global_rows = [x for x in verdicts if isinstance(x, dict) and x.get("requirement_id") == RELEASE_SEMANTIC_REQUIREMENT_ID]
    if len(global_rows) != 1 or global_rows[0].get("verdict") != "PASS":
        errors.append("CONTENT_RELEASE_SEMANTIC_GLOBAL_REQUIREMENT_NOT_PASS")
    else:
        global_refs = set(str(x) for x in global_rows[0].get("evidence_refs") or [])
        if not required_global_refs.issubset(global_refs):
            errors.append("CONTENT_RELEASE_SEMANTIC_GLOBAL_EVIDENCE_COVERAGE_DRIFT")
    return errors


def validate_release_semantic_verification(workspace: Path) -> list[str]:
    events, _ = _event_docs(workspace)
    claims = _release_claims_from_events(events)
    judge = _yaml(workspace / "SCIENCE_EVIDENCE_JUDGE.yaml")
    return _release_verification_errors(claims, judge)


def verified_first_release(workspace: Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    events, _ = _event_docs(workspace)
    claims = _release_claims_from_events(events)
    judge = _yaml(workspace / "SCIENCE_EVIDENCE_JUDGE.yaml")
    errors = _validate_release_claims(events, _formed_knowledge_ids(workspace))
    errors.extend(_release_verification_errors(claims, judge))
    if errors:
        return {}, errors
    out: dict[str, dict[str, Any]] = {}
    for claim in claims:
        kid = str(claim["knowledge_id"])
        out[kid] = {
            "event_id": claim["event_id"], "event_type": claim["event_type"],
            "cycle_id": claim["cycle_id"], "ordinal": claim["ordinal"],
            "visible_span": claim["visible_span"], "verification": "SCIENCE_EVIDENCE_JUDGE:PASS",
        }
    return out, []


def _practice_scope(item: dict[str, Any]) -> str | None:
    scope = item.get("execution_scope")
    if isinstance(scope, str):
        return scope
    if item.get("prompt_role") == "trial":
        return "trial_event"
    if item.get("prompt_role"):
        return "support_product"
    return None


def trial_event_practice_ids(preflight: dict[str, Any]) -> list[str]:
    return [
        str(item["item_id"]) for item in preflight.get("practice_inventory") or []
        if isinstance(item, dict) and _practice_scope(item) == "trial_event" and item.get("item_id")
    ]


def validate_reference_candidates(workspace: Path, *, root: Path = REPO_ROOT) -> list[str]:
    evidence = _yaml(workspace / "evidence.yaml")
    learning = evidence.get("reference_learning") or {}
    comparison = learning.get("structural_candidate_comparison") or {}
    candidates = comparison.get("candidates") or []
    if not isinstance(candidates, list):
        return ["CONTENT_REFERENCE_CANDIDATE_COMPARISON_INCOMPLETE"]
    errors: list[str] = []
    paths: list[str] = []
    ref_root = (root / REFERENCE_ROOT_REL).resolve()
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            errors.append(f"CONTENT_REFERENCE_CANDIDATE_INVALID:{index}")
            continue
        raw, declared_sha = candidate.get("case_receipt"), candidate.get("case_receipt_sha256")
        if not isinstance(raw, str) or not raw:
            errors.append(f"CONTENT_REFERENCE_CANDIDATE_RECEIPT_MISSING:{index}")
            continue
        paths.append(raw)
        try:
            path = _safe_repo_path(root, raw)
            path.resolve().relative_to(ref_root)
            if path.name != "CASE.yaml":
                raise ValueError("candidate receipt must be CASE.yaml")
            receipt = _yaml(path)
        except Exception as exc:
            errors.append(f"CONTENT_REFERENCE_CANDIDATE_RECEIPT_INVALID:{index}:{raw}:{exc}")
            continue
        if not isinstance(declared_sha, str) or declared_sha != _sha256(path):
            errors.append(f"CONTENT_REFERENCE_CANDIDATE_RECEIPT_SHA_STALE:{index}:{raw}")
        verification = receipt.get("verification") or {}
        if verification.get("visual_open_and_review") != "PASS":
            errors.append(f"CONTENT_REFERENCE_CANDIDATE_NOT_VISUALLY_VERIFIED:{index}:{raw}")
        if not isinstance(receipt.get("mechanism_summary"), list) or not receipt.get("mechanism_summary"):
            errors.append(f"CONTENT_REFERENCE_CANDIDATE_MECHANISM_MISSING:{index}:{raw}")
    if len(paths) != len(candidates) or len(paths) < 2:
        errors.append("CONTENT_REFERENCE_CANDIDATE_COMPARISON_INCOMPLETE")
    if len(paths) != len(set(paths)):
        errors.append("CONTENT_REFERENCE_CANDIDATE_RECEIPT_DUPLICATE")
    selected = comparison.get("selected_case_receipt")
    if selected not in paths:
        errors.append("CONTENT_REFERENCE_SELECTED_NOT_IN_CANDIDATES")
    selected_receipts = learning.get("selected_case_receipts") or []
    if not isinstance(selected_receipts, list) or selected not in selected_receipts:
        errors.append("CONTENT_REFERENCE_SELECTED_NOT_IN_VERIFIED_RECEIPTS")
    return errors


def validate_resource_visibility(workspace: Path) -> list[str]:
    events, _ = _event_docs(workspace)
    resources = (_yaml(workspace / "RESOURCE_ACTION_MAP.yaml").get("resources") or [])
    cycles = (_yaml(workspace / "STUDENT_STATE_LEDGER.yaml").get("cycles") or [])
    resource_ids = {str(x.get("resource_id")) for x in resources if isinstance(x, dict) and x.get("resource_id")}
    protected_answer_resources = {
        str(resource.get("resource_id"))
        for resource in resources
        if isinstance(resource, dict)
        and resource.get("resource_id")
        and resource.get("use_mode") in {"discovery", "scaffold"}
        and bool(resource.get("answer_bearing_information_ids") or [])
    }
    resource_cycles: dict[str, set[str]] = {}
    for cycle in cycles:
        if not isinstance(cycle, dict) or not cycle.get("cycle_id"):
            continue
        cid = str(cycle["cycle_id"])
        for rid in cycle.get("resource_ids") or []:
            resource_cycles.setdefault(str(rid), set()).add(cid)
    events_by_cycle: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    errors: list[str] = []
    for ordinal, event in enumerate(events):
        events_by_cycle.setdefault(str(event.get("cycle_id")), []).append((ordinal, event))
        rid = event.get("resource_id")
        if (
            event.get("type") == "RESOURCE_SHOW"
            and isinstance(rid, str)
            and rid in protected_answer_resources
            and event.get("visibility") == "FULL"
        ):
            errors.append(
                f"CONTENT_ACTUAL_ANSWER_RESOURCE_PREMATURE:{rid}:"
                f"{event.get('event_id')}:FULL_RESOURCE_SHOW_FORBIDDEN"
            )
        if event.get("type") == "RESOURCE_REVEAL":
            if not isinstance(rid, str) or not rid.strip():
                errors.append(f"CONTENT_RESOURCE_REVEAL_RESOURCE_ID_MISSING:{event.get('event_id')}")
            elif rid not in resource_ids:
                errors.append(f"CONTENT_RESOURCE_REVEAL_RESOURCE_UNKNOWN:{event.get('event_id')}:{rid}")
            timing = event.get("timing") or {}
            if not isinstance(timing, dict) or not isinstance(timing.get("action_seconds"), (int, float)) or isinstance(timing.get("action_seconds"), bool) or timing.get("action_seconds") <= 0:
                errors.append(f"CONTENT_RESOURCE_REVEAL_TIMING_INVALID:{event.get('event_id')}")
    valid_visibility, safe_visibility = {"SAFE", "MASKED", "CROPPED", "FULL"}, {"SAFE", "MASKED", "CROPPED"}
    for resource in resources:
        if not isinstance(resource, dict):
            continue
        rid = str(resource.get("resource_id"))
        answers = {str(x) for x in resource.get("answer_bearing_information_ids") or []}
        if not answers or resource.get("use_mode") not in {"discovery", "scaffold"}:
            continue
        relevant_cycles = resource_cycles.get(rid) or {str(resource.get("reveal_before_cycle"))}
        for cid in relevant_cycles:
            seq = events_by_cycle.get(cid, [])
            response_ord = next((o for o, e in seq if e.get("type") == "STUDENT_RESPONSE"), None)
            if response_ord is None:
                errors.append(f"CONTENT_ANSWER_RESOURCE_STUDENT_RESPONSE_MISSING:{rid}:{cid}")
                continue
            safe_show_ord: int | None = None
            reveal_ord: int | None = None
            for ordinal, event in seq:
                if event.get("resource_id") != rid:
                    continue
                if event.get("type") == "RESOURCE_SHOW":
                    visibility = event.get("visibility")
                    if visibility not in valid_visibility:
                        errors.append(f"CONTENT_RESOURCE_VISIBILITY_STATE_MISSING:{rid}:{event.get('event_id')}")
                    if visibility in safe_visibility and ordinal < response_ord and safe_show_ord is None:
                        safe_show_ord = ordinal
                    claimed = {str(x.get("knowledge_id")) for x in event.get("release_claims") or [] if isinstance(x, dict)}
                    if ordinal < response_ord and visibility in safe_visibility and claimed & answers:
                        errors.append(f"CONTENT_ANSWER_RESOURCE_MASKED_EVENT_RELEASES_ANSWER:{rid}:{event.get('event_id')}:{sorted(claimed & answers)}")
                elif event.get("type") == "RESOURCE_REVEAL":
                    if reveal_ord is None:
                        reveal_ord = ordinal
                    if ordinal <= response_ord:
                        errors.append(f"CONTENT_ACTUAL_ANSWER_RESOURCE_PREMATURE:{rid}:{event.get('event_id')}")
            if safe_show_ord is None:
                errors.append(f"CONTENT_ANSWER_RESOURCE_NO_SAFE_PRETASK_SHOW:{rid}:{cid}")
            if reveal_ord is None or reveal_ord <= response_ord:
                errors.append(f"CONTENT_ANSWER_RESOURCE_REVEAL_NOT_AFTER_RESPONSE:{rid}:{cid}")
    return errors


def _first_full_exposures(workspace: Path) -> dict[str, dict[str, Any]]:
    """Return the earliest event that fully exposes each resource answer surface."""
    events, _ = _event_docs(workspace)
    out: dict[str, dict[str, Any]] = {}
    for ordinal, event in enumerate(events):
        rid = event.get("resource_id")
        if not isinstance(rid, str) or not rid:
            continue
        event_type = event.get("type")
        is_full_show = event_type == "RESOURCE_SHOW" and event.get("visibility") == "FULL"
        is_reveal = event_type == "RESOURCE_REVEAL"
        if not (is_full_show or is_reveal):
            continue
        out.setdefault(rid, {
            "ordinal": ordinal,
            "event_type": event_type,
            "event_id": event.get("event_id"),
        })
    return out


def validate_resource_reveal_after_verified_formation(workspace: Path) -> list[str]:
    verified, verification_errors = verified_first_release(workspace)
    if verification_errors:
        return ["CONTENT_VERIFIED_RELEASE_REQUIRED_FOR_RESOURCE_CAUSALITY"]
    resources = (_yaml(workspace / "RESOURCE_ACTION_MAP.yaml").get("resources") or [])
    first_full = _first_full_exposures(workspace)
    errors: list[str] = []
    for resource in resources:
        if not isinstance(resource, dict):
            continue
        rid = str(resource.get("resource_id"))
        answers = [str(x) for x in resource.get("answer_bearing_information_ids") or []]
        if not answers or resource.get("use_mode") not in {"discovery", "scaffold"}:
            continue
        exposure = first_full.get(rid)
        if not isinstance(exposure, dict):
            errors.append(f"CONTENT_ANSWER_RESOURCE_REVEAL_BEFORE_VERIFIED_FORMATION:{rid}:NO_FULL_EXPOSURE")
            continue
        if exposure.get("event_type") != "RESOURCE_REVEAL":
            errors.append(
                f"CONTENT_ANSWER_RESOURCE_REVEAL_BEFORE_VERIFIED_FORMATION:{rid}:"
                f"FIRST_FULL_EXPOSURE_NOT_RESOURCE_REVEAL:{exposure.get('event_id')}"
            )
        full_ord = exposure.get("ordinal")
        for kid in answers:
            release = verified.get(kid)
            formation_ord = release.get("ordinal") if isinstance(release, dict) else None
            if not isinstance(full_ord, int) or not isinstance(formation_ord, int) or formation_ord >= full_ord:
                errors.append(f"CONTENT_ANSWER_RESOURCE_REVEAL_BEFORE_VERIFIED_FORMATION:{rid}:{kid}")
    return errors


def validate_board_strict_after_formation(workspace: Path) -> list[str]:
    _, facts = _event_docs(workspace)
    verified, verification_errors = verified_first_release(workspace)
    if verification_errors:
        return ["CONTENT_VERIFIED_RELEASE_REQUIRED_FOR_BOARD_CAUSALITY"]
    deltas = (_yaml(workspace / "BOARD_TIMELINE.yaml").get("board_deltas") or [])
    delta_map = {str(x.get("delta_id")): x for x in deltas if isinstance(x, dict) and x.get("delta_id")}
    errors: list[str] = []
    for item in facts.get("board_adds") or []:
        if not isinstance(item, dict) or not isinstance(item.get("ordinal"), int):
            continue
        ordinal = int(item["ordinal"])
        delta = delta_map.get(str(item.get("board_delta_id"))) or {}
        knowledge_ids = list(delta.get("prerequisite_knowledge_ids") or []) + list(delta.get("newly_formed_knowledge_ids") or [])
        for kid in knowledge_ids:
            release = verified.get(str(kid))
            release_ord = release.get("ordinal") if isinstance(release, dict) else None
            if not isinstance(release_ord, int) or release_ord >= ordinal:
                errors.append(f"CONTENT_ACTUAL_BOARD_BEFORE_FORMATION:{item.get('event_id')}:{kid}")
    return errors


def validate_practice_occurrences(workspace: Path) -> list[str]:
    events, _ = _event_docs(workspace)
    preflight = _yaml(workspace / "semantic-preflight-review.yaml")
    inventory = preflight.get("practice_inventory") or []
    errors: list[str] = []
    event_items: list[dict[str, Any]] = []
    for item in inventory:
        if not isinstance(item, dict):
            continue
        pid, scope = item.get("item_id"), item.get("execution_scope")
        if scope is None:
            errors.append(f"CONTENT_PRACTICE_EXECUTION_SCOPE_MISSING:{pid}")
            scope = _practice_scope(item)
        if scope not in PRACTICE_SCOPES:
            errors.append(f"CONTENT_PRACTICE_EXECUTION_SCOPE_INVALID:{pid}:{scope}")
            continue
        prompt_role = item.get("prompt_role")
        if scope == "trial_event":
            if prompt_role != "trial":
                errors.append(f"CONTENT_PRACTICE_SCOPE_ROLE_DRIFT:{pid}:trial_event:{prompt_role}")
            event_items.append(item)
        elif prompt_role == "trial":
            errors.append(f"CONTENT_PRACTICE_SCOPE_ROLE_DRIFT:{pid}:support_product:trial")
    declared = [str(x.get("item_id")) for x in event_items if x.get("item_id")]
    actual = [(str(e.get("practice_id")), str(e.get("text") or ""), str(e.get("event_id"))) for e in events if e.get("type") == "PRACTICE"]
    actual_ids = [x[0] for x in actual]
    if declared != actual_ids:
        errors.append(f"CONTENT_ACTUAL_PRACTICE_INVENTORY_DRIFT:declared={declared}:actual={actual_ids}")
    for pid, count in Counter(actual_ids).items():
        if count != 1:
            errors.append(f"CONTENT_ACTUAL_PRACTICE_OCCURRENCE_INVALID:{pid}:{count}")
    by_id = {str(x.get("item_id")): x for x in event_items if x.get("item_id")}
    for pid, text, eid in actual:
        anchor = (by_id.get(pid) or {}).get("prompt_anchor")
        if not isinstance(anchor, str) or not anchor.strip() or anchor not in text:
            errors.append(f"CONTENT_ACTUAL_PRACTICE_TEXT_BINDING_DRIFT:{pid}:{eid}")
    return errors


def validate_formula_typing(workspace: Path) -> list[str]:
    events, _ = _event_docs(workspace)
    errors: list[str] = []
    for event in events:
        text = event.get("text")
        if not isinstance(text, str) or event.get("type") == "FORMULA_ORALIZE":
            continue
        match = FORMULA_LIKE.search(text)
        if match:
            errors.append(f"CONTENT_ACTUAL_FORMULA_ORALIZATION_MISSING:{event.get('event_id')}:{match.group(0)}")
    return errors


_TRANSITION_EVIDENCE: dict[tuple[str, str], set[str]] = {
    ("SOURCE_LOCKED", "EVIDENCE_READY"): {"source-lock", "artifact:SOURCE_REVIEW.yaml"},
    ("EVIDENCE_READY", "IR_READY"): {"artifact:LESSON_EVIDENCE_IR.yaml"},
    ("IR_READY", "SCRIPT_BUILT"): {"artifact:SCRIPT_EVENTS.yaml"},
    ("SCRIPT_BUILT", "SCRIPT_FACTS_DERIVED"): {"artifact:SCRIPT_FACTS.yaml"},
    ("SCRIPT_FACTS_DERIVED", "MACHINE_GATED"): {"artifact:MACHINE_GATE.yaml"},
    ("MACHINE_GATED", "SEMANTIC_JUDGED"): {"artifact:SCIENCE_EVIDENCE_JUDGE.yaml", "artifact:ENACTMENT_STUDENT_JUDGE.yaml"},
    ("SEMANTIC_JUDGED", "SUBMISSION_FROZEN"): {"artifact:SUBMISSION_FREEZE.yaml"},
}


def validate_state_evidence_refs(workspace: Path, source_binding_digest: str) -> list[str]:
    packet = _yaml(workspace / "WORK_PACKET.yaml")
    trace = packet.get("state_trace") or []
    errors: list[str] = []
    for index, item in enumerate(trace):
        if not isinstance(item, dict):
            continue
        expected = _TRANSITION_EVIDENCE.get((str(item.get("from_state")), str(item.get("to_state"))))
        if expected is None:
            continue
        refs = set(str(x) for x in item.get("evidence_refs") or [])
        for required in expected:
            if required == "source-lock":
                if f"source-lock:{source_binding_digest}" not in refs:
                    errors.append(f"CONTENT_ARCH_STATE_TRACE_EVIDENCE_UNRESOLVED:{index}:source-lock")
                continue
            if required not in refs:
                errors.append(f"CONTENT_ARCH_STATE_TRACE_EVIDENCE_UNRESOLVED:{index}:{required}")
                continue
            filename = required.split(":", 1)[1]
            if not (workspace / filename).is_file():
                errors.append(f"CONTENT_ARCH_STATE_TRACE_EVIDENCE_MISSING_FILE:{index}:{filename}")
        for ref in refs:
            if ref.startswith("artifact:"):
                filename = ref.split(":", 1)[1]
                if not filename or "/" in filename or "\\" in filename or not (workspace / filename).is_file():
                    errors.append(f"CONTENT_ARCH_STATE_TRACE_EVIDENCE_INVALID:{index}:{ref}")
            elif ref.startswith("source-lock:"):
                if ref != f"source-lock:{source_binding_digest}":
                    errors.append(f"CONTENT_ARCH_STATE_TRACE_EVIDENCE_INVALID:{index}:{ref}")
            else:
                errors.append(f"CONTENT_ARCH_STATE_TRACE_EVIDENCE_SCHEME_INVALID:{index}:{ref}")
    return errors


def validate_machine_receipt_metadata(workspace: Path, contract: dict[str, Any]) -> list[str]:
    receipt = _yaml(workspace / "MACHINE_GATE.yaml")
    expected_ids = machine_gate_requirement_ids(contract)
    items = receipt.get("requirements") or []
    errors: list[str] = []
    if receipt.get("enforcement_registry_digest") != registry_digest():
        errors.append("CONTENT_MACHINE_GATE_ENFORCEMENT_REGISTRY_STALE")
    if not isinstance(items, list):
        return errors + ["CONTENT_MACHINE_GATE_REQUIREMENTS_INVALID"]
    ids = [str(x.get("requirement_id")) for x in items if isinstance(x, dict) and x.get("requirement_id")]
    if len(ids) != len(set(ids)):
        errors.append("CONTENT_MACHINE_GATE_REQUIREMENT_DUPLICATE")
    if set(ids) != expected_ids:
        errors.append(f"CONTENT_MACHINE_GATE_REQUIREMENT_COVERAGE_DRIFT:expected={sorted(expected_ids)}:actual={sorted(set(ids))}")
    for item in items:
        if not isinstance(item, dict):
            continue
        rid = str(item.get("requirement_id"))
        spec = ENFORCEMENT_SPECS.get(rid)
        if spec is None:
            continue
        for key in ("validator_id", "failure_code", "probe_id", "runner"):
            if item.get(key) != spec[key]:
                errors.append(f"CONTENT_MACHINE_GATE_ENFORCEMENT_METADATA_DRIFT:{rid}:{key}")
    return errors


def validate_human_acceptance_receipt(workspace: Path, case_id: Any, source_commit: str) -> list[str]:
    path = workspace / HUMAN_ACCEPTANCE_FILENAME
    if not path.is_file():
        return [f"CONTENT_HUMAN_ACCEPTANCE_RECEIPT_MISSING:{HUMAN_ACCEPTANCE_FILENAME}"]
    try:
        doc = _yaml(path)
        freeze, review = workspace / "SUBMISSION_FREEZE.yaml", workspace / "INDEPENDENT_CONTENT_REVIEW.yaml"
        expected = {
            "submission_freeze": {"path": "SUBMISSION_FREEZE.yaml", "sha256": _sha256(freeze)},
            "independent_content_review": {"path": "INDEPENDENT_CONTENT_REVIEW.yaml", "sha256": _sha256(review)},
        }
    except Exception as exc:
        return [f"CONTENT_HUMAN_ACCEPTANCE_RECEIPT_INVALID:{exc}"]
    errors: list[str] = []
    if doc.get("schema_id") != HUMAN_ACCEPTANCE_SCHEMA:
        errors.append("CONTENT_HUMAN_ACCEPTANCE_SCHEMA_INVALID")
    if doc.get("case_id") != case_id:
        errors.append("CONTENT_HUMAN_ACCEPTANCE_CASE_DRIFT")
    if doc.get("from_state") != "SUBMISSION_FROZEN" or doc.get("to_state") != "HUMAN_ACCEPTED":
        errors.append("CONTENT_HUMAN_ACCEPTANCE_TRANSITION_INVALID")
    if doc.get("source_commit") != source_commit:
        errors.append("CONTENT_HUMAN_ACCEPTANCE_SOURCE_COMMIT_DRIFT")
    if doc.get("bindings") != expected:
        errors.append("CONTENT_HUMAN_ACCEPTANCE_BINDING_STALE")
    basis = dict(doc)
    declared = basis.pop("transition_digest", None)
    if declared != _stable(basis):
        errors.append("CONTENT_HUMAN_ACCEPTANCE_TRANSITION_DIGEST_DRIFT")
    return errors


def _write_resource_mutant_fixture(workspace: Path) -> None:
    """Build the exact Gate-A P1-05 mutant: post-response FULL show before formation."""
    events = [
        {"event_id": "S0", "type": "RESOURCE_SHOW", "cycle_id": "C1", "resource_id": "R1", "visibility": "MASKED"},
        {"event_id": "R0", "type": "STUDENT_RESPONSE", "cycle_id": "C1", "text": "我先说观察到的现象。"},
        {"event_id": "F0", "type": "RESOURCE_SHOW", "cycle_id": "C1", "resource_id": "R1", "visibility": "FULL"},
        {"event_id": "K0", "type": "PARAPHRASE", "cycle_id": "C1", "text": "所以结论K1成立。",
         "releases": [], "release_claims": [{"knowledge_id": "K1", "visible_span": "结论K1成立"}]},
        {"event_id": "V0", "type": "RESOURCE_REVEAL", "cycle_id": "C1", "resource_id": "R1", "timing": {"action_seconds": 1}},
    ]
    (workspace / "SCRIPT_EVENTS.yaml").write_text(yaml.safe_dump({"events": events}, allow_unicode=True), encoding="utf-8")
    (workspace / "SCRIPT_FACTS.yaml").write_text(yaml.safe_dump({"schema_id": "teaching-demo-script-facts-v2", "release_claims": _release_claims_from_events(events)}, allow_unicode=True), encoding="utf-8")
    (workspace / "RESOURCE_ACTION_MAP.yaml").write_text(yaml.safe_dump({"resources": [{
        "resource_id": "R1", "use_mode": "discovery", "answer_bearing_information_ids": ["K1"], "reveal_before_cycle": "C1",
    }]}), encoding="utf-8")
    (workspace / "STUDENT_STATE_LEDGER.yaml").write_text(yaml.safe_dump({"cycles": [{
        "cycle_id": "C1", "resource_ids": ["R1"], "formed_knowledge_ids": ["K1"],
    }]}), encoding="utf-8")
    (workspace / "SCIENCE_EVIDENCE_JUDGE.yaml").write_text(yaml.safe_dump({
        "release_verifications": [{
            "knowledge_id": "K1", "event_id": "K0", "visible_span": "结论K1成立", "verdict": "PASS",
            "reason": "fixture", "confidence": 1.0, "evidence_refs": ["event:K0", "exact-text:结论K1成立"],
        }],
        "verdicts": [{
            "requirement_id": RELEASE_SEMANTIC_REQUIREMENT_ID, "verdict": "PASS",
            "evidence_refs": ["event:K0", "exact-text:结论K1成立"],
        }],
    }, allow_unicode=True), encoding="utf-8")


def selftest() -> None:
    assert len(ENFORCEMENT_SPECS) == len(set(ENFORCEMENT_SPECS))
    assert all(all(spec.get(k) for k in ("validator_id", "failure_code", "probe_id", "stage", "runner")) for spec in ENFORCEMENT_SPECS.values())
    assert FORMULA_LIKE.search("所以 p=mv")
    assert FORMULA_LIKE.search("比较 F/q")
    assert _practice_scope({"prompt_role": "trial"}) == "trial_event"
    assert _practice_scope({"prompt_role": "exam_skeleton"}) == "support_product"

    mutant_events = [{
        "event_id": "E0", "type": "SPEAK", "cycle_id": "C1", "text": "同学们先观察一下。",
        "releases": ["K1"], "timing": {"speech_seconds": 1},
    }]
    assert any("BARE_METADATA_FORBIDDEN" in e for e in _validate_release_claims(mutant_events, ["K1"]))

    hidden_action_claim = [{
        "event_id": "A1", "type": "RESOURCE_SHOW", "cycle_id": "C1",
        "text": "这个比值保持不变。", "releases": [],
        "release_claims": [{"knowledge_id": "K1", "visible_span": "这个比值保持不变"}],
    }]
    assert any("event_type_not_rendered" in e for e in _validate_release_claims(hidden_action_claim, ["K1"]))

    good_events = [{
        "event_id": "E1", "type": "PARAPHRASE", "cycle_id": "C1", "text": "所以这个比值保持不变。",
        "releases": [], "release_claims": [{"knowledge_id": "K1", "visible_span": "这个比值保持不变"}],
        "timing": {"speech_seconds": 1},
    }]
    assert _validate_release_claims(good_events, ["K1"]) == []
    base = {"schema_id": "teaching-demo-script-facts-v1", "first_release": {"K1": {"ordinal": 0}}, "facts_sha256": "old"}
    upgraded = upgrade_script_facts(base, good_events)
    assert upgraded["schema_id"] == "teaching-demo-script-facts-v2" and "first_release" not in upgraded
    claims = upgraded["release_claims"]
    unknown_judge = {
        "release_verifications": [{
            "knowledge_id": "K1", "event_id": "E1", "visible_span": "这个比值保持不变",
            "verdict": "UNKNOWN", "reason": "语义不足", "confidence": 0.4,
            "evidence_refs": ["event:E1", "exact-text:这个比值保持不变"],
        }],
        "verdicts": [{
            "requirement_id": RELEASE_SEMANTIC_REQUIREMENT_ID, "verdict": "UNKNOWN",
            "evidence_refs": ["event:E1", "exact-text:这个比值保持不变"],
        }],
    }
    assert any("NOT_ESTABLISHED" in e for e in _release_verification_errors(claims, unknown_judge))

    with tempfile.TemporaryDirectory(prefix="qz-resource-full-exposure-") as tmp:
        workspace = Path(tmp)
        _write_resource_mutant_fixture(workspace)
        visibility_errors = validate_resource_visibility(workspace)
        assert any("FULL_RESOURCE_SHOW_FORBIDDEN" in e for e in visibility_errors)
        causality_errors = validate_resource_reveal_after_verified_formation(workspace)
        assert any("FIRST_FULL_EXPOSURE_NOT_RESOURCE_REVEAL" in e for e in causality_errors)

        # Move the illicit FULL show into an unrelated/undeclared cycle. The
        # MACHINE visibility invariant must still kill it globally by resource
        # identity instead of relying on the declared resource-cycle relation.
        event_doc = _yaml(workspace / "SCRIPT_EVENTS.yaml")
        fixture_events = event_doc["events"]
        for event in fixture_events:
            if event.get("event_id") == "F0":
                event["visibility"] = "MASKED"
        fixture_events.insert(2, {
            "event_id": "F99", "type": "RESOURCE_SHOW", "cycle_id": "C99",
            "resource_id": "R1", "visibility": "FULL",
        })
        (workspace / "SCRIPT_EVENTS.yaml").write_text(
            yaml.safe_dump(event_doc, allow_unicode=True), encoding="utf-8"
        )
        visibility_errors = validate_resource_visibility(workspace)
        assert any(":F99:FULL_RESOURCE_SHOW_FORBIDDEN" in e for e in visibility_errors)

    registry_rows: list[dict[str, Any]] = []
    for rid, spec in ENFORCEMENT_SPECS.items():
        registry_rows.append({
            "requirement_id": rid, "severity": "HARD", "authority_source": "selftest", "subject": "selftest",
            "enforcement_class": "MACHINE_DETERMINISTIC", "enforcer": spec["runner"],
            "evidence_required": ["selftest"], "failure_code": spec["failure_code"], "gate_effect": "blocks",
        })
    registry_rows.extend([
        {
            "requirement_id": "REQ-SRC-REV-001", "severity": "HARD", "authority_source": "selftest",
            "subject": "visual source review", "enforcement_class": "HUMAN_ONLY", "enforcer": "human",
            "evidence_required": ["receipt"], "failure_code": "CONTENT_SOURCE_VISUAL_REVIEW_NOT_ESTABLISHED", "gate_effect": "blocks",
        },
        {
            "requirement_id": RELEASE_SEMANTIC_REQUIREMENT_ID, "severity": "HARD", "authority_source": "selftest",
            "subject": "release semantic truth", "enforcement_class": "SEMANTIC_JUDGE", "enforcer": "Science/Evidence Judge",
            "evidence_required": ["release verifications"], "failure_code": "CONTENT_SEMANTIC_RELEASE_CLAIM_NOT_ESTABLISHED", "gate_effect": "blocks",
        },
    ])
    assert validate_registry({"requirement_registry": registry_rows}) == []

    requirement_ids = {rid for rid, spec in ENFORCEMENT_SPECS.items() if STAGE_ORDER.index(spec["stage"]) <= MACHINE_GATE_MAX_STAGE}
    receipt = make_machine_gate_receipt(source_commit="0" * 40, bindings={"x": "y"}, requirement_ids=requirement_ids,
                                        state_trace_prefix=[{"from_state": "SOURCE_LOCKED", "to_state": "EVIDENCE_READY"}])
    assert receipt["enforcement_registry_digest"] == registry_digest()
    assert receipt["state_trace_prefix_digest"]
    assert all(all(key in item for key in ("validator_id", "failure_code", "probe_id", "runner")) for item in receipt["requirements"])
