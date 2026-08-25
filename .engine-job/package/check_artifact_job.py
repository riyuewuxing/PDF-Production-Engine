#!/usr/bin/env python3
"""Fail-closed live validator for the unified Artifact Job lifecycle.

This checker is intentionally about the *current execution package*: repository inputs
must still match current materialized bytes and the durable source snapshot. Historical
audit after repository evolution is a separate concern handled by
`check_artifact_provenance.py`.
"""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path
import tempfile
from typing import Any
import yaml

from artifact_foundation import (
    ROOT,
    artifact_input_fingerprint,
    binding_key,
    is_sha256,
    load_yaml,
    parse_iso8601,
    safe_repo_path,
    sha256_file,
    validate_binding,
)
from check_execution_ledger import validate as validate_ledger, project_lifecycle
from provenance_snapshot import build_snapshot, repository_binding, validate_snapshot_binding, write_snapshot

CONTRACT = Path("production/contracts/artifact-job-v1.yaml")
REGISTRY = Path("production/contracts/module-registry-v1.yaml")
LEDGER_CONTRACT = Path("production/contracts/execution-ledger-v1.yaml")
PROVENANCE_CONTRACT = Path("production/contracts/repository-provenance-snapshot-v1.yaml")
VISUAL_SUFFIXES = {".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"}
VISUAL_KINDS = {"pdf", "docx", "pptx", "visual_document", "final_visual"}


def expected_input_fingerprint(data: dict) -> str:
    provenance = data.get("build_provenance") or {}
    if not isinstance(provenance, dict):
        raise ValueError("build_provenance must be a mapping")
    return artifact_input_fingerprint(
        data.get("module_id"),
        provenance.get("module_contract_binding"),
        provenance.get("builder_binding"),
        provenance.get("runtime_identity"),
        data.get("input_bindings"),
        provenance.get("source_snapshot_binding"),
    )


def _is_visual_output(binding: dict) -> bool:
    path = Path(str(binding.get("path") or ""))
    return str(binding.get("kind") or "").lower() in VISUAL_KINDS or path.suffix.lower() in VISUAL_SUFFIXES


def _binding_set(items: Any) -> set[tuple[str, str, str]]:
    return {binding_key(x) for x in (items or []) if isinstance(x, dict)}


def _event_between(events: list[dict], event_type: str, after_type: str, before_type: str) -> dict | None:
    after_indexes = [i for i, e in enumerate(events) if isinstance(e, dict) and e.get("type") == after_type]
    before_indexes = [i for i, e in enumerate(events) if isinstance(e, dict) and e.get("type") == before_type]
    if not after_indexes or not before_indexes:
        return None
    after_idx = after_indexes[-1]; before_idx = before_indexes[-1]
    matches = [e for i, e in enumerate(events) if after_idx < i < before_idx and isinstance(e, dict) and e.get("type") == event_type]
    return matches[-1] if matches else None


def _latest_event(
    events: list[dict], event_type: str, *, attempt_id: str | None = None,
    bindings_cover: set[tuple[str, str, str]] | None = None,
    bindings_equal: set[tuple[str, str, str]] | None = None,
    required_kind_from: tuple[str, set[tuple[str, str, str]]] | None = None,
) -> dict | None:
    for event in reversed(events):
        if event.get("type") != event_type:
            continue
        if attempt_id is not None and event.get("attempt_id") != attempt_id:
            continue
        ids = _binding_set(event.get("bindings"))
        if bindings_cover is not None and not bindings_cover <= ids:
            continue
        if bindings_equal is not None and ids != bindings_equal:
            continue
        if required_kind_from is not None:
            kind, current_ids = required_kind_from
            event_bindings = [x for x in event.get("bindings") or [] if isinstance(x, dict)]
            if not any(x.get("kind") == kind and binding_key(x) in current_ids for x in event_bindings):
                continue
        return event
    return None


def _require_ledger_evidence(data: dict, contract: dict, ledger: dict, errors: list[str]) -> None:
    state = data.get("state"); states = list(contract.get("states") or [])
    if state not in states:
        return
    state_index = states.index(state)
    events = [x for x in (ledger.get("events") or []) if isinstance(x, dict)]
    rules = contract.get("ledger_evidence_events") or {}

    def active(target: str) -> bool:
        return target in states and state_index >= states.index(target)

    if active("BUILT"):
        rule = rules.get("BUILT") or {}
        if _event_between(events, str(rule.get("required_event")), str(rule.get("must_occur_after_state")), "BUILT") is None:
            errors.append("job: BUILT+ requires BUILD_COMPLETED after BLOCKS_ACCEPTED and before first BUILT")
    if active("MACHINE_VERIFIED"):
        rule = rules.get("MACHINE_VERIFIED") or {}
        if _event_between(events, str(rule.get("required_event")), str(rule.get("must_occur_after_state")), "MACHINE_VERIFIED") is None:
            errors.append("job: MACHINE_VERIFIED+ requires MACHINE_VERIFICATION_PASSED after BUILT and before first MACHINE_VERIFIED")
    if active("HUMAN_ACCEPTED"):
        rule = rules.get("HUMAN_ACCEPTED") or {}
        if _event_between(events, str(rule.get("required_event")), str(rule.get("must_occur_after_state")), "HUMAN_ACCEPTED") is None:
            errors.append("job: HUMAN_ACCEPTED+ requires HUMAN_REVIEW_ACCEPTED before HUMAN_ACCEPTED")

    current_attempt: str | None = None
    output_ids = _binding_set(data.get("outputs"))
    if active("BUILT") and output_ids:
        current_build = _latest_event(events, "BUILD_COMPLETED", bindings_cover=output_ids)
        if current_build is None:
            errors.append("job: current output set is not covered by any BUILD_COMPLETED")
        else:
            attempt = current_build.get("attempt_id")
            if not isinstance(attempt, str) or not attempt:
                errors.append("job: current BUILD_COMPLETED evidence must carry attempt_id")
            else:
                current_attempt = attempt

    evidence_ids = _binding_set(data.get("machine_evidence"))
    if active("MACHINE_VERIFIED") and current_attempt is not None:
        required_kind = (rules.get("MACHINE_VERIFIED") or {}).get("event_bindings_must_include_kind")
        required = (str(required_kind), evidence_ids) if required_kind else None
        if _latest_event(events, "MACHINE_VERIFICATION_PASSED", attempt_id=current_attempt, required_kind_from=required) is None:
            errors.append(f"job: current attempt {current_attempt} lacks MACHINE_VERIFICATION_PASSED binding current module_check evidence")

    if active("HUMAN_ACCEPTED"):
        accepted = (data.get("human_acceptance") or {}).get("accepted_outputs") if isinstance(data.get("human_acceptance"), dict) else []
        accepted_ids = _binding_set(accepted)
        if current_attempt is None:
            errors.append("job: HUMAN_ACCEPTED current attempt cannot be resolved from outputs")
        else:
            if _latest_event(events, "HUMAN_REVIEW_ACCEPTED", attempt_id=current_attempt, bindings_equal=accepted_ids) is None:
                errors.append(f"job: HUMAN_REVIEW_ACCEPTED must bind exact accepted outputs for current attempt {current_attempt}")
            if any(_is_visual_output(x) for x in data.get("outputs") or [] if isinstance(x, dict)):
                visual_rule = rules.get("VISUAL_HUMAN_ACCEPTED") or {}
                render_kind = visual_rule.get("event_bindings_must_include_kind")
                required = (str(render_kind), evidence_ids) if render_kind else None
                if _latest_event(events, "FINAL_RENDER_COMPLETED", attempt_id=current_attempt, required_kind_from=required) is None:
                    errors.append(f"job: visual HUMAN acceptance requires current attempt {current_attempt} FINAL_RENDER_COMPLETED binding current render evidence")


def _snapshot_coverage_errors(data: dict, contract: dict, snapshot: dict) -> list[str]:
    errors: list[str] = []
    snapshot_keys = {
        (str(x.get("path") or ""), str(x.get("sha256") or ""), str(x.get("kind") or ""))
        for x in (snapshot.get("bindings") or []) if isinstance(x, dict)
    }
    provenance = data.get("build_provenance") or {}
    for label, binding in (
        ("module_contract_binding", provenance.get("module_contract_binding")),
        ("builder_binding", provenance.get("builder_binding")),
    ):
        if isinstance(binding, dict) and binding_key(binding) not in snapshot_keys:
            errors.append(f"job: {label} is not covered by source snapshot")
    policy = (contract.get("build_provenance") or {}).get("source_snapshot") or {}
    exempt = set(policy.get("snapshot_exempt_input_kinds") or [])
    for idx, binding in enumerate(data.get("input_bindings") or []):
        if not isinstance(binding, dict) or binding.get("kind") in exempt:
            continue
        if binding_key(binding) not in snapshot_keys:
            errors.append(f"job: input_bindings[{idx}] is not covered by source snapshot")
    return errors


def validate(data: dict, root: Path = ROOT, verification_mode: str = "live") -> list[str]:
    if verification_mode != "live":
        return ["check_artifact_job supports live verification only; use check_artifact_provenance.py for historical audit"]
    errors: list[str] = []
    try:
        contract = load_yaml(root / CONTRACT); registry = load_yaml(root / REGISTRY)
    except Exception as exc:
        return [f"governance contract load failed: {exc}"]
    states = tuple(contract.get("states") or [])
    for field in contract.get("required_top_level") or []:
        if field not in data: errors.append(f"job: missing top-level field {field}")
    state = data.get("state")
    if state not in states:
        errors.append(f"job: invalid state {state!r}"); state_index = -1
    else:
        state_index = states.index(state)
    job_id = data.get("job_id")
    if not isinstance(job_id, str) or not job_id.strip(): errors.append("job: job_id is required")
    module_id = data.get("module_id"); modules = registry.get("modules") or {}
    module = modules.get(module_id) if isinstance(module_id, str) else None
    if not isinstance(module, dict):
        errors.append(f"job: unknown module_id {module_id!r}"); module = {}
    lifecycle = module.get("lifecycle")
    if lifecycle not in set(registry.get("allowed_lifecycle") or []): errors.append(f"module: invalid lifecycle {lifecycle!r}")
    if lifecycle not in set(contract.get("allowed_module_lifecycle_for_new_job") or []): errors.append(f"module: lifecycle {lifecycle!r} cannot start/continue a new Artifact Job")
    expected_contract = module.get("module_contract")
    if data.get("module_contract") != expected_contract: errors.append("job: module_contract must match module registry")
    if expected_contract:
        try: safe_repo_path(root, expected_contract, must_exist=True)
        except ValueError as exc: errors.append(f"module_contract: {exc}")

    ledger: dict = {}
    ledger_raw = data.get("execution_ledger")
    if not isinstance(ledger_raw, str) or not ledger_raw:
        errors.append("job: execution_ledger path is required")
    else:
        try:
            ledger_path = safe_repo_path(root, ledger_raw, must_exist=True); ledger = load_yaml(ledger_path)
            if ledger.get("job_id") != job_id: errors.append("job: execution ledger job_id mismatch")
            errors.extend("ledger: " + err for err in validate_ledger(ledger, root))
            projected_state, projection_errors = project_lifecycle(ledger.get("events") or [], load_yaml(root / LEDGER_CONTRACT))
            errors.extend("ledger: " + err for err in projection_errors)
            if projected_state != state: errors.append(f"job: state {state!r} must equal ledger-projected state {projected_state!r}")
        except Exception as exc:
            errors.append(f"job: invalid execution ledger: {exc}")

    for field in ("input_bindings", "blocks", "outputs", "machine_evidence"):
        if field in data and not isinstance(data.get(field), list): errors.append(f"job: {field} must be a list")

    if state_index >= 0 and state_index >= states.index("INPUTS_LOCKED"):
        bindings = data.get("input_bindings") or []
        if not bindings: errors.append("job: INPUTS_LOCKED+ requires input_bindings")
        for idx, binding in enumerate(bindings): errors.extend(validate_binding(root, binding, f"input_bindings[{idx}]"))
        provenance = data.get("build_provenance")
        if not isinstance(provenance, dict):
            errors.append("job: INPUTS_LOCKED+ requires build_provenance mapping")
        else:
            module_binding = provenance.get("module_contract_binding"); builder_binding = provenance.get("builder_binding")
            errors.extend(validate_binding(root, module_binding, "build_provenance.module_contract_binding"))
            errors.extend(validate_binding(root, builder_binding, "build_provenance.builder_binding"))
            if isinstance(module_binding, dict):
                if module_binding.get("path") != expected_contract: errors.append("job: provenance module contract path must match module registry")
                if module_binding.get("kind") != "module_contract": errors.append("job: provenance module contract kind must be module_contract")
            adapter = module.get("artifact_adapter") or {}; expected_builder = adapter.get("build") if isinstance(adapter, dict) else None
            if isinstance(builder_binding, dict):
                if builder_binding.get("path") != expected_builder: errors.append("job: provenance builder path must match module registry build adapter")
                if builder_binding.get("kind") != "builder": errors.append("job: provenance builder kind must be builder")
            snapshot, snapshot_errors = validate_snapshot_binding(root, provenance.get("source_snapshot_binding"), mode="live")
            errors.extend("job: " + x for x in snapshot_errors)
            if snapshot is not None: errors.extend(_snapshot_coverage_errors(data, contract, snapshot))
            runtime = provenance.get("runtime_identity")
            if not isinstance(runtime, dict): errors.append("job: build_provenance.runtime_identity must be a mapping")
            else:
                for key in (contract.get("build_provenance") or {}).get("runtime_required_fields") or []:
                    if not isinstance(runtime.get(key), str) or not runtime.get(key): errors.append(f"job: runtime_identity.{key} is required")
            fingerprint = provenance.get("input_fingerprint")
            if not is_sha256(fingerprint): errors.append("job: build_provenance.input_fingerprint must be lowercase SHA-256")
            else:
                try:
                    expected = expected_input_fingerprint(data)
                    if fingerprint != expected: errors.append(f"job: input_fingerprint mismatch: declared={fingerprint} expected={expected}")
                except Exception as exc: errors.append(f"job: cannot derive input fingerprint: {exc}")

    if state_index >= 0 and state_index >= states.index("BLOCKS_ACCEPTED"):
        blocks = data.get("blocks") or []
        if not blocks: errors.append("job: BLOCKS_ACCEPTED+ requires block receipts")
        seen: set[str] = set()
        for idx, block in enumerate(blocks):
            label = f"blocks[{idx}]"
            if not isinstance(block, dict): errors.append(f"{label}: must be a mapping"); continue
            block_id = block.get("block_id")
            if not isinstance(block_id, str) or not block_id: errors.append(f"{label}: block_id is required")
            elif block_id in seen: errors.append(f"{label}: duplicate block_id {block_id}")
            else: seen.add(block_id)
            if block.get("state") != "REVIEW_PASS": errors.append(f"{label}: state must be REVIEW_PASS")
            if block.get("reviewer") != "ChatGPT": errors.append(f"{label}: reviewer must be ChatGPT")
            if not parse_iso8601(block.get("reviewed_at")): errors.append(f"{label}: reviewed_at must be ISO-8601")
            errors.extend(validate_binding(root, block.get("artifact_binding"), f"{label}.artifact_binding"))
            errors.extend(validate_binding(root, block.get("evidence_binding"), f"{label}.evidence_binding"))

    if state_index >= 0 and state_index >= states.index("BUILT"):
        outputs = data.get("outputs") or []
        if not outputs: errors.append("job: BUILT+ requires outputs")
        for idx, binding in enumerate(outputs): errors.extend(validate_binding(root, binding, f"outputs[{idx}]"))
    if state_index >= 0 and state_index >= states.index("MACHINE_VERIFIED"):
        machine = data.get("machine_evidence") or []
        if not machine: errors.append("job: MACHINE_VERIFIED+ requires machine_evidence")
        for idx, binding in enumerate(machine): errors.extend(validate_binding(root, binding, f"machine_evidence[{idx}]"))
        required_kind = (contract.get("machine_boundary") or {}).get("module_check_evidence_kind")
        if required_kind and required_kind not in {x.get("kind") for x in machine if isinstance(x, dict)}: errors.append(f"job: MACHINE_VERIFIED+ requires machine evidence kind {required_kind}")

    human = data.get("human_acceptance") or {}
    if state_index >= 0 and state_index >= states.index("HUMAN_ACCEPTED"):
        if not isinstance(human, dict) or human.get("state") != "REVIEW_PASS": errors.append("job: HUMAN_ACCEPTED+ requires human_acceptance.state=REVIEW_PASS")
        else:
            if human.get("reviewer") != "ChatGPT": errors.append("job: human reviewer must be ChatGPT")
            if not parse_iso8601(human.get("reviewed_at")): errors.append("job: human_acceptance.reviewed_at must be ISO-8601")
            accepted = human.get("accepted_outputs") or []
            if not accepted: errors.append("job: human acceptance must bind outputs")
            for idx, binding in enumerate(accepted): errors.extend(validate_binding(root, binding, f"human_acceptance.accepted_outputs[{idx}]"))
            if _binding_set(accepted) != _binding_set(data.get("outputs")): errors.append("job: HUMAN acceptance must bind the exact output set")
            if any(_is_visual_output(x) for x in data.get("outputs") or [] if isinstance(x, dict)):
                render_kind = (contract.get("machine_boundary") or {}).get("visual_render_evidence_kind")
                if render_kind and render_kind not in {x.get("kind") for x in data.get("machine_evidence") or [] if isinstance(x, dict)}: errors.append(f"job: visual HUMAN acceptance requires machine evidence kind {render_kind}")

    publication = data.get("publication") or {}
    if state_index >= 0 and state_index >= states.index("PUBLISHED"):
        if not isinstance(publication, dict) or publication.get("state") != "PUBLISHED": errors.append("job: PUBLISHED requires publication.state=PUBLISHED")
        else:
            if not parse_iso8601(publication.get("published_at")): errors.append("job: publication.published_at must be ISO-8601")
            published = publication.get("outputs") or []; accepted = human.get("accepted_outputs") or [] if isinstance(human, dict) else []
            for idx, binding in enumerate(published): errors.extend(validate_binding(root, binding, f"publication.outputs[{idx}]"))
            if _binding_set(published) != _binding_set(accepted): errors.append("job: publication must consume exact HUMAN-accepted outputs")
    if ledger: _require_ledger_evidence(data, contract, ledger, errors)
    return errors


def selftest() -> int:
    with tempfile.TemporaryDirectory(prefix="qz-artifact-job-") as tmp:
        root = Path(tmp)
        (root / "production/contracts").mkdir(parents=True); (root / "production/provenance/repository-snapshots").mkdir(parents=True); (root / "content").mkdir(); (root / "tools").mkdir()
        (root / CONTRACT).write_text(
            "states: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\n"
            "allowed_module_lifecycle_for_new_job: [ACTIVE, FROZEN]\n"
            "required_top_level: [version, job_id, module_id, state, module_contract, execution_ledger, input_bindings, build_provenance, blocks, outputs, machine_evidence, human_acceptance, publication]\n"
            "build_provenance:\n  runtime_required_fields: [name, version]\n  source_snapshot:\n    snapshot_exempt_input_kinds: [input_plan]\n"
            "ledger_evidence_events: {}\nmachine_boundary:\n  module_check_evidence_kind: module_check\n  visual_render_evidence_kind: final_render_manifest\n", encoding="utf-8")
        (root / LEDGER_CONTRACT).write_text(
            "lifecycle_transition_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\n"
            "event_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\nattempt_event_types: []\n", encoding="utf-8")
        (root / PROVENANCE_CONTRACT).write_text("snapshot:\n  storage_root: production/provenance/repository-snapshots\n", encoding="utf-8")
        (root / "content/module.yaml").write_text("id: synthetic\n", encoding="utf-8"); (root / "content/input.txt").write_text("input\n", encoding="utf-8"); (root / "tools/build.py").write_text("# builder\n", encoding="utf-8")
        (root / REGISTRY).write_text("allowed_lifecycle: [ACTIVE, FROZEN, DEFERRED, EXTERNAL, RETIRED]\nmodules:\n  synthetic:\n    lifecycle: ACTIVE\n    module_contract: content/module.yaml\n    artifact_adapter:\n      build: tools/build.py\n", encoding="utf-8")
        module_digest = sha256_file(root / "content/module.yaml"); builder_digest = sha256_file(root / "tools/build.py"); input_digest = sha256_file(root / "content/input.txt")
        entries = [repository_binding(root, "content/module.yaml", "module_contract"), repository_binding(root, "tools/build.py", "builder"), repository_binding(root, "content/input.txt", "source")]
        snapshot_path = write_snapshot(build_snapshot(entries, "a" * 40), root=root)
        snapshot_binding = {"path": snapshot_path.relative_to(root).as_posix(), "sha256": sha256_file(snapshot_path), "kind": "repository_snapshot"}
        ledger = {"contract": LEDGER_CONTRACT.as_posix(), "job_id": "j1", "events": [{"seq": 1, "event_id": "e1", "occurred_at": "2026-01-01T00:00:00Z", "type": "JOB_CREATED", "actor": "ChatGPT"}, {"seq": 2, "event_id": "e2", "occurred_at": "2026-01-01T00:00:01Z", "type": "INPUTS_LOCKED", "actor": "ChatGPT"}], "derived": {"artifact_state": "INPUTS_LOCKED", "generation_review_cycles": 0, "build_count": 0, "final_render_count": 0, "review_reject_count": 0}}
        (root / "ledger.yaml").write_text(yaml.safe_dump(ledger, sort_keys=False), encoding="utf-8")
        inputs = [{"path": "content/input.txt", "sha256": input_digest, "kind": "source"}]
        module_binding = {"path": "content/module.yaml", "sha256": module_digest, "kind": "module_contract"}; builder_binding = {"path": "tools/build.py", "sha256": builder_digest, "kind": "builder"}; runtime = {"name": "python", "version": "3.12"}
        job = {"version": 1, "job_id": "j1", "module_id": "synthetic", "state": "INPUTS_LOCKED", "module_contract": "content/module.yaml", "execution_ledger": "ledger.yaml", "input_bindings": inputs, "build_provenance": {"module_contract_binding": module_binding, "builder_binding": builder_binding, "source_snapshot_binding": snapshot_binding, "runtime_identity": runtime, "input_fingerprint": artifact_input_fingerprint("synthetic", module_binding, builder_binding, runtime, inputs, snapshot_binding)}, "blocks": [], "outputs": [], "machine_evidence": [], "human_acceptance": {"state": "PENDING"}, "publication": {"state": "NOT_PUBLISHED"}}
        found = validate(job, root)
        if found: print("FAIL: valid INPUTS_LOCKED job rejected", found); return 1
        (root / "content/input.txt").write_text("changed\n", encoding="utf-8")
        if not validate(job, root): print("FAIL: live checker accepted changed input bytes"); return 1
    print("PASS: artifact job live selftest"); return 0


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--job", type=Path); parser.add_argument("--root", type=Path, default=ROOT); parser.add_argument("--selftest", action="store_true"); args = parser.parse_args()
    if args.selftest: return selftest()
    if not args.job: parser.error("--job or --selftest is required")
    errors = validate(load_yaml(args.job), args.root.resolve())
    if errors:
        print("FAIL: artifact job")
        for error in errors: print("- " + error)
        return 1
    print("PASS: artifact job [live]")
    return 0


if __name__ == "__main__": raise SystemExit(main())
