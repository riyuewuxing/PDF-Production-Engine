#!/usr/bin/env python3
"""Transactional operations for the unified Artifact Job + Execution Ledger.

Artifact lifecycle is monotonic. Detailed retries are append-only attempt facts. New
jobs also bind one immutable repository provenance snapshot before INPUTS_LOCKED so
live execution can fail closed while later historical audit does not depend on mutable
current-path bytes.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import tempfile
from typing import Any
import yaml

from artifact_foundation import (
    ROOT,
    artifact_input_fingerprint,
    binding_key,
    load_yaml,
    parse_iso8601,
    safe_repo_path,
    sha256_file,
    validate_binding,
)
from check_artifact_job import validate as validate_job
from check_execution_ledger import derive, project_lifecycle, validate as validate_ledger
from init_artifact_job import initialize
from provenance_snapshot import (
    build_snapshot,
    repository_binding,
    validate_snapshot_binding,
    write_snapshot,
)

ARTIFACT_CONTRACT = Path("production/contracts/artifact-job-v1.yaml")
LEDGER_CONTRACT = Path("production/contracts/execution-ledger-v1.yaml")
PROVENANCE_CONTRACT = Path("production/contracts/repository-provenance-snapshot-v1.yaml")
VISUAL_SUFFIXES = {".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"}
VISUAL_KINDS = {"pdf", "docx", "pptx", "visual_document", "final_visual"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _timestamp(value: str | None) -> str:
    result = value or now_iso()
    if not parse_iso8601(result):
        raise ValueError("occurred/review/publish timestamp must be ISO-8601")
    return result


def _binding(root: Path, raw: str, kind: str) -> dict[str, str]:
    if not isinstance(kind, str) or not kind.strip():
        raise ValueError("binding kind is required")
    path = safe_repo_path(root, raw, must_exist=True)
    if not path.is_file():
        raise ValueError(f"binding source is not a file: {raw}")
    return {"path": raw, "sha256": sha256_file(path), "kind": kind}


def _binding_set(items: Any) -> set[tuple[str, str, str]]:
    return {binding_key(x) for x in (items or []) if isinstance(x, dict)}


def _is_visual_binding(binding: dict[str, Any]) -> bool:
    path = Path(str(binding.get("path") or ""))
    return str(binding.get("kind") or "").lower() in VISUAL_KINDS or path.suffix.lower() in VISUAL_SUFFIXES


def _load_pair(root: Path, job_raw: str) -> tuple[Path, dict, Path, dict]:
    job_path = safe_repo_path(root, job_raw, must_exist=True)
    if not job_path.is_file():
        raise ValueError(f"job is not a file: {job_raw}")
    job = load_yaml(job_path)
    ledger_raw = job.get("execution_ledger")
    ledger_path = safe_repo_path(root, ledger_raw, must_exist=True)
    if not ledger_path.is_file():
        raise ValueError(f"execution ledger is not a file: {ledger_raw}")
    return job_path, job, ledger_path, load_yaml(ledger_path)


def _write_yaml(path: Path, data: dict) -> None:
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


def _refresh_derived(root: Path, ledger: dict) -> None:
    contract = load_yaml(root / LEDGER_CONTRACT)
    state, errors = project_lifecycle(ledger.get("events") or [], contract)
    if errors:
        raise ValueError("; ".join(errors))
    metrics = derive([x for x in (ledger.get("events") or []) if isinstance(x, dict)])
    ledger["derived"] = {"artifact_state": state, **metrics}


def _next_event_id(job_id: str, ledger: dict) -> str:
    return f"{job_id}:{len(ledger.get('events') or []) + 1:04d}"


def _append_event(root: Path, job: dict, ledger: dict, event_type: str, actor: str,
                  occurred_at: str | None = None, *, attempt_id: str | None = None,
                  bindings: list[dict] | None = None) -> None:
    contract = load_yaml(root / LEDGER_CONTRACT)
    if event_type not in set(contract.get("event_types") or []):
        raise ValueError(f"unsupported ledger event type: {event_type}")
    if not isinstance(actor, str) or not actor.strip():
        raise ValueError("event actor is required")
    events = ledger.setdefault("events", [])
    event: dict[str, Any] = {
        "seq": len(events) + 1,
        "event_id": _next_event_id(str(job.get("job_id") or "job"), ledger),
        "occurred_at": _timestamp(occurred_at),
        "type": event_type,
        "actor": actor,
    }
    if attempt_id is not None:
        if not isinstance(attempt_id, str) or not attempt_id.strip():
            raise ValueError("attempt_id must be a non-empty string")
        event["attempt_id"] = attempt_id.strip()
    if bindings:
        event["bindings"] = deepcopy(bindings)
    events.append(event)
    _refresh_derived(root, ledger)


def _transaction(root: Path, job_path: Path, old_job: dict, new_job: dict,
                 ledger_path: Path, old_ledger: dict, new_ledger: dict) -> None:
    _write_yaml(ledger_path, new_ledger)
    try:
        ledger_errors = validate_ledger(new_ledger, root)
        job_errors = validate_job(new_job, root, verification_mode="live")
        if ledger_errors or job_errors:
            raise ValueError(" | ".join([
                *("ledger: " + x for x in ledger_errors),
                *("job: " + x for x in job_errors),
            ]))
        _write_yaml(job_path, new_job)
    except Exception:
        _write_yaml(ledger_path, old_ledger)
        _write_yaml(job_path, old_job)
        raise


def _job_only(root: Path, job_path: Path, old_job: dict, new_job: dict) -> None:
    errors = validate_job(new_job, root, verification_mode="live")
    if errors:
        raise ValueError(" | ".join(errors))
    try:
        _write_yaml(job_path, new_job)
    except Exception:
        _write_yaml(job_path, old_job)
        raise


def _attempt_events(ledger: dict, attempt_id: str) -> list[dict]:
    return [x for x in (ledger.get("events") or []) if isinstance(x, dict) and x.get("attempt_id") == attempt_id]


def _latest_attempt_id(root: Path, ledger: dict) -> str | None:
    attempt_types = set(load_yaml(root / LEDGER_CONTRACT).get("attempt_event_types") or [])
    for event in reversed(ledger.get("events") or []):
        if not isinstance(event, dict) or event.get("type") not in attempt_types:
            continue
        attempt = event.get("attempt_id")
        if isinstance(attempt, str) and attempt.strip():
            return attempt.strip()
    return None


def _event_for_attempt(ledger: dict, attempt_id: str, event_type: str, *,
                       cover: set[tuple[str, str, str]] | None = None,
                       require_kind_binding: tuple[str, set[tuple[str, str, str]]] | None = None) -> dict | None:
    for event in reversed(_attempt_events(ledger, attempt_id)):
        if event.get("type") != event_type:
            continue
        ids = _binding_set(event.get("bindings"))
        if cover is not None and not cover <= ids:
            continue
        if require_kind_binding is not None:
            kind, current_ids = require_kind_binding
            if not any(isinstance(binding, dict) and binding.get("kind") == kind and binding_key(binding) in current_ids
                       for binding in (event.get("bindings") or [])):
                continue
        return event
    return None


def _current_attempt_id(job: dict, ledger: dict) -> str | None:
    outputs = _binding_set(job.get("outputs"))
    if not outputs:
        return None
    for event in reversed(ledger.get("events") or []):
        if not isinstance(event, dict) or event.get("type") != "BUILD_COMPLETED":
            continue
        if outputs <= _binding_set(event.get("bindings")):
            attempt = event.get("attempt_id")
            if isinstance(attempt, str) and attempt.strip():
                return attempt.strip()
    return None


def _enforce_historical_binding_paths(ledger: dict, attempt_id: str, bindings: list[dict]) -> None:
    by_path = {str(x["path"]): str(x["sha256"]) for x in bindings}
    conflicts: list[str] = []
    for event in ledger.get("events") or []:
        if not isinstance(event, dict) or event.get("attempt_id") in {None, attempt_id}:
            continue
        for old in event.get("bindings") or []:
            if not isinstance(old, dict):
                continue
            path = str(old.get("path") or "")
            old_hash = str(old.get("sha256") or "")
            if path in by_path and old_hash and by_path[path] != old_hash:
                conflicts.append(path)
    if conflicts:
        raise ValueError("retry candidate overwrites historical attempt-bound path(s); use immutable attempt-specific/content-addressed paths: " + ", ".join(sorted(set(conflicts))))


def lock_inputs(root: Path, job_raw: str, inputs: list[tuple[str, str]], snapshot_raw: str,
                runtime_name: str, runtime_version: str, occurred_at: str | None = None) -> None:
    """Atomically enter INPUTS_LOCKED with live-verified durable repository provenance."""
    job_path, old_job, ledger_path, old_ledger = _load_pair(root, job_raw)
    if old_job.get("state") != "JOB_CREATED":
        raise ValueError("lock-inputs requires JOB_CREATED")
    if not inputs:
        raise ValueError("at least one --input PATH=KIND is required")
    if not runtime_name or not runtime_version:
        raise ValueError("runtime name and version are required")
    bindings = [_binding(root, path, kind) for path, kind in inputs]
    paths = [b["path"] for b in bindings]
    if len(paths) != len(set(paths)):
        raise ValueError("duplicate input paths are forbidden")
    snapshot_binding = _binding(root, snapshot_raw, "repository_snapshot")
    _, snapshot_errors = validate_snapshot_binding(root, snapshot_binding, mode="live")
    if snapshot_errors:
        raise ValueError(" | ".join(snapshot_errors))

    new_job = deepcopy(old_job); new_ledger = deepcopy(old_ledger)
    provenance = new_job.get("build_provenance") or {}
    if not isinstance(provenance, dict):
        raise ValueError("job build_provenance is missing")
    module_binding = provenance.get("module_contract_binding")
    builder_binding = provenance.get("builder_binding")
    found = validate_binding(root, module_binding, "module_contract_binding") + validate_binding(root, builder_binding, "builder_binding")
    if found:
        raise ValueError(" | ".join(found))
    runtime = {"name": runtime_name, "version": runtime_version}
    new_job["input_bindings"] = bindings
    provenance["source_snapshot_binding"] = snapshot_binding
    provenance["runtime_identity"] = runtime
    provenance["input_fingerprint"] = artifact_input_fingerprint(
        new_job.get("module_id"), module_binding, builder_binding, runtime, bindings, snapshot_binding
    )
    new_job["build_provenance"] = provenance
    ts = _timestamp(occurred_at)
    for binding in bindings:
        _append_event(root, new_job, new_ledger, "INPUT_BOUND", "ChatGPT", ts, bindings=[binding])
    _append_event(root, new_job, new_ledger, "INPUT_BOUND", "ChatGPT", ts, bindings=[snapshot_binding])
    _append_event(root, new_job, new_ledger, "INPUTS_LOCKED", "ChatGPT", ts, bindings=[*bindings, snapshot_binding])
    new_job["state"] = "INPUTS_LOCKED"
    _transaction(root, job_path, old_job, new_job, ledger_path, old_ledger, new_ledger)


def accept_block(root: Path, job_raw: str, block_id: str, artifact_path: str, artifact_kind: str,
                 evidence_path: str, evidence_kind: str, reviewed_at: str | None = None) -> None:
    job_path, old_job, ledger_path, old_ledger = _load_pair(root, job_raw)
    if old_job.get("state") != "INPUTS_LOCKED":
        raise ValueError("accept-block requires INPUTS_LOCKED; accumulate all block receipts before advancing")
    if not block_id:
        raise ValueError("block_id is required")
    if any(isinstance(x, dict) and x.get("block_id") == block_id for x in old_job.get("blocks") or []):
        raise ValueError(f"duplicate block_id: {block_id}")
    artifact = _binding(root, artifact_path, artifact_kind); evidence = _binding(root, evidence_path, evidence_kind)
    ts = _timestamp(reviewed_at)
    receipt = {"block_id": block_id, "state": "REVIEW_PASS", "reviewer": "ChatGPT", "reviewed_at": ts,
               "artifact_binding": artifact, "evidence_binding": evidence}
    new_job = deepcopy(old_job); new_ledger = deepcopy(old_ledger)
    new_job.setdefault("blocks", []).append(receipt)
    _append_event(root, new_job, new_ledger, "BLOCK_REVIEW_ACCEPTED", "ChatGPT", ts, bindings=[artifact, evidence])
    _transaction(root, job_path, old_job, new_job, ledger_path, old_ledger, new_ledger)


def add_output(root: Path, job_raw: str, raw: str, kind: str) -> None:
    job_path, old_job, _, _ = _load_pair(root, job_raw)
    if old_job.get("state") != "BLOCKS_ACCEPTED":
        raise ValueError("add-output requires BLOCKS_ACCEPTED; retry candidates use activate-attempt")
    binding = _binding(root, raw, kind); new_job = deepcopy(old_job)
    existing = {(x.get("path"), x.get("kind")) for x in new_job.get("outputs") or [] if isinstance(x, dict)}
    if (raw, kind) in existing:
        raise ValueError(f"duplicate output binding: {raw} [{kind}]")
    new_job.setdefault("outputs", []).append(binding)
    _job_only(root, job_path, old_job, new_job)


def add_machine_evidence(root: Path, job_raw: str, raw: str, kind: str) -> None:
    job_path, old_job, _, _ = _load_pair(root, job_raw)
    if old_job.get("state") not in {"BUILT", "MACHINE_VERIFIED"}:
        raise ValueError("add-machine-evidence requires BUILT or MACHINE_VERIFIED")
    binding = _binding(root, raw, kind); new_job = deepcopy(old_job)
    existing = {(x.get("path"), x.get("kind")) for x in new_job.get("machine_evidence") or [] if isinstance(x, dict)}
    if (raw, kind) in existing:
        raise ValueError(f"duplicate machine evidence binding: {raw} [{kind}]")
    new_job.setdefault("machine_evidence", []).append(binding)
    _job_only(root, job_path, old_job, new_job)


def advance(root: Path, job_raw: str, target: str, occurred_at: str | None = None) -> None:
    job_path, old_job, ledger_path, old_ledger = _load_pair(root, job_raw)
    states = list(load_yaml(root / ARTIFACT_CONTRACT).get("states") or []); current = old_job.get("state")
    if current not in states or target not in states:
        raise ValueError("current/target state is not in Artifact contract")
    if states.index(target) != states.index(current) + 1:
        raise ValueError(f"advance must move exactly one state: current={current}, target={target}")
    if target in {"INPUTS_LOCKED", "HUMAN_ACCEPTED", "PUBLISHED"}:
        raise ValueError(f"use the dedicated command for {target}")
    new_job = deepcopy(old_job); new_ledger = deepcopy(old_ledger); relevant: list[dict] = []
    if target == "BLOCKS_ACCEPTED":
        for block in new_job.get("blocks") or []:
            if isinstance(block, dict):
                relevant.extend(x for x in (block.get("artifact_binding"), block.get("evidence_binding")) if isinstance(x, dict))
    elif target == "BUILT":
        relevant = [x for x in new_job.get("outputs") or [] if isinstance(x, dict)]
    elif target == "MACHINE_VERIFIED":
        relevant = [x for x in new_job.get("machine_evidence") or [] if isinstance(x, dict)]
    _append_event(root, new_job, new_ledger, target, "ChatGPT", occurred_at, bindings=relevant)
    new_job["state"] = target
    _transaction(root, job_path, old_job, new_job, ledger_path, old_ledger, new_ledger)


def record_event(root: Path, job_raw: str, event_type: str, actor: str, attempt_id: str | None,
                 bindings: list[tuple[str, str]], occurred_at: str | None = None) -> None:
    _, job, ledger_path, old_ledger = _load_pair(root, job_raw)
    if event_type in set(load_yaml(root / LEDGER_CONTRACT).get("lifecycle_transition_types") or []):
        raise ValueError("record-event cannot write lifecycle transitions; use lock/advance/human-accept/publish")
    resolved = [_binding(root, path, kind) for path, kind in bindings]; new_ledger = deepcopy(old_ledger)
    _append_event(root, job, new_ledger, event_type, actor, occurred_at, attempt_id=attempt_id, bindings=resolved)
    errors = validate_ledger(new_ledger, root)
    if errors:
        raise ValueError(" | ".join(errors))
    _write_yaml(ledger_path, new_ledger)
    errors = validate_job(job, root, verification_mode="live")
    if errors:
        _write_yaml(ledger_path, old_ledger)
        raise ValueError(" | ".join(errors))


def start_attempt(root: Path, job_raw: str, attempt_id: str, actor: str = "Engine",
                  occurred_at: str | None = None) -> None:
    _, job, _, _ = _load_pair(root, job_raw)
    if job.get("state") not in {"BLOCKS_ACCEPTED", "BUILT", "MACHINE_VERIFIED"}:
        raise ValueError("start-attempt requires BLOCKS_ACCEPTED, BUILT, or MACHINE_VERIFIED")
    record_event(root, job_raw, "BUILD_STARTED", actor, attempt_id, [], occurred_at)


def activate_attempt(root: Path, job_raw: str, attempt_id: str,
                     outputs: list[tuple[str, str]], machine_evidence: list[tuple[str, str]]) -> None:
    job_path, old_job, _, ledger = _load_pair(root, job_raw)
    if old_job.get("state") not in {"BUILT", "MACHINE_VERIFIED"}:
        raise ValueError("activate-attempt requires BUILT or MACHINE_VERIFIED")
    if not isinstance(attempt_id, str) or not attempt_id.strip():
        raise ValueError("attempt-id is required")
    attempt_id = attempt_id.strip()
    if _latest_attempt_id(root, ledger) != attempt_id:
        raise ValueError("activate-attempt may only select the latest in-progress attempt")
    if not outputs or not machine_evidence:
        raise ValueError("activate-attempt requires --output and --evidence bindings")
    output_bindings = [_binding(root, path, kind) for path, kind in outputs]
    evidence_bindings = [_binding(root, path, kind) for path, kind in machine_evidence]
    if len({(x["path"], x["kind"]) for x in output_bindings}) != len(output_bindings):
        raise ValueError("duplicate output bindings are forbidden")
    if len({(x["path"], x["kind"]) for x in evidence_bindings}) != len(evidence_bindings):
        raise ValueError("duplicate evidence bindings are forbidden")
    module_check_kind = (load_yaml(root / ARTIFACT_CONTRACT).get("machine_boundary") or {}).get("module_check_evidence_kind")
    if not module_check_kind or not any(x.get("kind") == module_check_kind for x in evidence_bindings):
        raise ValueError(f"activate-attempt requires machine evidence kind {module_check_kind!r}")
    output_ids = _binding_set(output_bindings); evidence_ids = _binding_set(evidence_bindings)
    if _event_for_attempt(ledger, attempt_id, "BUILD_COMPLETED", cover=output_ids) is None:
        raise ValueError("activate-attempt outputs are not covered by this attempt BUILD_COMPLETED")
    if _event_for_attempt(ledger, attempt_id, "MACHINE_VERIFICATION_PASSED",
                          require_kind_binding=(str(module_check_kind), evidence_ids)) is None:
        raise ValueError("activate-attempt lacks this attempt MACHINE_VERIFICATION_PASSED for current module_check evidence")
    previous_attempt = _current_attempt_id(old_job, ledger)
    if old_job.get("state") == "MACHINE_VERIFIED" and previous_attempt and previous_attempt != attempt_id:
        if _event_for_attempt(ledger, previous_attempt, "HUMAN_REVIEW_REJECTED") is None:
            raise ValueError("MACHINE_VERIFIED retry activation requires previous current attempt HUMAN_REVIEW_REJECTED")
    _enforce_historical_binding_paths(ledger, attempt_id, [*output_bindings, *evidence_bindings])
    new_job = deepcopy(old_job); new_job["outputs"] = output_bindings; new_job["machine_evidence"] = evidence_bindings
    if new_job.get("state") == "MACHINE_VERIFIED":
        new_job["human_acceptance"] = {"state": "PENDING", "reviewer": "ChatGPT", "reviewed_at": None, "accepted_outputs": []}
    _job_only(root, job_path, old_job, new_job)


def human_reject(root: Path, job_raw: str, attempt_id: str,
                 evidence: list[tuple[str, str]] | None = None,
                 reviewed_at: str | None = None) -> None:
    _, job, ledger_path, old_ledger = _load_pair(root, job_raw)
    if job.get("state") != "MACHINE_VERIFIED":
        raise ValueError("human-reject requires MACHINE_VERIFIED")
    current_attempt = _current_attempt_id(job, old_ledger)
    if current_attempt != attempt_id:
        raise ValueError(f"human-reject attempt must equal current candidate attempt: {current_attempt!r}")
    outputs = [x for x in job.get("outputs") or [] if isinstance(x, dict)]
    if not outputs:
        raise ValueError("human-reject requires current outputs")
    evidence_bindings = [_binding(root, path, kind) for path, kind in (evidence or [])]
    if any(_is_visual_binding(x) for x in outputs):
        render_kind = (load_yaml(root / ARTIFACT_CONTRACT).get("machine_boundary") or {}).get("visual_render_evidence_kind")
        current_evidence = _binding_set(job.get("machine_evidence"))
        if not render_kind or _event_for_attempt(old_ledger, attempt_id, "FINAL_RENDER_COMPLETED",
                                                  require_kind_binding=(str(render_kind), current_evidence)) is None:
            raise ValueError("visual human-reject requires current-attempt FINAL_RENDER_COMPLETED and current render evidence")
    new_ledger = deepcopy(old_ledger)
    _append_event(root, job, new_ledger, "HUMAN_REVIEW_REJECTED", "ChatGPT", reviewed_at,
                  attempt_id=attempt_id, bindings=[*deepcopy(outputs), *evidence_bindings])
    errors = validate_ledger(new_ledger, root)
    if errors:
        raise ValueError(" | ".join(errors))
    _write_yaml(ledger_path, new_ledger)
    errors = validate_job(job, root, verification_mode="live")
    if errors:
        _write_yaml(ledger_path, old_ledger)
        raise ValueError(" | ".join(errors))


def human_accept(root: Path, job_raw: str, attempt_id: str, reviewed_at: str | None = None) -> None:
    job_path, old_job, ledger_path, old_ledger = _load_pair(root, job_raw)
    if old_job.get("state") != "MACHINE_VERIFIED":
        raise ValueError("human-accept requires MACHINE_VERIFIED")
    current_attempt = _current_attempt_id(old_job, old_ledger)
    if current_attempt != attempt_id:
        raise ValueError(f"human-accept attempt must equal current candidate attempt: {current_attempt!r}")
    outputs = [deepcopy(x) for x in old_job.get("outputs") or [] if isinstance(x, dict)]
    if not outputs:
        raise ValueError("human-accept requires outputs")
    ts = _timestamp(reviewed_at); new_job = deepcopy(old_job); new_ledger = deepcopy(old_ledger)
    new_job["human_acceptance"] = {"state": "REVIEW_PASS", "reviewer": "ChatGPT", "reviewed_at": ts, "accepted_outputs": outputs}
    _append_event(root, new_job, new_ledger, "HUMAN_REVIEW_ACCEPTED", "ChatGPT", ts,
                  attempt_id=attempt_id, bindings=outputs)
    _append_event(root, new_job, new_ledger, "HUMAN_ACCEPTED", "ChatGPT", ts, bindings=outputs)
    new_job["state"] = "HUMAN_ACCEPTED"
    _transaction(root, job_path, old_job, new_job, ledger_path, old_ledger, new_ledger)


def publish(root: Path, job_raw: str, published_at: str | None = None) -> None:
    job_path, old_job, ledger_path, old_ledger = _load_pair(root, job_raw)
    if old_job.get("state") != "HUMAN_ACCEPTED":
        raise ValueError("publish requires HUMAN_ACCEPTED")
    accepted = [deepcopy(x) for x in (old_job.get("human_acceptance") or {}).get("accepted_outputs") or [] if isinstance(x, dict)]
    if not accepted:
        raise ValueError("publish requires HUMAN-accepted outputs")
    ts = _timestamp(published_at); new_job = deepcopy(old_job); new_ledger = deepcopy(old_ledger)
    new_job["publication"] = {"state": "PUBLISHED", "published_at": ts, "outputs": accepted}
    _append_event(root, new_job, new_ledger, "PUBLISHED", "ChatGPT", ts, bindings=accepted)
    new_job["state"] = "PUBLISHED"
    _transaction(root, job_path, old_job, new_job, ledger_path, old_ledger, new_ledger)


def _pair(raw: str) -> tuple[str, str]:
    if "=" not in raw:
        raise argparse.ArgumentTypeError("expected PATH=KIND")
    path, kind = raw.rsplit("=", 1)
    if not path or not kind:
        raise argparse.ArgumentTypeError("expected non-empty PATH=KIND")
    return path, kind


def _selftest_snapshot(root: Path) -> str:
    (root / "production/provenance/repository-snapshots").mkdir(parents=True, exist_ok=True)
    (root / PROVENANCE_CONTRACT).write_text(
        "snapshot:\n  storage_root: production/provenance/repository-snapshots\n",
        encoding="utf-8",
    )
    entries = [
        repository_binding(root, "content/contract.yaml", "module_contract"),
        repository_binding(root, "tools/build.py", "builder"),
        repository_binding(root, "content/input.txt", "source"),
    ]
    snapshot = build_snapshot(entries, "a" * 40)
    return write_snapshot(snapshot, root=root).relative_to(root).as_posix()


def selftest() -> int:
    with tempfile.TemporaryDirectory(prefix="qz-manage-job-") as tmp:
        root = Path(tmp)
        (root / "production/contracts").mkdir(parents=True); (root / "content").mkdir(); (root / "tools").mkdir(); (root / "evidence").mkdir(); (root / "outputs").mkdir()
        (root / ARTIFACT_CONTRACT).write_text(
            "version: 1\nid: a\nauthority: artifact-lifecycle\n"
            "states: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\n"
            "allowed_module_lifecycle_for_new_job: [ACTIVE, FROZEN]\n"
            "required_top_level: [version, job_id, module_id, state, module_contract, execution_ledger, input_bindings, build_provenance, blocks, outputs, machine_evidence, human_acceptance, publication]\n"
            "build_provenance:\n  runtime_required_fields: [name, version]\n  source_snapshot:\n    binding_kind: repository_snapshot\n"
            "verification_modes:\n  live: {validate_current_input_paths: true}\n  historical: {validate_current_input_paths: false}\n"
            "ledger_evidence_events:\n"
            "  BUILT: {required_event: BUILD_COMPLETED, must_occur_after_state: BLOCKS_ACCEPTED, event_bindings_must_cover: outputs}\n"
            "  MACHINE_VERIFIED: {required_event: MACHINE_VERIFICATION_PASSED, must_occur_after_state: BUILT, event_bindings_must_include_kind: module_check}\n"
            "  HUMAN_ACCEPTED: {required_event: HUMAN_REVIEW_ACCEPTED, must_occur_after_state: MACHINE_VERIFIED, event_bindings_must_equal: human_acceptance.accepted_outputs}\n"
            "  VISUAL_HUMAN_ACCEPTED: {required_event: FINAL_RENDER_COMPLETED, must_occur_after_state: BUILT, event_bindings_must_include_kind: final_render_manifest}\n"
            "machine_boundary:\n  module_check_evidence_kind: module_check\n  visual_render_evidence_kind: final_render_manifest\n", encoding="utf-8")
        (root / LEDGER_CONTRACT).write_text(
            "version: 1\nappend_only: true\n"
            "lifecycle_transition_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED]\n"
            "event_types: [JOB_CREATED, INPUTS_LOCKED, BLOCKS_ACCEPTED, BUILT, MACHINE_VERIFIED, HUMAN_ACCEPTED, PUBLISHED, INPUT_BOUND, BLOCK_REVIEW_ACCEPTED, BUILD_STARTED, BUILD_COMPLETED, BUILD_FAILED, MACHINE_VERIFICATION_PASSED, MACHINE_VERIFICATION_FAILED, FINAL_RENDER_COMPLETED, HUMAN_REVIEW_ACCEPTED, HUMAN_REVIEW_REJECTED]\n"
            "attempt_event_types: [BUILD_STARTED, BUILD_COMPLETED, BUILD_FAILED, MACHINE_VERIFICATION_PASSED, MACHINE_VERIFICATION_FAILED, FINAL_RENDER_COMPLETED, HUMAN_REVIEW_ACCEPTED, HUMAN_REVIEW_REJECTED]\n"
            "attempt_protocol:\n  start: BUILD_STARTED\n  once_any_final_render_observed_all_reviewed_attempts_require_own_final_render: true\n", encoding="utf-8")
        (root / "content/contract.yaml").write_text("id: synthetic\n", encoding="utf-8")
        (root / "tools/build.py").write_text("# builder\n", encoding="utf-8")
        (root / "production/contracts/module-registry-v1.yaml").write_text(
            "allowed_lifecycle: [ACTIVE, FROZEN, DEFERRED, EXTERNAL, RETIRED]\nmodules:\n  synthetic:\n    lifecycle: ACTIVE\n    module_contract: content/contract.yaml\n    artifact_adapter:\n      build: tools/build.py\n", encoding="utf-8")
        for path, data in {
            "content/input.txt": b"input\n", "content/block.txt": b"block\n", "evidence/block-review.txt": b"review\n",
            "outputs/result.txt": b"result\n", "outputs/result-v1.pdf": b"%PDF-1.4\nv1\n", "outputs/result-v2.pdf": b"%PDF-1.4\nv2\n",
            "evidence/module-check.txt": b"PASS\n", "evidence/module-check-v1.txt": b"PASS-v1\n", "evidence/module-check-v2.txt": b"PASS-v2\n",
            "evidence/final-render-v1.txt": b"render-v1\n", "evidence/final-render-v2.txt": b"render-v2\n", "evidence/reject-v1.txt": b"reject-v1\n",
        }.items():
            (root / path).write_bytes(data)
        snapshot_rel = _selftest_snapshot(root)

        job_path, _ = initialize(root, "synthetic", "job-1", "production/job.yaml", "production/ledger.yaml", "2026-01-01T00:00:00Z")
        rel = job_path.relative_to(root).as_posix(); lock_inputs(root, rel, [("content/input.txt", "source")], snapshot_rel, "python", "3.12", "2026-01-01T00:00:01Z")
        accept_block(root, rel, "content", "content/block.txt", "content_block", "evidence/block-review.txt", "review_evidence", "2026-01-01T00:00:02Z"); advance(root, rel, "BLOCKS_ACCEPTED", "2026-01-01T00:00:03Z")
        start_attempt(root, rel, "a1", "Engine", "2026-01-01T00:00:04Z"); add_output(root, rel, "outputs/result.txt", "text")
        record_event(root, rel, "BUILD_COMPLETED", "Engine", "a1", [("outputs/result.txt", "text")], "2026-01-01T00:00:05Z"); advance(root, rel, "BUILT", "2026-01-01T00:00:06Z")
        add_machine_evidence(root, rel, "evidence/module-check.txt", "module_check"); record_event(root, rel, "MACHINE_VERIFICATION_PASSED", "Engine", "a1", [("evidence/module-check.txt", "module_check")], "2026-01-01T00:00:07Z")
        advance(root, rel, "MACHINE_VERIFIED", "2026-01-01T00:00:08Z"); human_accept(root, rel, "a1", "2026-01-01T00:00:09Z"); publish(root, rel, "2026-01-01T00:00:10Z")
        if validate_job(load_yaml(job_path), root, verification_mode="live"): print("FAIL: nonvisual lifecycle invalid"); return 1

        visual_path, _ = initialize(root, "synthetic", "job-2", "production/visual-job.yaml", "production/visual-ledger.yaml", "2026-01-01T00:01:00Z")
        vrel = visual_path.relative_to(root).as_posix(); lock_inputs(root, vrel, [("content/input.txt", "source")], snapshot_rel, "python", "3.12", "2026-01-01T00:01:01Z")
        accept_block(root, vrel, "content", "content/block.txt", "content_block", "evidence/block-review.txt", "review_evidence", "2026-01-01T00:01:02Z"); advance(root, vrel, "BLOCKS_ACCEPTED", "2026-01-01T00:01:03Z")
        start_attempt(root, vrel, "v1", "Engine", "2026-01-01T00:01:04Z"); add_output(root, vrel, "outputs/result-v1.pdf", "pdf")
        record_event(root, vrel, "BUILD_COMPLETED", "Engine", "v1", [("outputs/result-v1.pdf", "pdf")], "2026-01-01T00:01:05Z"); advance(root, vrel, "BUILT", "2026-01-01T00:01:06Z")
        add_machine_evidence(root, vrel, "evidence/module-check-v1.txt", "module_check"); record_event(root, vrel, "MACHINE_VERIFICATION_PASSED", "Engine", "v1", [("evidence/module-check-v1.txt", "module_check")], "2026-01-01T00:01:07Z")
        advance(root, vrel, "MACHINE_VERIFIED", "2026-01-01T00:01:08Z"); add_machine_evidence(root, vrel, "evidence/final-render-v1.txt", "final_render_manifest")
        record_event(root, vrel, "FINAL_RENDER_COMPLETED", "Engine", "v1", [("evidence/final-render-v1.txt", "final_render_manifest")], "2026-01-01T00:01:09Z")
        human_reject(root, vrel, "v1", [("evidence/reject-v1.txt", "human_review_reject_evidence")], "2026-01-01T00:01:10Z")
        if load_yaml(visual_path).get("state") != "MACHINE_VERIFIED": print("FAIL: reject changed lifecycle state"); return 1
        start_attempt(root, vrel, "v2", "Engine", "2026-01-01T00:01:11Z")
        record_event(root, vrel, "BUILD_COMPLETED", "Engine", "v2", [("outputs/result-v2.pdf", "pdf")], "2026-01-01T00:01:12Z")
        record_event(root, vrel, "MACHINE_VERIFICATION_PASSED", "Engine", "v2", [("evidence/module-check-v2.txt", "module_check")], "2026-01-01T00:01:13Z")
        activate_attempt(root, vrel, "v2", [("outputs/result-v2.pdf", "pdf")], [("evidence/module-check-v2.txt", "module_check")])
        add_machine_evidence(root, vrel, "evidence/final-render-v2.txt", "final_render_manifest"); record_event(root, vrel, "FINAL_RENDER_COMPLETED", "Engine", "v2", [("evidence/final-render-v2.txt", "final_render_manifest")], "2026-01-01T00:01:14Z")
        human_accept(root, vrel, "v2", "2026-01-01T00:01:15Z"); publish(root, vrel, "2026-01-01T00:01:16Z")
        final = load_yaml(visual_path); ledger = load_yaml(root / "production/visual-ledger.yaml")
        if validate_job(final, root, verification_mode="live"): print("FAIL: visual retry lifecycle invalid", validate_job(final, root, verification_mode="live")); return 1
        for key, expected in {"generation_review_cycles": 2, "build_count": 2, "final_render_count": 2, "review_reject_count": 1}.items():
            if (ledger.get("derived") or {}).get(key) != expected: print("FAIL: retry metric", key, ledger.get("derived")); return 1
    print("PASS: manage artifact job selftest"); return 0


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--root", type=Path, default=ROOT); parser.add_argument("--selftest", action="store_true"); sub = parser.add_subparsers(dest="command")
    p = sub.add_parser("lock-inputs"); p.add_argument("--job", required=True); p.add_argument("--input", action="append", type=_pair, default=[]); p.add_argument("--snapshot", required=True); p.add_argument("--runtime-name", required=True); p.add_argument("--runtime-version", required=True); p.add_argument("--occurred-at")
    p = sub.add_parser("accept-block"); p.add_argument("--job", required=True); p.add_argument("--block-id", required=True); p.add_argument("--artifact", type=_pair, required=True); p.add_argument("--evidence", type=_pair, required=True); p.add_argument("--reviewed-at")
    p = sub.add_parser("add-output"); p.add_argument("--job", required=True); p.add_argument("--binding", type=_pair, required=True)
    p = sub.add_parser("add-machine-evidence"); p.add_argument("--job", required=True); p.add_argument("--binding", type=_pair, required=True)
    p = sub.add_parser("advance"); p.add_argument("--job", required=True); p.add_argument("--to", required=True); p.add_argument("--occurred-at")
    p = sub.add_parser("record-event"); p.add_argument("--job", required=True); p.add_argument("--type", required=True); p.add_argument("--actor", required=True); p.add_argument("--attempt-id"); p.add_argument("--binding", action="append", type=_pair, default=[]); p.add_argument("--occurred-at")
    p = sub.add_parser("start-attempt"); p.add_argument("--job", required=True); p.add_argument("--attempt-id", required=True); p.add_argument("--actor", default="Engine"); p.add_argument("--occurred-at")
    p = sub.add_parser("activate-attempt"); p.add_argument("--job", required=True); p.add_argument("--attempt-id", required=True); p.add_argument("--output", action="append", type=_pair, default=[]); p.add_argument("--evidence", action="append", type=_pair, default=[])
    p = sub.add_parser("human-reject"); p.add_argument("--job", required=True); p.add_argument("--attempt-id", required=True); p.add_argument("--evidence", action="append", type=_pair, default=[]); p.add_argument("--reviewed-at")
    p = sub.add_parser("human-accept"); p.add_argument("--job", required=True); p.add_argument("--attempt-id", required=True); p.add_argument("--reviewed-at")
    p = sub.add_parser("publish"); p.add_argument("--job", required=True); p.add_argument("--published-at")
    args = parser.parse_args()
    if args.selftest: return selftest()
    if not args.command: parser.error("a command or --selftest is required")
    root = args.root.resolve()
    try:
        if args.command == "lock-inputs": lock_inputs(root, args.job, args.input, args.snapshot, args.runtime_name, args.runtime_version, args.occurred_at)
        elif args.command == "accept-block": accept_block(root, args.job, args.block_id, args.artifact[0], args.artifact[1], args.evidence[0], args.evidence[1], args.reviewed_at)
        elif args.command == "add-output": add_output(root, args.job, *args.binding)
        elif args.command == "add-machine-evidence": add_machine_evidence(root, args.job, *args.binding)
        elif args.command == "advance": advance(root, args.job, args.to, args.occurred_at)
        elif args.command == "record-event": record_event(root, args.job, args.type, args.actor, args.attempt_id, args.binding, args.occurred_at)
        elif args.command == "start-attempt": start_attempt(root, args.job, args.attempt_id, args.actor, args.occurred_at)
        elif args.command == "activate-attempt": activate_attempt(root, args.job, args.attempt_id, args.output, args.evidence)
        elif args.command == "human-reject": human_reject(root, args.job, args.attempt_id, args.evidence, args.reviewed_at)
        elif args.command == "human-accept": human_accept(root, args.job, args.attempt_id, args.reviewed_at)
        elif args.command == "publish": publish(root, args.job, args.published_at)
    except Exception as exc:
        print(f"FAIL: {exc}"); return 1
    print(f"PASS: {args.command}"); return 0


if __name__ == "__main__": raise SystemExit(main())
