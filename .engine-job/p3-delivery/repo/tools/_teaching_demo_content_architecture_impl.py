"""Pure deterministic helpers for the canonical Teaching Demo Content checker.

No CLI is exposed here. The only content gate entry remains
``tools/check_teaching_demo_content.py``. This helper implements Phase-A
primitives imported by that canonical checker: requirement traceability, explicit
state transitions, actual SCRIPT_FACTS derivation, semantic evidence-reference
resolution, Work Packet validation and content-addressed receipts.
"""
from __future__ import annotations

from collections import defaultdict
import hashlib
import json
from pathlib import Path
from typing import Any

ENFORCEMENT_CLASSES = {
    "MACHINE_DETERMINISTIC",
    "SEMANTIC_JUDGE",
    "HUMAN_ONLY",
    "AUTHOR_SELF_CHECK",
}

SCRIPT_EVENT_TYPES = {
    "SPEAK",
    "FORMULA_ORALIZE",
    "ASK",
    "INVITE",
    "WAIT",
    "STUDENT_RESPONSE",
    "PARAPHRASE",
    "FEEDBACK",
    "SCAFFOLD",
    "RESOURCE_SHOW",
    "RESOURCE_HIDE_OR_MASK",
    "BOARD_ADD",
    "PRACTICE",
    "TRANSITION",
    "CLOSE",
}

TEXT_EVENT_TYPES = {
    "SPEAK",
    "FORMULA_ORALIZE",
    "ASK",
    "INVITE",
    "WAIT",
    "STUDENT_RESPONSE",
    "PARAPHRASE",
    "FEEDBACK",
    "SCAFFOLD",
    "PRACTICE",
    "TRANSITION",
    "CLOSE",
}

STATES = (
    "SOURCE_LOCKED",
    "EVIDENCE_READY",
    "IR_READY",
    "SCRIPT_BUILT",
    "SCRIPT_FACTS_DERIVED",
    "MACHINE_GATED",
    "SEMANTIC_JUDGED",
    "SUBMISSION_FROZEN",
    "HUMAN_ACCEPTED",
)

ALLOWED_TRANSITIONS = {(STATES[i], STATES[i + 1]) for i in range(len(STATES) - 1)}
JUDGE_VERDICTS = {"PASS", "FAIL", "UNKNOWN"}


def stable_json_sha256(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def bytes_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_requirement_registry(registry: Any) -> list[str]:
    """Validate Requirement → Enforcement → Evidence → Gate traceability."""
    errors: list[str] = []
    if not isinstance(registry, list) or not registry:
        return ["CONTENT_ARCH_REQUIREMENT_REGISTRY_MISSING"]
    seen: set[str] = set()
    required = {
        "requirement_id",
        "severity",
        "authority_source",
        "subject",
        "enforcement_class",
        "enforcer",
        "evidence_required",
        "failure_code",
        "gate_effect",
    }
    for index, item in enumerate(registry):
        label = f"CONTENT_ARCH_REQUIREMENT[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{label}_NOT_MAPPING")
            continue
        missing = sorted(k for k in required if item.get(k) in (None, "", []))
        errors.extend(f"{label}_FIELD_MISSING:{key}" for key in missing)
        rid = item.get("requirement_id")
        if not isinstance(rid, str) or not rid.startswith("REQ-"):
            errors.append(f"{label}_ID_INVALID:{rid!r}")
        elif rid in seen:
            errors.append(f"CONTENT_ARCH_REQUIREMENT_ID_DUPLICATE:{rid}")
        else:
            seen.add(rid)
        cls = item.get("enforcement_class")
        if cls not in ENFORCEMENT_CLASSES:
            errors.append(f"CONTENT_ARCH_ENFORCEMENT_CLASS_INVALID:{rid}:{cls}")
        severity = item.get("severity")
        if severity not in {"HARD", "ADVISORY"}:
            errors.append(f"CONTENT_ARCH_REQUIREMENT_SEVERITY_INVALID:{rid}:{severity}")
        if severity == "HARD" and cls == "AUTHOR_SELF_CHECK":
            errors.append(f"CONTENT_ARCH_HARD_REQUIREMENT_AUTHOR_ONLY:{rid}")
        evidence = item.get("evidence_required")
        if not isinstance(evidence, list) or not evidence or not all(isinstance(x, str) and x.strip() for x in evidence):
            errors.append(f"CONTENT_ARCH_REQUIREMENT_EVIDENCE_INVALID:{rid}")
        code = item.get("failure_code")
        if not isinstance(code, str) or not code.startswith("CONTENT_"):
            errors.append(f"CONTENT_ARCH_REQUIREMENT_FAILURE_CODE_INVALID:{rid}:{code!r}")
    return errors


def requirement_ids(registry: Any, *, enforcement_class: str | None = None, severity: str | None = None) -> set[str]:
    out: set[str] = set()
    if not isinstance(registry, list):
        return out
    for item in registry:
        if not isinstance(item, dict):
            continue
        if enforcement_class is not None and item.get("enforcement_class") != enforcement_class:
            continue
        if severity is not None and item.get("severity") != severity:
            continue
        rid = item.get("requirement_id")
        if isinstance(rid, str) and rid.startswith("REQ-"):
            out.add(rid)
    return out


def validate_state_transition(current: str, target: str) -> list[str]:
    if current not in STATES or target not in STATES:
        return [f"CONTENT_ARCH_STATE_UNKNOWN:{current}->{target}"]
    if (current, target) not in ALLOWED_TRANSITIONS:
        return [f"CONTENT_ARCH_STATE_TRANSITION_FORBIDDEN:{current}->{target}"]
    return []


def next_state(current: str) -> str | None:
    try:
        idx = STATES.index(current)
    except ValueError:
        return None
    return STATES[idx + 1] if idx + 1 < len(STATES) else None


def _expected_trace_pairs(final_state: str) -> list[tuple[str, str]]:
    """Return the complete adjacent transition prefix ending at final_state."""
    if final_state not in STATES:
        return []
    end = STATES.index(final_state)
    return [(STATES[i], STATES[i + 1]) for i in range(end)]


def validate_state_trace(trace: Any, *, final_state: str) -> list[str]:
    """Validate a durable, hash-addressed transition trace.

    The trace is not a second state machine. It is evidence that the canonical
    state machine was traversed only through declared adjacent transitions. Every
    record contains exact from/to states, non-empty evidence refs and a digest of
    the record bytes-as-data (excluding the digest field).
    """
    errors: list[str] = []
    expected = _expected_trace_pairs(final_state)
    if not expected:
        return [f"CONTENT_ARCH_STATE_TRACE_FINAL_STATE_INVALID:{final_state}"]
    if not isinstance(trace, list):
        return ["CONTENT_ARCH_STATE_TRACE_MISSING"]
    if len(trace) != len(expected):
        errors.append(f"CONTENT_ARCH_STATE_TRACE_LENGTH_DRIFT:{len(trace)}!={len(expected)}")
    actual_pairs: list[tuple[str, str]] = []
    for idx, item in enumerate(trace):
        label = f"CONTENT_ARCH_STATE_TRACE[{idx}]"
        if not isinstance(item, dict):
            errors.append(f"{label}_NOT_MAPPING")
            continue
        current = item.get("from_state")
        target = item.get("to_state")
        actual_pairs.append((str(current), str(target)))
        errors.extend(validate_state_transition(str(current), str(target)))
        refs = item.get("evidence_refs")
        if not isinstance(refs, list) or not refs or not all(isinstance(x, str) and x.strip() for x in refs):
            errors.append(f"{label}_EVIDENCE_REFS_INVALID")
        digest = item.get("transition_digest")
        basis = dict(item)
        basis.pop("transition_digest", None)
        if not isinstance(digest, str) or digest != stable_json_sha256(basis):
            errors.append(f"{label}_DIGEST_DRIFT")
    if actual_pairs != expected:
        errors.append(f"CONTENT_ARCH_STATE_TRACE_SEQUENCE_DRIFT:expected={expected}:actual={actual_pairs}")
    return errors


def validate_judge_verdict(item: Any, *, blocking: bool = True, judge_name: str = "judge") -> list[str]:
    errors: list[str] = []
    if not isinstance(item, dict):
        return [f"CONTENT_ARCH_JUDGE_VERDICT_INVALID:{judge_name}"]
    rid = item.get("requirement_id")
    verdict = item.get("verdict")
    refs = item.get("evidence_refs")
    if not isinstance(rid, str) or not rid.startswith("REQ-"):
        errors.append(f"CONTENT_ARCH_JUDGE_REQUIREMENT_INVALID:{judge_name}:{rid!r}")
    if verdict not in JUDGE_VERDICTS:
        errors.append(f"CONTENT_ARCH_JUDGE_VERDICT_VALUE_INVALID:{judge_name}:{verdict!r}")
    if not isinstance(item.get("claim"), str) or not item.get("claim", "").strip():
        errors.append(f"CONTENT_ARCH_JUDGE_CLAIM_MISSING:{judge_name}:{rid}")
    if not isinstance(refs, list) or not refs or not all(isinstance(x, str) and x.strip() for x in refs):
        errors.append(f"CONTENT_ARCH_JUDGE_EVIDENCE_MISSING:{judge_name}:{rid}")
    if not isinstance(item.get("reason"), str) or not item.get("reason", "").strip():
        errors.append(f"CONTENT_ARCH_JUDGE_REASON_MISSING:{judge_name}:{rid}")
    confidence = item.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= float(confidence) <= 1:
        errors.append(f"CONTENT_ARCH_JUDGE_CONFIDENCE_INVALID:{judge_name}:{rid}")
    if blocking and verdict in {"FAIL", "UNKNOWN"}:
        errors.append(f"CONTENT_ARCH_JUDGE_BLOCKING_{verdict}:{judge_name}:{rid}")
    return errors


def _resolve_fact_path(facts: Any, path: str) -> tuple[bool, Any]:
    current = facts
    for raw in path.split("."):
        if raw == "":
            return False, None
        if isinstance(current, dict) and raw in current:
            current = current[raw]
            continue
        if isinstance(current, list) and raw.isdigit():
            idx = int(raw)
            if 0 <= idx < len(current):
                current = current[idx]
                continue
        return False, None
    return True, current


def validate_evidence_refs(refs: Any, *, events: list[dict[str, Any]], facts: dict[str, Any],
                           source_ids: set[str], final_texts: list[str]) -> list[str]:
    """Resolve semantic evidence refs against actual inputs, not mere strings."""
    errors: list[str] = []
    if not isinstance(refs, list) or not refs:
        return ["CONTENT_ARCH_EVIDENCE_REFS_MISSING"]
    event_ids = {str(x.get("event_id")) for x in events if isinstance(x, dict) and x.get("event_id")}
    corpus = "\n".join(final_texts)
    for raw in refs:
        if not isinstance(raw, str) or not raw.strip():
            errors.append(f"CONTENT_ARCH_EVIDENCE_REF_INVALID:{raw!r}")
            continue
        if raw.startswith("event:"):
            eid = raw[len("event:"):]
            if eid not in event_ids:
                errors.append(f"CONTENT_ARCH_EVIDENCE_REF_EVENT_UNKNOWN:{eid}")
        elif raw.startswith("fact:"):
            path = raw[len("fact:"):]
            ok, _ = _resolve_fact_path(facts, path)
            if not ok:
                errors.append(f"CONTENT_ARCH_EVIDENCE_REF_FACT_UNKNOWN:{path}")
        elif raw.startswith("source:"):
            sid = raw[len("source:"):]
            if sid not in source_ids:
                errors.append(f"CONTENT_ARCH_EVIDENCE_REF_SOURCE_UNKNOWN:{sid}")
        elif raw.startswith("exact-text:"):
            span = raw[len("exact-text:"):]
            if not span or corpus.count(span) == 0:
                errors.append(f"CONTENT_ARCH_EVIDENCE_REF_TEXT_UNKNOWN:{span}")
        else:
            errors.append(f"CONTENT_ARCH_EVIDENCE_REF_SCHEME_INVALID:{raw}")
    return errors


def validate_event_stream(events: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(events, list) or not events:
        return ["CONTENT_ARCH_EVENT_STREAM_MISSING"]
    seen: set[str] = set()
    for index, event in enumerate(events):
        label = f"CONTENT_ARCH_EVENT[{index}]"
        if not isinstance(event, dict):
            errors.append(f"{label}_NOT_MAPPING")
            continue
        eid = event.get("event_id")
        etype = event.get("type")
        if not isinstance(eid, str) or not eid.strip():
            errors.append(f"{label}_ID_INVALID")
        elif eid in seen:
            errors.append(f"CONTENT_ARCH_EVENT_ID_DUPLICATE:{eid}")
        else:
            seen.add(eid)
        if etype not in SCRIPT_EVENT_TYPES:
            errors.append(f"{label}_TYPE_INVALID:{etype}")
        if not isinstance(event.get("cycle_id"), str) or not event.get("cycle_id", "").strip():
            errors.append(f"{label}_CYCLE_MISSING")
        if etype in TEXT_EVENT_TYPES and (not isinstance(event.get("text"), str) or not event.get("text", "").strip()):
            errors.append(f"{label}_TEXT_MISSING")
        if etype in {"RESOURCE_SHOW", "RESOURCE_HIDE_OR_MASK"} and not isinstance(event.get("resource_id"), str):
            errors.append(f"{label}_RESOURCE_ID_MISSING")
        if etype == "BOARD_ADD" and (not isinstance(event.get("board_delta_id"), str) or not isinstance(event.get("text"), str)):
            errors.append(f"{label}_BOARD_BINDING_MISSING")
        if etype == "PRACTICE" and not isinstance(event.get("practice_id"), str):
            errors.append(f"{label}_PRACTICE_ID_MISSING")
        if etype == "FORMULA_ORALIZE" and not isinstance(event.get("formula_id"), str):
            errors.append(f"{label}_FORMULA_ID_MISSING")
        releases = event.get("releases", [])
        if not isinstance(releases, list) or not all(isinstance(x, str) and x.strip() for x in releases):
            errors.append(f"{label}_RELEASES_INVALID")
        timing = event.get("timing")
        if timing is not None:
            if not isinstance(timing, dict):
                errors.append(f"{label}_TIMING_INVALID")
            else:
                for key in ("speech_seconds", "action_seconds", "wait_seconds"):
                    value = timing.get(key, 0)
                    if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                        errors.append(f"{label}_TIMING_INVALID:{key}")
    return errors


def derive_script_facts(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive actual classroom facts from the final event stream only."""
    sequence_by_cycle: dict[str, list[str]] = defaultdict(list)
    first_release: dict[str, dict[str, Any]] = {}
    resource_shows: list[dict[str, Any]] = []
    resource_masks: list[dict[str, Any]] = []
    board_adds: list[dict[str, Any]] = []
    practices: list[dict[str, Any]] = []
    formulas: list[dict[str, Any]] = []
    spoken: list[dict[str, Any]] = []
    student_responses: list[dict[str, Any]] = []
    scaffolds: list[dict[str, Any]] = []
    elapsed = 0.0
    for ordinal, event in enumerate(events):
        eid = str(event.get("event_id"))
        etype = str(event.get("type"))
        cycle = str(event.get("cycle_id"))
        sequence_by_cycle[cycle].append(etype)
        for kid in event.get("releases", []) or []:
            first_release.setdefault(str(kid), {"event_id": eid, "event_type": etype, "cycle_id": cycle, "ordinal": ordinal})
        record = {"event_id": eid, "cycle_id": cycle, "ordinal": ordinal}
        if etype == "RESOURCE_SHOW":
            resource_shows.append({**record, "resource_id": event.get("resource_id")})
        elif etype == "RESOURCE_HIDE_OR_MASK":
            resource_masks.append({**record, "resource_id": event.get("resource_id")})
        elif etype == "BOARD_ADD":
            board_adds.append({**record, "board_delta_id": event.get("board_delta_id"), "text": event.get("text")})
        elif etype == "PRACTICE":
            practices.append({**record, "practice_id": event.get("practice_id"), "text": event.get("text")})
        elif etype == "FORMULA_ORALIZE":
            formulas.append({**record, "formula_id": event.get("formula_id"), "text": event.get("text")})
        if etype in TEXT_EVENT_TYPES:
            spoken.append({**record, "type": etype, "text": event.get("text", "")})
        if etype == "STUDENT_RESPONSE":
            student_responses.append({**record, "text": event.get("text", "")})
        if etype == "SCAFFOLD":
            scaffolds.append({**record, "text": event.get("text", "")})
        timing = event.get("timing") or {}
        if isinstance(timing, dict):
            elapsed += sum(float(timing.get(k, 0) or 0) for k in ("speech_seconds", "action_seconds", "wait_seconds"))
    spoken_text = "\n".join(str(item.get("text") or "") for item in spoken)
    result = {
        "schema_id": "teaching-demo-script-facts-v1",
        "event_count": len(events),
        "cycle_event_sequence": dict(sequence_by_cycle),
        "first_release": first_release,
        "resource_shows": resource_shows,
        "resource_masks": resource_masks,
        "board_adds": board_adds,
        "practice_events": practices,
        "formula_oralizations": formulas,
        "student_responses": student_responses,
        "scaffolds": scaffolds,
        "spoken_event_ids": [x["event_id"] for x in spoken],
        "spoken_text_sha256": bytes_sha256(spoken_text.encode("utf-8")),
        "elapsed_seconds_from_events": elapsed,
    }
    result["facts_sha256"] = stable_json_sha256(result)
    return result


def validate_reference_candidate_comparison(value: Any, *, minimum: int = 2) -> list[str]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return ["CONTENT_ARCH_REFERENCE_COMPARISON_MISSING"]
    candidates = value.get("candidates")
    selected = value.get("selected_case_receipt")
    rationale = value.get("selection_rationale")
    transfer = value.get("transfer_mapping")
    if not isinstance(candidates, list) or len(candidates) < minimum:
        errors.append(f"CONTENT_ARCH_REFERENCE_CANDIDATES_TOO_FEW:{0 if not isinstance(candidates, list) else len(candidates)}<{minimum}")
        candidates = []
    required = {
        "case_receipt", "lesson_mechanism", "evidence_type", "knowledge_formation_pattern",
        "student_task_type", "resource_interaction", "misconception_structure", "reasoning_pattern",
        "classroom_enactment_pattern",
    }
    candidate_paths: set[str] = set()
    for idx, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            errors.append(f"CONTENT_ARCH_REFERENCE_CANDIDATE_INVALID:{idx}")
            continue
        for key in sorted(required):
            if candidate.get(key) in (None, "", []):
                errors.append(f"CONTENT_ARCH_REFERENCE_CANDIDATE_FIELD_MISSING:{idx}:{key}")
        path = candidate.get("case_receipt")
        if isinstance(path, str):
            candidate_paths.add(path)
    if not isinstance(selected, str) or selected not in candidate_paths:
        errors.append("CONTENT_ARCH_REFERENCE_SELECTED_NOT_IN_CANDIDATES")
    if not isinstance(rationale, str) or not rationale.strip():
        errors.append("CONTENT_ARCH_REFERENCE_SELECTION_RATIONALE_MISSING")
    if not isinstance(transfer, dict) or not transfer:
        errors.append("CONTENT_ARCH_REFERENCE_TRANSFER_MAPPING_MISSING")
    return errors


def validate_work_packet(packet: Any, *, known_requirement_ids: set[str] | None = None) -> list[str]:
    required = (
        "main_sha", "current_state", "task_schema", "requirement_ids", "source_refs",
        "reference_mechanisms", "allowed_writes", "forbidden_writes", "expected_evidence",
        "next_gate", "state_trace",
    )
    if not isinstance(packet, dict):
        return ["CONTENT_ARCH_WORK_PACKET_MISSING"]
    errors: list[str] = []
    for key in required:
        if packet.get(key) in (None, "", []):
            errors.append(f"CONTENT_ARCH_WORK_PACKET_FIELD_MISSING:{key}")
    reqs = packet.get("requirement_ids")
    if not isinstance(reqs, list) or not reqs or not all(isinstance(x, str) and x.startswith("REQ-") for x in reqs):
        errors.append("CONTENT_ARCH_WORK_PACKET_REQUIREMENTS_INVALID")
    elif known_requirement_ids is not None:
        unknown = sorted(set(reqs) - known_requirement_ids)
        if unknown:
            errors.append(f"CONTENT_ARCH_WORK_PACKET_REQUIREMENT_UNKNOWN:{unknown}")
    state = packet.get("current_state")
    if state not in STATES:
        errors.append(f"CONTENT_ARCH_WORK_PACKET_STATE_INVALID:{state}")
    else:
        errors.extend(validate_state_trace(packet.get("state_trace"), final_state=state))
    return errors


def make_machine_gate_receipt(*, source_commit: str, bindings: dict[str, str], requirement_ids: set[str]) -> dict[str, Any]:
    receipt = {
        "schema_id": "teaching-demo-machine-gate-v1",
        "state": "MACHINE_GATED",
        "source_commit": source_commit,
        "bindings": dict(sorted(bindings.items())),
        "requirements": [{"requirement_id": rid, "verdict": "PASS"} for rid in sorted(requirement_ids)],
    }
    receipt["receipt_digest"] = stable_json_sha256(receipt)
    return receipt


def validate_machine_gate_receipt(receipt: Any, *, source_commit: str, bindings: dict[str, str],
                                  requirement_ids: set[str]) -> list[str]:
    errors: list[str] = []
    if not isinstance(receipt, dict):
        return ["CONTENT_MACHINE_GATE_RECEIPT_MISSING"]
    if receipt.get("schema_id") != "teaching-demo-machine-gate-v1":
        errors.append("CONTENT_MACHINE_GATE_SCHEMA_INVALID")
    if receipt.get("state") != "MACHINE_GATED":
        errors.append("CONTENT_MACHINE_GATE_STATE_INVALID")
    if receipt.get("source_commit") != source_commit:
        errors.append("CONTENT_MACHINE_GATE_SOURCE_COMMIT_DRIFT")
    if receipt.get("bindings") != dict(sorted(bindings.items())):
        errors.append("CONTENT_MACHINE_GATE_BINDING_STALE")
    reqs = receipt.get("requirements")
    if not isinstance(reqs, list):
        errors.append("CONTENT_MACHINE_GATE_REQUIREMENTS_INVALID")
    else:
        actual: set[str] = set()
        for item in reqs:
            if not isinstance(item, dict) or item.get("verdict") != "PASS" or not isinstance(item.get("requirement_id"), str):
                errors.append("CONTENT_MACHINE_GATE_REQUIREMENT_ITEM_INVALID")
                continue
            actual.add(item["requirement_id"])
        if actual != requirement_ids:
            errors.append(f"CONTENT_MACHINE_GATE_REQUIREMENT_COVERAGE_DRIFT:expected={sorted(requirement_ids)} actual={sorted(actual)}")
    declared_digest = receipt.get("receipt_digest")
    without = dict(receipt)
    without.pop("receipt_digest", None)
    if declared_digest != stable_json_sha256(without):
        errors.append("CONTENT_MACHINE_GATE_RECEIPT_DIGEST_DRIFT")
    return errors


def content_addressed_gate_record(*, source_commit: str, contract_sha256: str, checker_sha256: str,
                                  input_digests: dict[str, str], verdict_payload: Any) -> dict[str, Any]:
    record = {
        "source_commit": source_commit,
        "contract_sha256": contract_sha256,
        "checker_sha256": checker_sha256,
        "input_digests": dict(sorted(input_digests.items())),
        "verdict_digest": stable_json_sha256(verdict_payload),
    }
    record["record_digest"] = stable_json_sha256(record)
    return record


def gate_record_is_stale(record: Any, *, source_commit: str, contract_sha256: str, checker_sha256: str,
                         input_digests: dict[str, str]) -> bool:
    if not isinstance(record, dict):
        return True
    expected = {
        "source_commit": source_commit,
        "contract_sha256": contract_sha256,
        "checker_sha256": checker_sha256,
        "input_digests": dict(sorted(input_digests.items())),
    }
    return any(record.get(key) != value for key, value in expected.items())


def _trace_record(current: str, target: str, ref: str) -> dict[str, Any]:
    item = {"from_state": current, "to_state": target, "evidence_refs": [ref]}
    item["transition_digest"] = stable_json_sha256(item)
    return item


def selftest() -> None:
    registry = [{
        "requirement_id": "REQ-STA-001",
        "severity": "HARD",
        "authority_source": "ADR-012",
        "subject": "state",
        "enforcement_class": "MACHINE_DETERMINISTIC",
        "enforcer": "canonical checker",
        "evidence_required": ["state transition"],
        "failure_code": "CONTENT_ARCH_STATE_TRANSITION_FORBIDDEN",
        "gate_effect": "blocks transition",
    }]
    assert validate_requirement_registry(registry) == []
    bad = dict(registry[0]); bad["enforcement_class"] = "AUTHOR_SELF_CHECK"
    assert any("AUTHOR_ONLY" in e for e in validate_requirement_registry([bad]))
    assert validate_state_transition("SCRIPT_BUILT", "SCRIPT_FACTS_DERIVED") == []
    assert validate_state_transition("SCRIPT_BUILT", "SUBMISSION_FROZEN")

    trace = [_trace_record(a, b, f"evidence:{i}") for i, (a, b) in enumerate(_expected_trace_pairs("SUBMISSION_FROZEN"))]
    assert validate_state_trace(trace, final_state="SUBMISSION_FROZEN") == []
    jumped = list(trace)
    jumped[3] = _trace_record("SCRIPT_BUILT", "MACHINE_GATED", "bad-jump")
    assert any("FORBIDDEN" in e or "SEQUENCE_DRIFT" in e for e in validate_state_trace(jumped, final_state="SUBMISSION_FROZEN"))

    events = [
        {"event_id": "E1", "type": "RESOURCE_SHOW", "cycle_id": "C1", "resource_id": "R1", "releases": ["OBS-1"], "timing": {"action_seconds": 1}},
        {"event_id": "E2", "type": "ASK", "cycle_id": "C1", "text": "你观察到什么？", "releases": [], "timing": {"speech_seconds": 1}},
        {"event_id": "E3", "type": "STUDENT_RESPONSE", "cycle_id": "C1", "text": "我看到了A。", "releases": ["K1"], "timing": {"speech_seconds": 1}},
        {"event_id": "E4", "type": "FORMULA_ORALIZE", "cycle_id": "C1", "formula_id": "F1", "text": "F比q", "releases": [], "timing": {"speech_seconds": 1}},
        {"event_id": "E5", "type": "BOARD_ADD", "cycle_id": "C1", "board_delta_id": "B1", "text": "结论", "releases": [], "timing": {"action_seconds": 1}},
    ]
    assert validate_event_stream(events) == []
    facts = derive_script_facts(events)
    assert facts["first_release"]["K1"]["event_id"] == "E3"
    assert validate_evidence_refs(
        ["event:E3", "fact:first_release.K1.event_id", "source:S1", "exact-text:我看到了A"],
        events=events, facts=facts, source_ids={"S1"}, final_texts=["我看到了A"],
    ) == []
    verdict = {
        "requirement_id": "REQ-SCI-001", "verdict": "PASS", "claim": "evidence visible",
        "evidence_refs": ["event:E1"], "reason": "visible", "confidence": 0.9,
    }
    assert validate_judge_verdict(verdict) == []
    unknown = dict(verdict); unknown["verdict"] = "UNKNOWN"
    assert any("BLOCKING_UNKNOWN" in e for e in validate_judge_verdict(unknown))

    packet = {
        "main_sha": "0" * 40,
        "current_state": "SUBMISSION_FROZEN",
        "task_schema": "test",
        "requirement_ids": ["REQ-STA-001"],
        "source_refs": ["S1"],
        "reference_mechanisms": ["M1"],
        "allowed_writes": ["case"],
        "forbidden_writes": ["pdf"],
        "expected_evidence": ["freeze"],
        "next_gate": "HUMAN_ACCEPTED",
        "state_trace": trace,
    }
    assert validate_work_packet(packet, known_requirement_ids={"REQ-STA-001"}) == []

    bindings = {"events_sha256": "a", "script_facts_file_sha256": "b"}
    receipt = make_machine_gate_receipt(source_commit="0" * 40, bindings=bindings, requirement_ids={"REQ-STA-001"})
    assert validate_machine_gate_receipt(receipt, source_commit="0" * 40, bindings=bindings, requirement_ids={"REQ-STA-001"}) == []
    stale = dict(receipt); stale["bindings"] = {"events_sha256": "changed"}
    assert any("STALE" in e for e in validate_machine_gate_receipt(stale, source_commit="0" * 40,
                                                                    bindings=bindings, requirement_ids={"REQ-STA-001"}))
