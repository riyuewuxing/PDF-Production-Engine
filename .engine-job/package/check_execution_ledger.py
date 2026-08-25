#!/usr/bin/env python3
"""Validate append-only execution ledgers and derive lifecycle/efficiency projections."""
from __future__ import annotations
import argparse
from pathlib import Path
import tempfile
from typing import Any
import yaml

from artifact_foundation import ROOT, load_yaml, parse_iso8601, validate_binding

CONTRACT = Path("production/contracts/execution-ledger-v1.yaml")


def derive(events: list[dict]) -> dict[str, int]:
    """Derive process effort from facts; failed builds still count as build attempts."""
    attempts: dict[str, set[str]] = {}
    build_count = 0
    final_render_count = 0
    review_reject_count = 0
    for event in events:
        typ = event.get("type")
        attempt = event.get("attempt_id")
        if typ == "BUILD_STARTED":
            build_count += 1
        elif typ == "FINAL_RENDER_COMPLETED":
            final_render_count += 1
        elif typ == "HUMAN_REVIEW_REJECTED":
            review_reject_count += 1
        if isinstance(attempt, str) and attempt:
            attempts.setdefault(attempt, set()).add(str(typ))
    cycles = sum(
        1
        for types in attempts.values()
        if "FINAL_RENDER_COMPLETED" in types
        and ({"HUMAN_REVIEW_ACCEPTED", "HUMAN_REVIEW_REJECTED"} & types)
    )
    return {
        "generation_review_cycles": cycles,
        "build_count": build_count,
        "final_render_count": final_render_count,
        "review_reject_count": review_reject_count,
    }


def project_lifecycle(events: list[dict], contract: dict) -> tuple[str | None, list[str]]:
    errors: list[str] = []
    allowed = list(contract.get("lifecycle_transition_types") or [])
    transitions = [str(e.get("type")) for e in events if isinstance(e, dict) and e.get("type") in allowed]
    if not transitions:
        return None, ["ledger: at least JOB_CREATED lifecycle transition is required"]
    if len(transitions) != len(set(transitions)):
        errors.append("ledger: lifecycle transition duplicates are forbidden")
    expected = allowed[: len(transitions)]
    if transitions != expected:
        errors.append("ledger: lifecycle transitions must be an ordered prefix: " + " -> ".join(allowed))
    return transitions[-1], errors


def _attempt_terminal(types: list[str]) -> str | None:
    for typ in reversed(types):
        if typ in {"BUILD_FAILED", "MACHINE_VERIFICATION_FAILED", "HUMAN_REVIEW_ACCEPTED", "HUMAN_REVIEW_REJECTED"}:
            return typ
    return None


def validate_attempt_protocol(events: list[dict], contract: dict) -> list[str]:
    protocol = contract.get("attempt_protocol")
    if not isinstance(protocol, dict):
        return []
    errors: list[str] = []
    attempt_types = set(contract.get("attempt_event_types") or [])
    if not attempt_types:
        return ["ledger contract: attempt_event_types must be defined"]
    grouped: dict[str, list[tuple[int, str]]] = {}
    order: list[str] = []
    current: str | None = None
    closed: set[str] = set()
    for idx, event in enumerate(events):
        typ = event.get("type")
        if typ not in attempt_types:
            continue
        attempt = event.get("attempt_id")
        if not isinstance(attempt, str) or not attempt.strip():
            continue
        attempt = attempt.strip()
        if current is None:
            current = attempt; order.append(attempt)
        elif attempt != current:
            if attempt in grouped:
                errors.append(f"attempt {attempt}: interleaved attempt events are forbidden")
            previous_types = [t for _, t in grouped.get(current, [])]
            terminal = _attempt_terminal(previous_types)
            if terminal is None:
                errors.append(f"attempt {current}: later attempt {attempt} started before a terminal result")
            elif terminal == "HUMAN_REVIEW_ACCEPTED":
                errors.append(f"attempt {current}: HUMAN_REVIEW_ACCEPTED must terminate the job attempt sequence")
            closed.add(current); current = attempt
            if attempt not in order: order.append(attempt)
        if attempt in closed:
            errors.append(f"attempt {attempt}: event appeared after a later attempt had started")
        grouped.setdefault(attempt, []).append((idx, str(typ)))
    visual_mode_observed = any("FINAL_RENDER_COMPLETED" in [typ for _, typ in grouped.get(attempt, [])] for attempt in order)
    for attempt in order:
        sequence = grouped.get(attempt, []); types = [typ for _, typ in sequence]; label = f"attempt {attempt}"
        if not types: continue
        if types[0] != "BUILD_STARTED": errors.append(f"{label}: first attempt event must be BUILD_STARTED, got {types[0]}")
        for typ in set(types):
            if types.count(typ) > 1: errors.append(f"{label}: duplicate attempt stage forbidden: {typ}")
        build_results = [x for x in ("BUILD_COMPLETED", "BUILD_FAILED") if x in types]
        if len(build_results) > 1: errors.append(f"{label}: BUILD_COMPLETED and BUILD_FAILED are mutually exclusive")
        machine_results = [x for x in ("MACHINE_VERIFICATION_PASSED", "MACHINE_VERIFICATION_FAILED") if x in types]
        if len(machine_results) > 1: errors.append(f"{label}: MACHINE_VERIFICATION_PASSED and MACHINE_VERIFICATION_FAILED are mutually exclusive")
        review_results = [x for x in ("HUMAN_REVIEW_ACCEPTED", "HUMAN_REVIEW_REJECTED") if x in types]
        if len(review_results) > 1: errors.append(f"{label}: HUMAN review result must be exactly one outcome per reviewed attempt")
        pos = {typ: types.index(typ) for typ in types}
        if any(x in types for x in ("BUILD_COMPLETED", "BUILD_FAILED")) and "BUILD_STARTED" not in types:
            errors.append(f"{label}: build result requires BUILD_STARTED")
        if any(x in types for x in ("MACHINE_VERIFICATION_PASSED", "MACHINE_VERIFICATION_FAILED")):
            if "BUILD_COMPLETED" not in types: errors.append(f"{label}: machine verification requires BUILD_COMPLETED")
            elif pos["BUILD_COMPLETED"] > min(pos[x] for x in machine_results): errors.append(f"{label}: machine verification must occur after BUILD_COMPLETED")
        if "FINAL_RENDER_COMPLETED" in types:
            if "MACHINE_VERIFICATION_PASSED" not in types: errors.append(f"{label}: FINAL_RENDER_COMPLETED requires MACHINE_VERIFICATION_PASSED")
            elif pos["MACHINE_VERIFICATION_PASSED"] > pos["FINAL_RENDER_COMPLETED"]: errors.append(f"{label}: FINAL_RENDER_COMPLETED must occur after MACHINE_VERIFICATION_PASSED")
        if review_results:
            review = review_results[0]
            if "MACHINE_VERIFICATION_PASSED" not in types: errors.append(f"{label}: {review} requires MACHINE_VERIFICATION_PASSED")
            elif pos["MACHINE_VERIFICATION_PASSED"] > pos[review]: errors.append(f"{label}: HUMAN review must occur after MACHINE_VERIFICATION_PASSED")
            if visual_mode_observed and protocol.get("once_any_final_render_observed_all_reviewed_attempts_require_own_final_render") is True and "FINAL_RENDER_COMPLETED" not in types:
                errors.append(f"{label}: reviewed visual job attempt requires its own FINAL_RENDER_COMPLETED")
            if "FINAL_RENDER_COMPLETED" in types and pos["FINAL_RENDER_COMPLETED"] > pos[review]: errors.append(f"{label}: visual HUMAN review must occur after FINAL_RENDER_COMPLETED")
        terminal = _attempt_terminal(types)
        if terminal is not None and pos[terminal] != len(types) - 1: errors.append(f"{label}: no attempt event may follow terminal result {terminal}")
        if "BUILD_FAILED" in types:
            forbidden = set(types) & {"BUILD_COMPLETED", "MACHINE_VERIFICATION_PASSED", "MACHINE_VERIFICATION_FAILED", "FINAL_RENDER_COMPLETED", "HUMAN_REVIEW_ACCEPTED", "HUMAN_REVIEW_REJECTED"}
            if forbidden: errors.append(f"{label}: BUILD_FAILED attempt cannot continue: {sorted(forbidden)}")
        if "MACHINE_VERIFICATION_FAILED" in types:
            forbidden = set(types) & {"MACHINE_VERIFICATION_PASSED", "FINAL_RENDER_COMPLETED", "HUMAN_REVIEW_ACCEPTED", "HUMAN_REVIEW_REJECTED"}
            if forbidden: errors.append(f"{label}: MACHINE_VERIFICATION_FAILED attempt cannot continue: {sorted(forbidden)}")
    return errors


def validate(data: dict, root: Path = ROOT, contract_path: Path | None = None) -> list[str]:
    errors: list[str] = []; contract_path = contract_path or root / CONTRACT
    try: contract = load_yaml(contract_path)
    except Exception as exc: return [f"contract: {exc}"]
    if data.get("contract") != CONTRACT.as_posix(): errors.append(f"ledger: contract must be {CONTRACT.as_posix()}")
    if not isinstance(data.get("job_id"), str) or not data["job_id"].strip(): errors.append("ledger: job_id is required")
    events = data.get("events")
    if not isinstance(events, list): return errors + ["ledger: events must be a list"]
    if not events: errors.append("ledger: a real ledger must contain JOB_CREATED")
    allowed = set(contract.get("event_types") or []); attempt_types = set(contract.get("attempt_event_types") or [])
    seen_ids: set[str] = set(); expected_seq = 1
    for idx, event in enumerate(events):
        label = f"event[{idx}]"
        if not isinstance(event, dict): errors.append(f"{label}: must be a mapping"); expected_seq += 1; continue
        if event.get("seq") != expected_seq: errors.append(f"{label}: seq must be {expected_seq}")
        expected_seq += 1
        event_id = event.get("event_id")
        if not isinstance(event_id, str) or not event_id: errors.append(f"{label}: event_id is required")
        elif event_id in seen_ids: errors.append(f"{label}: duplicate event_id {event_id}")
        else: seen_ids.add(event_id)
        typ = event.get("type")
        if typ not in allowed: errors.append(f"{label}: unsupported type {typ!r}")
        if not parse_iso8601(event.get("occurred_at")): errors.append(f"{label}: occurred_at must be ISO-8601")
        if not isinstance(event.get("actor"), str) or not event.get("actor"): errors.append(f"{label}: actor is required")
        if typ in attempt_types and (not isinstance(event.get("attempt_id"), str) or not event.get("attempt_id", "").strip()): errors.append(f"{label}: attempt_id is required for {typ}")
        bindings = event.get("bindings") or []
        if not isinstance(bindings, list): errors.append(f"{label}: bindings must be a list")
        else:
            for bidx, binding in enumerate(bindings): errors.extend(validate_binding(root, binding, f"{label}.bindings[{bidx}]"))
    normalized_events = [x for x in events if isinstance(x, dict)]
    errors.extend(validate_attempt_protocol(normalized_events, contract))
    lifecycle_state, lifecycle_errors = project_lifecycle(normalized_events, contract); errors.extend(lifecycle_errors)
    actual = derive(normalized_events); declared = data.get("derived")
    if declared is not None:
        if not isinstance(declared, dict): errors.append("ledger: derived must be a mapping when present")
        else:
            for key, value in actual.items():
                if declared.get(key) != value: errors.append(f"ledger: derived.{key} must equal checker-derived {value}")
            if declared.get("artifact_state") != lifecycle_state: errors.append(f"ledger: derived.artifact_state must equal checker-projected {lifecycle_state}")
    return errors


def selftest() -> int:
    with tempfile.TemporaryDirectory(prefix="qz-ledger-") as tmp:
        root = Path(tmp); (root / "production/contracts").mkdir(parents=True)
        (root / CONTRACT).write_text(
            "version: 1\n"
            "lifecycle_transition_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\n"
            "event_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED, BUILD_STARTED, BUILD_COMPLETED, BUILD_FAILED, MACHINE_VERIFICATION_PASSED, MACHINE_VERIFICATION_FAILED, FINAL_RENDER_COMPLETED, HUMAN_REVIEW_ACCEPTED, HUMAN_REVIEW_REJECTED]\n"
            "attempt_event_types: [BUILD_STARTED, BUILD_COMPLETED, BUILD_FAILED, MACHINE_VERIFICATION_PASSED, MACHINE_VERIFICATION_FAILED, FINAL_RENDER_COMPLETED, HUMAN_REVIEW_ACCEPTED, HUMAN_REVIEW_REJECTED]\n"
            "attempt_protocol:\n  start: BUILD_STARTED\n  once_any_final_render_observed_all_reviewed_attempts_require_own_final_render: true\n", encoding="utf-8")
        good = {"contract": CONTRACT.as_posix(), "job_id": "synthetic", "events": [
            {"seq": 1, "event_id": "e1", "occurred_at": "2026-01-01T00:00:00Z", "type": "JOB_CREATED", "actor": "ChatGPT"},
            {"seq": 2, "event_id": "e2", "occurred_at": "2026-01-01T00:00:01Z", "type": "INPUTS_LOCKED", "actor": "ChatGPT"},
            {"seq": 3, "event_id": "e3", "occurred_at": "2026-01-01T00:00:02Z", "type": "BUILD_STARTED", "actor": "Engine", "attempt_id": "a1"},
            {"seq": 4, "event_id": "e4", "occurred_at": "2026-01-01T00:00:03Z", "type": "BUILD_COMPLETED", "actor": "Engine", "attempt_id": "a1"},
            {"seq": 5, "event_id": "e5", "occurred_at": "2026-01-01T00:00:04Z", "type": "MACHINE_VERIFICATION_PASSED", "actor": "Engine", "attempt_id": "a1"},
            {"seq": 6, "event_id": "e6", "occurred_at": "2026-01-01T00:00:05Z", "type": "FINAL_RENDER_COMPLETED", "actor": "Engine", "attempt_id": "a1"},
            {"seq": 7, "event_id": "e7", "occurred_at": "2026-01-01T00:00:06Z", "type": "HUMAN_REVIEW_REJECTED", "actor": "ChatGPT", "attempt_id": "a1"},
            {"seq": 8, "event_id": "e8", "occurred_at": "2026-01-01T00:00:07Z", "type": "BUILD_STARTED", "actor": "Engine", "attempt_id": "a2"},
            {"seq": 9, "event_id": "e9", "occurred_at": "2026-01-01T00:00:08Z", "type": "BUILD_FAILED", "actor": "Engine", "attempt_id": "a2"}],
            "derived": {"artifact_state": "INPUTS_LOCKED", "generation_review_cycles": 1, "build_count": 2, "final_render_count": 1, "review_reject_count": 1}}
        found = validate(good, root)
        if found: print("FAIL: good ledger rejected", found); return 1
        if derive(good["events"])["build_count"] != 2: print("FAIL: failed build attempt was not counted"); return 1
        bad = yaml.safe_load(yaml.safe_dump(good)); bad["derived"]["generation_review_cycles"] = 0
        if not validate(bad, root): print("FAIL: derived summary drift escaped"); return 1
        bad2 = yaml.safe_load(yaml.safe_dump(good)); bad2["events"][1]["type"] = "BUILT"
        if not validate(bad2, root): print("FAIL: lifecycle skip escaped"); return 1
        bad3 = yaml.safe_load(yaml.safe_dump(good)); bad3["events"][1]["seq"] = 99
        if not validate(bad3, root): print("FAIL: sequence drift escaped"); return 1
        bad_review = yaml.safe_load(yaml.safe_dump(good)); bad_review["events"][4]["type"] = "MACHINE_VERIFICATION_FAILED"
        if not any("cannot continue" in x for x in validate(bad_review, root)): print("FAIL: review after machine failure escaped"); return 1
        interleaved = yaml.safe_load(yaml.safe_dump(good)); interleaved["events"].insert(8, {"seq": 9, "event_id": "ix", "occurred_at": "2026-01-01T00:00:08Z", "type": "FINAL_RENDER_COMPLETED", "actor": "Engine", "attempt_id": "a1"})
        for i, event in enumerate(interleaved["events"], 1): event["seq"] = i
        if not any("interleaved" in x or "after a later attempt" in x for x in validate(interleaved, root)): print("FAIL: interleaved attempts escaped"); return 1
        accepted_then_retry = yaml.safe_load(yaml.safe_dump(good)); accepted_then_retry["events"][6]["type"] = "HUMAN_REVIEW_ACCEPTED"
        if not any("must terminate the job attempt sequence" in x for x in validate(accepted_then_retry, root)): print("FAIL: retry after HUMAN acceptance escaped"); return 1
        transient = {"contract": CONTRACT.as_posix(), "job_id": "transient", "events": [
            {"seq": 1, "event_id": "t1", "occurred_at": "2026-01-01T00:00:00Z", "type": "JOB_CREATED", "actor": "ChatGPT"},
            {"seq": 2, "event_id": "t2", "occurred_at": "2026-01-01T00:00:01Z", "type": "BUILD_STARTED", "actor": "Engine", "attempt_id": "a1"}]}
        if validate(transient, root): print("FAIL: one in-progress final attempt should be valid"); return 1
    print("PASS: execution ledger selftest"); return 0


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--ledger", type=Path); parser.add_argument("--root", type=Path, default=ROOT); parser.add_argument("--selftest", action="store_true"); parser.add_argument("--report", action="store_true"); args = parser.parse_args()
    if args.selftest: return selftest()
    if not args.ledger: parser.error("--ledger or --selftest is required")
    data = load_yaml(args.ledger); errors = validate(data, args.root.resolve())
    if errors:
        print("FAIL: execution ledger")
        for error in errors: print("- " + error)
        return 1
    print("PASS: execution ledger")
    if args.report:
        contract = load_yaml(args.root.resolve() / CONTRACT); state, _ = project_lifecycle([x for x in data.get("events") or [] if isinstance(x, dict)], contract)
        report: dict[str, Any] = {"artifact_state": state, **derive([x for x in data.get("events") or [] if isinstance(x, dict)])}
        print(yaml.safe_dump(report, allow_unicode=True, sort_keys=False).rstrip())
    return 0

if __name__ == "__main__": raise SystemExit(main())
