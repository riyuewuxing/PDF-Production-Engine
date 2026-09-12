#!/usr/bin/env python3
"""Fail-closed live validator for the unified Artifact Job lifecycle.

This checker is intentionally about the *current execution package*: repository inputs
must still match current materialized bytes and the durable source snapshot. Historical
audit after repository evolution is a separate concern handled by
`check_artifact_provenance.py`.

Module Contracts may additionally require a live input-lock verifier. That verifier
is loaded only after its exact repository bytes are present in the Job input bindings
and live-validated. This keeps module-specific consumer authorization out of the
generic Artifact operator while still making it unavoidable at transaction commit.

Public ``validate`` always reads the canonical execution-ledger file. The private
``_validate_transaction_candidate`` path exists only so the canonical Artifact
transaction operator can validate a proposed job+ledger pair before the first
canonical write; it runs the same complete live validation rules and is not a
persisted-state authority.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
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


def _module_input_lock_verification_errors(
    data: dict,
    root: Path,
    artifact_contract: dict,
    states: tuple[str, ...],
    state_index: int,
) -> list[str]:
    """Apply a Module-Contract-declared live input-lock verifier, if any.

    The verifier file must already be one of the Job's exact live input bindings.
    This prevents an unbound current Python file from becoming authorization code.
    """
    errors: list[str] = []
    if state_index < 0:
        return errors
    contract_raw = data.get("module_contract")
    if not isinstance(contract_raw, str) or not contract_raw:
        return errors
    try:
        module_contract = load_yaml(safe_repo_path(root, contract_raw, must_exist=True))
    except Exception as exc:
        return [f"job: module input-lock contract load failed: {exc}"]
    profile = module_contract.get("artifact_job_profile") or {}
    if not isinstance(profile, dict):
        return errors
    policy = profile.get("input_lock_verification")
    if policy is None:
        return errors
    if not isinstance(policy, dict):
        return ["job: artifact_job_profile.input_lock_verification must be a mapping"]

    required_state = policy.get("required_from_state", "INPUTS_LOCKED")
    if not isinstance(required_state, str) or required_state not in states:
        return [f"job: input-lock verification required_from_state invalid: {required_state!r}"]
    if state_index < states.index(required_state):
        return errors

    framework = artifact_contract.get("module_input_lock_verification") or {}
    if not isinstance(framework, dict):
        return ["job: Artifact contract module_input_lock_verification framework missing"]
    mode = policy.get("mode")
    allowed_modes = set(framework.get("allowed_modes") or [])
    if not isinstance(mode, str) or mode not in allowed_modes:
        errors.append(f"job: unsupported module input-lock verification mode: {mode!r}")

    plan_kind = policy.get("input_plan_binding_kind")
    if not isinstance(plan_kind, str) or not plan_kind:
        errors.append("job: input_lock_verification.input_plan_binding_kind is required")
        plan_kind = ""
    plan_bindings = [
        x for x in (data.get("input_bindings") or [])
        if isinstance(x, dict) and x.get("kind") == plan_kind
    ]
    if len(plan_bindings) != 1:
        errors.append(
            f"job: module input-lock verification requires exactly one {plan_kind!r} binding; "
            f"got {len(plan_bindings)}"
        )

    verifier = policy.get("verifier") or {}
    if not isinstance(verifier, dict):
        errors.append("job: input_lock_verification.verifier must be a mapping")
        verifier = {}
    verifier_raw = verifier.get("path")
    verifier_function = verifier.get("function")
    verifier_kind = verifier.get("binding_kind")
    if not isinstance(verifier_raw, str) or not verifier_raw:
        errors.append("job: input-lock verifier path is required")
    if not isinstance(verifier_function, str) or not verifier_function:
        errors.append("job: input-lock verifier function is required")
    if not isinstance(verifier_kind, str) or not verifier_kind:
        errors.append("job: input-lock verifier binding_kind is required")

    verifier_bindings = [
        x for x in (data.get("input_bindings") or [])
        if isinstance(x, dict)
        and x.get("path") == verifier_raw
        and x.get("kind") == verifier_kind
    ]
    if len(verifier_bindings) != 1:
        errors.append(
            "job: module input-lock verifier must be present exactly once in live input bindings: "
            f"path={verifier_raw!r} kind={verifier_kind!r} got={len(verifier_bindings)}"
        )
    elif verifier_bindings:
        errors.extend(
            "job: " + x
            for x in validate_binding(root, verifier_bindings[0], "module_input_lock_verifier_binding")
        )
    if errors or len(plan_bindings) != 1:
        return errors

    try:
        verifier_path = safe_repo_path(root, verifier_raw, must_exist=True)
        if verifier_path.suffix != ".py" or "tools" not in verifier_path.relative_to(root.resolve()).parts:
            raise ValueError("input-lock verifier must be a repository tools/*.py file")
        module_name = "_qz_module_input_lock_verifier_" + hashlib.sha256(
            verifier_path.as_posix().encode("utf-8")
        ).hexdigest()[:16]
        spec = importlib.util.spec_from_file_location(module_name, verifier_path)
        if spec is None or spec.loader is None:
            raise ValueError("cannot create verifier module spec")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        callback = getattr(module, verifier_function, None)
        if not callable(callback):
            raise ValueError(f"verifier callback missing/not callable: {verifier_function}")
        result = callback(root=root, job=data, plan_binding=plan_bindings[0])
        if not isinstance(result, list) or not all(isinstance(x, str) and x for x in result):
            raise ValueError("verifier callback must return list[str]")
        errors.extend("job: module input-lock verifier: " + x for x in result)
    except Exception as exc:
        errors.append(f"job: module input-lock verifier execution failed: {type(exc).__name__}: {exc}")
    return errors


def _validate_live(data: dict, root: Path, *, ledger_candidate: dict | None = None) -> list[str]:
    """Shared complete live rules; candidate ledger is precommit data, never authority."""
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
            # The canonical ledger path must already exist even during a transaction.
            # A candidate ledger may replace only its not-yet-written *contents*.
            safe_repo_path(root, ledger_raw, must_exist=True)
            if ledger_candidate is None:
                ledger = load_yaml(safe_repo_path(root, ledger_raw, must_exist=True))
            elif isinstance(ledger_candidate, dict):
                ledger = ledger_candidate
            else:
                raise ValueError("transaction ledger candidate must be a mapping")
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

        errors.extend(_module_input_lock_verification_errors(data, root, contract, states, state_index))

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


def validate(data: dict, root: Path = ROOT, verification_mode: str = "live") -> list[str]:
    """Validate the persisted live Job against its canonical on-disk ledger."""
    if verification_mode != "live":
        return ["check_artifact_job supports live verification only; use check_artifact_provenance.py for historical audit"]
    return _validate_live(data, root)


def _validate_transaction_candidate(data: dict, ledger_candidate: dict, root: Path = ROOT) -> list[str]:
    """Validate a not-yet-persisted candidate pair before the first canonical write."""
    if not isinstance(ledger_candidate, dict):
        return ["transaction ledger candidate must be a mapping"]
    return _validate_live(data, root, ledger_candidate=ledger_candidate)


def selftest() -> int:
    with tempfile.TemporaryDirectory(prefix="qz-artifact-job-") as tmp:
        root = Path(tmp)
        (root / "production/contracts").mkdir(parents=True); (root / "production/provenance/repository-snapshots").mkdir(parents=True); (root / "content").mkdir(); (root / "tools").mkdir()
        (root / CONTRACT).write_text(
            "states: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\n"
            "allowed_module_lifecycle_for_new_job: [ACTIVE, FROZEN]\n"
            "required_top_level: [version, job_id, module_id, state, module_contract, execution_ledger, input_bindings, build_provenance, blocks, outputs, machine_evidence, human_acceptance, publication]\n"
            "build_provenance:\n  runtime_required_fields: [name, version]\n  source_snapshot:\n    snapshot_exempt_input_kinds: [input_plan]\n"
            "module_input_lock_verification:\n  allowed_modes: [canonical-plan-reconstruction-v1]\n"
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
        found = _validate_transaction_candidate(job, ledger, root)
        if found: print("FAIL: valid candidate pair rejected", found); return 1
        stale_candidate = dict(ledger); stale_candidate["job_id"] = "other"
        if not _validate_transaction_candidate(job, stale_candidate, root): print("FAIL: candidate ledger override mismatch escaped"); return 1
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
