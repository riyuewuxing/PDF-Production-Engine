#!/usr/bin/env python3
"""Canonical Teaching Demo Content gate.

This module contains the only complete Teaching Demo Content readiness/accepted
decision composition: ``validate``. Internal core, architecture and enforcement
modules expose primitives only.

Gate A RRA4 removes the remaining metadata/closure isolation design rather than
adding another guard. The historical internal-core ``validate/main`` aggregates
are physically absent; checker stage-collector wrappers are physically absent;
enforcement has no aggregate ``validate_case``. Acceptance isolation therefore
comes from capability removal and composition locality, not caller/stack/path/
function/code-object/closure metadata. ADR-018 separates one-product delivery
acceptance from Phase-B system qualification: accepted delivery still requires
the complete product-specific source/content/semantic/freeze/independent-review/
HUMAN-receipt chain, while controller provenance remains required for the
separate calibrated-claim qualification lane.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
from importlib.machinery import SourceFileLoader
import json
from pathlib import Path
import re
import tempfile
from typing import Any

import teaching_demo_content_architecture as arch
import teaching_demo_content_enforcement as enforcement

arch.SCRIPT_EVENT_TYPES.add("RESOURCE_REVEAL")

ROOT = Path(__file__).resolve().parents[1]
INTERNAL_CORE_PATH = Path("tools/_teaching_demo_content_core.inc")
ARCH_IMPL_PATH = Path("tools/_teaching_demo_content_architecture_impl.py")
ENFORCEMENT_PATH = Path("tools/teaching_demo_content_enforcement.py")
SOURCE_REVIEW_FILENAME = "SOURCE_REVIEW.yaml"
SOURCE_REVIEW_SCHEMA = "teaching-demo-source-review-v1"
PHASE_B_ACTIVATION_PATH = Path("production/process/teaching-demo-content/validation/phase-b/GATE_B_ACTIVATION.yaml")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _load_internal_core(module_name: str = "_teaching_demo_content_core"):
    path = ROOT / INTERNAL_CORE_PATH
    loader = SourceFileLoader(module_name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    if spec is None:
        raise RuntimeError("unable to create internal Teaching Demo content core module spec")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


core = _load_internal_core()
core.ARCH_FILES["source_review"] = SOURCE_REVIEW_FILENAME
_ORIGINAL_EXPECTED_SUBMISSION_BINDINGS = core.expected_submission_bindings
_ORIGINAL_LEGACY_DETERMINISTIC = core._validate_legacy_deterministic
_ORIGINAL_ARCHITECTURE_CASE = core.validate_architecture_case
_ORIGINAL_DERIVE_SCRIPT_FACTS = arch.derive_script_facts


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _git_blob_sha1(path: Path) -> str:
    size = path.stat().st_size
    h = hashlib.sha1()
    h.update(f"blob {size}\0".encode("ascii"))
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha256(path: Path) -> str:
    return arch.file_sha256(path)


def _validate_phase_b_activation(root: Path) -> list[str]:
    """Qualification-only lock: repository-local data cannot self-activate Gate B."""
    path = root / PHASE_B_ACTIVATION_PATH
    if path.exists():
        return [
            "CONTENT_PHASE_B_REPOSITORY_SELF_ACTIVATION_FORBIDDEN:"
            + PHASE_B_ACTIVATION_PATH.as_posix()
        ]
    return ["CONTENT_PHASE_B_CONTROLLER_NOT_IMPLEMENTED_PHASE_A_LOCK"]


def _derive_script_facts_v2(events: list[dict[str, Any]]) -> dict[str, Any]:
    return enforcement.upgrade_script_facts(_ORIGINAL_DERIVE_SCRIPT_FACTS(events), events)


arch.derive_script_facts = _derive_script_facts_v2


def _legacy_deterministic_scope_adapter(
    manifest: dict[str, Any], docs: dict[str, dict[str, Any]],
    board_plan: dict[str, Any], user_texts: dict[str, str],
) -> tuple[list[str], dict[str, Any]]:
    errors, context = _ORIGINAL_LEGACY_DETERMINISTIC(manifest, docs, board_plan, user_texts)
    preflight = docs.get("semantic_preflight") or {}
    context["practice_ids"] = set(enforcement.trial_event_practice_ids(preflight))
    return errors, context


def _architecture_case_supersession_adapter(*args: Any, **kwargs: Any) -> list[str]:
    """Adapt obsolete v8 diagnostics; current enforcement owns their replacements."""
    errors = _ORIGINAL_ARCHITECTURE_CASE(*args, **kwargs)
    obsolete = (
        "CONTENT_ACTUAL_ANSWER_RESOURCE_PREMATURE:",
        "CONTENT_ACTUAL_BOARD_KNOWLEDGE_WITHOUT_FORMATION:",
        "CONTENT_ACTUAL_BOARD_BEFORE_FORMATION:",
    )
    return [error for error in errors if not error.startswith(obsolete)]


def _validate_external_runner_resolution() -> list[str]:
    errors: list[str] = []
    for rid, spec in enforcement.ENFORCEMENT_SPECS.items():
        runner = spec.get("runner", "")
        if ":" not in runner:
            continue
        kind, target = runner.split(":", 1)
        if kind == "core" and not callable(getattr(core, target, None)):
            errors.append(f"CONTENT_ENFORCEMENT_CORE_RUNNER_MISSING:{rid}:{target}")
        elif kind == "checker" and not callable(globals().get(target)):
            errors.append(f"CONTENT_ENFORCEMENT_CHECKER_RUNNER_MISSING:{rid}:{target}")
    return errors


def _validate_entry_contract(contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if contract.get("canonical_checker") != "tools/check_teaching_demo_content.py":
        errors.append("CONTENT_ENTRY_CANONICAL_CHECKER_DRIFT")
    if contract.get("canonical_checker_internal_core") != INTERNAL_CORE_PATH.as_posix():
        errors.append("CONTENT_ENTRY_INTERNAL_CORE_CONTRACT_DRIFT")
    if contract.get("canonical_checker_internal_core_role") != "PRIMITIVES_ONLY_NO_ACCEPTANCE_ORCHESTRATION_AUTHORITY":
        errors.append("CONTENT_ENTRY_INTERNAL_CORE_ROLE_DRIFT")
    if contract.get("canonical_checker_internal_core_direct_execution") != "ABSENT_NO_CLI":
        errors.append("CONTENT_ENTRY_INTERNAL_CORE_EXECUTION_POLICY_DRIFT")
    if contract.get("canonical_checker_internal_core_aggregate_import_call") != "ABSENT_NO_AGGREGATE_SYMBOL":
        errors.append("CONTENT_ENTRY_INTERNAL_CORE_AGGREGATE_POLICY_DRIFT")
    if contract.get("canonical_checker_helper_impl") != ARCH_IMPL_PATH.as_posix():
        errors.append("CONTENT_ENTRY_ARCH_IMPL_CONTRACT_DRIFT")
    if contract.get("canonical_enforcement_helper") != ENFORCEMENT_PATH.as_posix():
        errors.append("CONTENT_ENTRY_ENFORCEMENT_CONTRACT_DRIFT")
    if hasattr(core, "validate") or hasattr(core, "main"):
        errors.append("CONTENT_ENTRY_INTERNAL_CORE_AGGREGATE_SYMBOL_PRESENT")
    if hasattr(enforcement, "validate_case"):
        errors.append("CONTENT_ENTRY_ENFORCEMENT_AGGREGATE_SYMBOL_PRESENT")
    architecture = contract.get("architecture_contract") or {}
    for key in (
        "source_identity_is_machine_verified",
        "source_visual_review_is_independent_human_evidence_machine_bound",
        "complete_machine_and_semantic_input_binding_required",
        "formal_source_must_be_repository_materialized_before_SOURCE_LOCKED",
        "executable_machine_requirement_registry_required",
        "post_freeze_human_acceptance_receipt_required",
        "internal_core_aggregate_symbols_absent_required",
        "checker_aggregate_stage_collectors_forbidden",
        "metadata_based_capability_isolation_forbidden",
        "bare_event_releases_may_not_create_hard_fact",
        "release_claim_visible_span_binding_required",
        "verified_first_release_required_for_hard_causality",
        "answer_bearing_full_show_forbidden",
        "first_full_exposure_must_be_resource_reveal",
        "phase_b_required_before_fresh_validation",
        "phase_b_repository_local_activation_forbidden",
        "phase_b_controller_required_for_calibrated_claim",
        "semantic_judge_role_fields_are_not_producer_provenance",
        "semantic_judge_producer_provenance_required_for_calibrated_claim",
    ):
        if architecture.get(key) is not True:
            errors.append(f"CONTENT_ENTRY_ARCHITECTURE_POLICY_MISSING:{key}")
    if architecture.get("delivery_accepted_mode_requires_phase_b_qualification") is not False:
        errors.append("CONTENT_ENTRY_DELIVERY_QUALIFICATION_COUPLING_DRIFT")
    if architecture.get("delivery_accepted_mode_state") != "AVAILABLE_WITH_PRODUCT_SPECIFIC_EVIDENCE":
        errors.append("CONTENT_ENTRY_DELIVERY_ACCEPTED_MODE_STATE_DRIFT")
    if architecture.get("acceptance_composition_locality") != "CANONICAL_CHECKER_VALIDATE_ONLY":
        errors.append("CONTENT_ENTRY_ACCEPTANCE_COMPOSITION_LOCALITY_DRIFT")
    source_review = contract.get("source_review_receipt") or {}
    if source_review.get("schema_id") != SOURCE_REVIEW_SCHEMA or source_review.get("path") != SOURCE_REVIEW_FILENAME:
        errors.append("CONTENT_SOURCE_REVIEW_CONTRACT_DRIFT")
    if source_review.get("reviewer_role_required") != "INDEPENDENT_SOURCE_REVIEWER":
        errors.append("CONTENT_SOURCE_REVIEW_ROLE_CONTRACT_DRIFT")
    if source_review.get("implementation_and_review_separate_required") is not True:
        errors.append("CONTENT_SOURCE_REVIEW_SEPARATION_CONTRACT_DRIFT")
    expected_fields = {
        "schema_id", "case_id", "reviewer_role", "implementation_and_review_separate", "source_binding",
        "reviewed_printed_pages", "reviewed_pdf_pages", "visual_open_and_review", "review_notes", "receipt_digest",
    }
    if set(source_review.get("required_fields") or []) != expected_fields:
        errors.append("CONTENT_SOURCE_REVIEW_REQUIRED_FIELDS_DRIFT")
    if (contract.get("required_semantic_artifacts") or {}).get("source_review") != SOURCE_REVIEW_FILENAME:
        errors.append("CONTENT_SOURCE_REVIEW_ARTIFACT_CONTRACT_MISSING")
    if (contract.get("content_addressed_gate_evidence") or {}).get("machine_and_judge_binding_closure_is_allowlist_complete") is not True:
        errors.append("CONTENT_GATE_BINDING_CLOSURE_POLICY_MISSING")
    if (contract.get("semantic_judges") or {}).get("work_packet_is_not_bound_until_freeze_because_single_packet_state_trace_advances_after_machine_gate") is not True:
        errors.append("CONTENT_WORK_PACKET_BINDING_LIFECYCLE_POLICY_MISSING")
    registry = contract.get("executable_enforcement_registry") or {}
    if registry.get("canonical_machine_gate_receipt_generator") != "tools/teaching_demo_content_enforcement.py#make_machine_gate_receipt":
        errors.append("CONTENT_MACHINE_GATE_RECEIPT_GENERATOR_CONTRACT_DRIFT")
    if set(registry.get("code_spec_requires") or []) != {"validator_id", "failure_code", "probe_id", "stage", "runner"}:
        errors.append("CONTENT_ENFORCEMENT_CODE_SPEC_CONTRACT_DRIFT")
    errors.extend(enforcement.validate_registry(contract))
    errors.extend(_validate_external_runner_resolution())
    return errors


def _source_lock_binding(root: Path, manifest: dict[str, Any]) -> tuple[dict[str, Any], Path | None, list[str]]:
    errors: list[str] = []
    inp = manifest.get("input")
    if not isinstance(inp, dict):
        return {}, None, ["CONTENT_SOURCE_INPUT_MISSING"]
    printed = inp.get("printed_pages")
    if not isinstance(printed, list) or not printed or not all(isinstance(x, int) and not isinstance(x, bool) and x > 0 for x in printed):
        errors.append("CONTENT_SOURCE_PRINTED_PAGES_INVALID")
        printed = []
    source = inp.get("source_pages")
    if not isinstance(source, dict):
        return {}, None, errors + ["CONTENT_SOURCE_LOCK_MISSING"]
    mode = source.get("mode")
    if mode not in {"repository-pdf", "remote-pdf"}:
        errors.append(f"CONTENT_SOURCE_MODE_INVALID:{mode!r}")
    pdf_pages = source.get("pages")
    if not isinstance(pdf_pages, list) or not pdf_pages or not all(isinstance(x, int) and not isinstance(x, bool) and x > 0 for x in pdf_pages):
        errors.append("CONTENT_SOURCE_PDF_PAGES_INVALID")
        pdf_pages = []
    if printed and pdf_pages and len(printed) != len(pdf_pages):
        errors.append("CONTENT_SOURCE_PAGE_COUNT_DRIFT")
    blob_sha = source.get("blob_sha")
    if not isinstance(blob_sha, str) or not HEX40.fullmatch(blob_sha):
        errors.append("CONTENT_SOURCE_BLOB_SHA_INVALID")
    size_bytes = source.get("size_bytes")
    if not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes <= 0:
        errors.append("CONTENT_SOURCE_SIZE_INVALID")
    sha256 = source.get("sha256")
    if not isinstance(sha256, str) or not HEX64.fullmatch(sha256):
        errors.append("CONTENT_SOURCE_SHA256_INVALID")
    normalized: dict[str, Any] = {
        "mode": mode, "printed_pages": list(printed), "pdf_pages": list(pdf_pages),
        "blob_sha": blob_sha, "size_bytes": size_bytes, "sha256": sha256,
    }
    source_file: Path | None = None
    if mode == "repository-pdf":
        raw_file = source.get("file")
        if not isinstance(raw_file, str) or not raw_file:
            errors.append("CONTENT_SOURCE_REPOSITORY_FILE_MISSING")
        else:
            try:
                source_file = core._repo_path(root, raw_file)
                if not source_file.is_file():
                    errors.append("CONTENT_SOURCE_REPOSITORY_NOT_FILE")
                else:
                    if isinstance(size_bytes, int) and source_file.stat().st_size != size_bytes:
                        errors.append("CONTENT_SOURCE_REPOSITORY_SIZE_DRIFT")
                    if isinstance(blob_sha, str) and HEX40.fullmatch(blob_sha) and _git_blob_sha1(source_file) != blob_sha:
                        errors.append("CONTENT_SOURCE_REPOSITORY_BLOB_DRIFT")
                    if isinstance(sha256, str) and HEX64.fullmatch(sha256) and _sha256(source_file) != sha256:
                        errors.append("CONTENT_SOURCE_REPOSITORY_SHA256_DRIFT")
            except Exception as exc:
                errors.append(f"CONTENT_SOURCE_REPOSITORY_FILE_INVALID:{exc}")
        normalized["file"] = raw_file
        audit = source.get("audit_locator")
        if not isinstance(audit, dict):
            errors.append("CONTENT_SOURCE_AUDIT_LOCATOR_MISSING")
            audit = {}
        audit_norm = {key: audit.get(key) for key in ("repo", "ref", "path", "blob_sha")}
        for key in ("repo", "ref", "path", "blob_sha"):
            if not _nonempty(audit_norm.get(key)):
                errors.append(f"CONTENT_SOURCE_AUDIT_LOCATOR_FIELD_MISSING:{key}")
        if _nonempty(raw_file) and audit_norm.get("path") != raw_file:
            errors.append("CONTENT_SOURCE_AUDIT_PATH_DRIFT")
        if isinstance(blob_sha, str) and audit_norm.get("blob_sha") != blob_sha:
            errors.append("CONTENT_SOURCE_AUDIT_BLOB_DRIFT")
        normalized["audit_locator"] = audit_norm
    elif mode == "remote-pdf":
        remote = {key: source.get(key) for key in ("repo", "ref", "path")}
        for key in ("repo", "path"):
            if not _nonempty(remote.get(key)):
                errors.append(f"CONTENT_SOURCE_REMOTE_FIELD_MISSING:{key}")
        ref = remote.get("ref")
        if not isinstance(ref, str) or not HEX40.fullmatch(ref):
            errors.append("CONTENT_SOURCE_REMOTE_REF_NOT_IMMUTABLE_COMMIT")
        normalized.update(remote)
    normalized["binding_digest"] = arch.stable_json_sha256(normalized)
    return normalized, source_file, errors


def _validate_source_review(workspace: Path, manifest: dict[str, Any], binding: dict[str, Any]) -> list[str]:
    path = workspace / SOURCE_REVIEW_FILENAME
    if not path.is_file():
        return [f"CONTENT_SOURCE_REVIEW_MISSING:{SOURCE_REVIEW_FILENAME}"]
    try:
        doc = core._yaml(path)
    except Exception as exc:
        return [f"CONTENT_SOURCE_REVIEW_INVALID:{exc}"]
    errors: list[str] = []
    if doc.get("schema_id") != SOURCE_REVIEW_SCHEMA:
        errors.append("CONTENT_SOURCE_REVIEW_SCHEMA_INVALID")
    if doc.get("case_id") != manifest.get("case_id"):
        errors.append("CONTENT_SOURCE_REVIEW_CASE_DRIFT")
    if doc.get("reviewer_role") != "INDEPENDENT_SOURCE_REVIEWER":
        errors.append("CONTENT_SOURCE_REVIEW_ROLE_INVALID")
    if doc.get("implementation_and_review_separate") is not True:
        errors.append("CONTENT_SOURCE_REVIEW_SEPARATION_NOT_DECLARED")
    if doc.get("source_binding") != binding:
        errors.append("CONTENT_SOURCE_REVIEW_BINDING_STALE")
    if doc.get("reviewed_printed_pages") != binding.get("printed_pages"):
        errors.append("CONTENT_SOURCE_REVIEW_PRINTED_PAGES_DRIFT")
    if doc.get("reviewed_pdf_pages") != binding.get("pdf_pages"):
        errors.append("CONTENT_SOURCE_REVIEW_PDF_PAGES_DRIFT")
    if doc.get("visual_open_and_review") != "PASS":
        errors.append("CONTENT_SOURCE_REVIEW_VISUAL_NOT_PASS")
    if not _nonempty(doc.get("review_notes")):
        errors.append("CONTENT_SOURCE_REVIEW_NOTES_MISSING")
    basis = dict(doc)
    declared = basis.pop("receipt_digest", None)
    if not isinstance(declared, str) or declared != arch.stable_json_sha256(basis):
        errors.append("CONTENT_SOURCE_REVIEW_RECEIPT_DIGEST_DRIFT")
    return errors


def _reference_receipt_paths(root: Path, workspace: Path) -> list[Path]:
    evidence = core._yaml(workspace / core.LEGACY_SEMANTIC_FILES["evidence"])
    receipts = ((evidence.get("reference_learning") or {}).get("selected_case_receipts") or [])
    if not isinstance(receipts, list):
        raise ValueError("selected_case_receipts must be a list")
    return [core._repo_path(root, raw) for raw in receipts]


def _expanded_machine_gate_bindings(root: Path, manifest_path: Path, manifest: dict[str, Any], workspace: Path) -> dict[str, str]:
    contract = core._yaml(root / core.CONTRACT_PATH)
    usage_contract = (contract.get("repository_reference_benchmark") or {}).get("usage_contract")
    paths: dict[str, Path] = {
        "manifest": manifest_path, "process": root / core.PROCESS_PATH,
        "contract": root / core.CONTRACT_PATH, "checker": root / core.CHECKER_PATH,
        "internal_core": root / INTERNAL_CORE_PATH, "architecture_helper": root / core.HELPER_PATH,
        "architecture_helper_impl": root / ARCH_IMPL_PATH, "enforcement_helper": root / ENFORCEMENT_PATH,
        "reference_usage_contract": core._repo_path(root, usage_contract),
        "source_review": workspace / SOURCE_REVIEW_FILENAME,
        "lesson_evidence_ir": workspace / core.ARCH_FILES["lesson_evidence_ir"],
        "script_events": workspace / core.ARCH_FILES["script_events"],
        "script_facts_file": workspace / core.ARCH_FILES["script_facts"],
        "board_plan": workspace / core.BOARD_PLAN,
    }
    for key, filename in core.LEGACY_SEMANTIC_FILES.items():
        paths[key] = workspace / filename
    sources = manifest.get("source") or {}
    for role in core.USER_ROLES:
        paths[f"user_{role}"] = core._workspace_file(workspace, sources.get(role))
    for idx, path in enumerate(_reference_receipt_paths(root, workspace), start=1):
        paths[f"reference_receipt_{idx:02d}"] = path
    source_binding, source_file, source_errors = _source_lock_binding(root, manifest)
    if source_errors:
        raise ValueError("source lock invalid while producing machine bindings: " + ";".join(source_errors))
    if source_file is not None:
        paths["source_pdf_file"] = source_file
    out = {key: _sha256(path) for key, path in paths.items()}
    out["source_lock_digest"] = str(source_binding.get("binding_digest"))
    out["enforcement_registry_digest"] = enforcement.registry_digest()
    return dict(sorted(out.items()))


def _expanded_expected_submission_bindings(
    root: Path, manifest_path: Path, manifest: dict[str, Any], workspace: Path,
    selected_receipts: list[Path],
) -> dict[str, dict[str, str]]:
    out = _ORIGINAL_EXPECTED_SUBMISSION_BINDINGS(root, manifest_path, manifest, workspace, selected_receipts)
    extra = {
        "content_checker_internal_core": root / INTERNAL_CORE_PATH,
        "content_architecture_helper_impl": root / ARCH_IMPL_PATH,
        "content_enforcement_helper": root / ENFORCEMENT_PATH,
    }
    for key, path in extra.items():
        out[key] = {"path": core._repo_rel(root, path), "sha256": _sha256(path)}
    _, source_file, source_errors = _source_lock_binding(root, manifest)
    if source_errors:
        raise ValueError("source lock invalid while producing freeze bindings: " + ";".join(source_errors))
    if source_file is not None:
        out["source_pdf_file"] = {"path": core._repo_rel(root, source_file), "sha256": _sha256(source_file)}
    return out


def _machine_gate_trace_prefix(work_packet: dict[str, Any]) -> list[dict[str, Any]]:
    trace = work_packet.get("state_trace")
    if not isinstance(trace, list):
        return []
    count = arch.STATES.index("MACHINE_GATED")
    return [dict(item) for item in trace[:count] if isinstance(item, dict)]


def _validate_machine_gate_state_trace_link(workspace: Path) -> list[str]:
    try:
        packet = core._yaml(workspace / core.ARCH_FILES["work_packet"])
        receipt = core._yaml(workspace / core.ARCH_FILES["machine_gate"])
    except Exception as exc:
        return [f"CONTENT_MACHINE_GATE_STATE_TRACE_LINK_LOAD_FAILED:{exc}"]
    prefix = _machine_gate_trace_prefix(packet)
    expected_pairs = [(arch.STATES[i], arch.STATES[i + 1]) for i in range(arch.STATES.index("MACHINE_GATED"))]
    actual_pairs = [(item.get("from_state"), item.get("to_state")) for item in prefix]
    errors: list[str] = []
    if actual_pairs != expected_pairs:
        errors.append(f"CONTENT_MACHINE_GATE_STATE_TRACE_PREFIX_DRIFT:expected={expected_pairs}:actual={actual_pairs}")
    if receipt.get("state_trace_prefix_digest") != arch.stable_json_sha256(prefix):
        errors.append("CONTENT_MACHINE_GATE_STATE_TRACE_PREFIX_DIGEST_DRIFT")
    return errors


core._validate_legacy_deterministic = _legacy_deterministic_scope_adapter
core.validate_architecture_case = _architecture_case_supersession_adapter
core._machine_gate_bindings = _expanded_machine_gate_bindings
core.expected_submission_bindings = _expanded_expected_submission_bindings
core._machine_requirement_ids = enforcement.machine_gate_requirement_ids


def validate(manifest_raw: str, *, root: Path = ROOT, require_independent: bool = False) -> list[str]:
    """Compose the sole complete readiness / delivery-accepted decision path.

    require_independent=True is product Delivery Acceptance under ADR-018.
    It does not assert or require Phase-B calibrated-claim qualification.
    """
    errors: list[str] = []
    try:
        contract = core._yaml(root / core.CONTRACT_PATH)
        if contract.get("id") != "teaching-demo-content" or contract.get("status") != "ACTIVE_CANONICAL":
            return ["CONTENT_CANONICAL_CONTRACT_INVALID"]
        manifest_path = core._repo_path(root, manifest_raw)
        manifest = core._yaml(manifest_path)
        if manifest.get("content_contract") != "teaching-demo-content":
            return ["CONTENT_MANIFEST_CONTRACT_DRIFT"]
        workspace = core._repo_path(root, manifest.get("workspace"))
        if not workspace.is_dir():
            return ["CONTENT_WORKSPACE_NOT_DIRECTORY"]
    except Exception as exc:
        return [f"CONTENT_SOURCE_PRECONDITION_LOAD_FAILED:{exc}"]

    # Entry, source identity/review and architecture contract are all local to
    # the sole composition. No helper aggregates these stages.
    errors.extend(_validate_entry_contract(contract))
    errors.extend(core.validate_architecture_contract(contract))
    if (contract.get("single_line_policy") or {}).get("canonical_branch") == "main":
        errors.extend(core.validate_single_line(root))
    binding, _, source_errors = _source_lock_binding(root, manifest)
    errors.extend(source_errors)
    if not source_errors:
        errors.extend(_validate_source_review(workspace, manifest, binding))
    if errors:
        return errors

    # Mature F1–F6 and architecture-case primitives are invoked directly here.
    user_texts = core._user_texts(manifest, workspace, errors)
    legacy = core._load_mapping(workspace, core.LEGACY_SEMANTIC_FILES, errors, "CONTENT_REQUIRED_ARTIFACT")
    arch_docs = core._load_mapping(workspace, core.ARCH_FILES, errors, "CONTENT_ARCH_REQUIRED_ARTIFACT")
    try:
        board_plan = core._yaml(workspace / core.BOARD_PLAN)
    except Exception as exc:
        errors.append(f"CONTENT_REQUIRED_ARTIFACT_INVALID:{core.BOARD_PLAN}:{exc}")
        board_plan = {}
    if errors:
        return errors

    legacy_errors, legacy_context = _legacy_deterministic_scope_adapter(manifest, legacy, board_plan, user_texts)
    errors.extend(legacy_errors)
    selected_receipts = core._selected_reference_receipts(root, legacy["evidence"], errors)
    errors.extend(_architecture_case_supersession_adapter(
        root, contract, manifest_path, manifest, workspace, legacy, arch_docs,
        board_plan, user_texts, legacy_context,
    ))
    if errors:
        return errors

    errors.extend(_validate_machine_gate_state_trace_link(workspace))
    errors.extend(enforcement.validate_registry(contract))
    errors.extend(enforcement.validate_source_mode(manifest))
    errors.extend(enforcement.validate_reference_candidates(workspace))
    errors.extend(enforcement.validate_release_claim_structure(workspace))
    errors.extend(enforcement.validate_resource_visibility(workspace))
    errors.extend(enforcement.validate_practice_occurrences(workspace))
    errors.extend(enforcement.validate_formula_typing(workspace))
    errors.extend(enforcement.validate_state_evidence_refs(
        workspace, str(binding.get("binding_digest") or "")
    ))
    errors.extend(enforcement.validate_machine_receipt_metadata(workspace, contract))
    errors.extend(enforcement.validate_release_semantic_verification(workspace))
    errors.extend(enforcement.validate_board_strict_after_formation(workspace))
    errors.extend(enforcement.validate_resource_reveal_after_verified_formation(workspace))
    if errors:
        return errors

    # Freeze is also composed here, not behind a recoverable stage closure.
    try:
        packet = core._yaml(workspace / core.ARCH_FILES["work_packet"])
    except Exception as exc:
        return [f"CONTENT_FINALIZATION_LOAD_FAILED:{exc}"]
    main_sha = packet.get("main_sha")
    errors.extend(core.validate_submission_freeze(
        root, manifest_path, manifest, workspace, selected_receipts,
        expected_source_commit=main_sha if isinstance(main_sha, str) else None,
    ))
    if errors:
        return errors

    # Product-specific acceptance remains local to this sole aggregate. Phase-B
    # controller provenance is a separate qualification lane and is deliberately
    # not called here.
    if require_independent:
        errors.extend(core.validate_independent_review(
            root, contract, manifest_path, manifest, workspace, selected_receipts,
        ))
        if errors:
            return errors
        errors.extend(enforcement.validate_human_acceptance_receipt(
            workspace, manifest.get("case_id"), str(main_sha or ""),
        ))
    return errors


def validate_single_line(root: Path, branches: object = None) -> list[str]:
    return core.validate_single_line(root, branches)


def validate_architecture_contract(contract: dict[str, Any]) -> list[str]:
    return core.validate_architecture_contract(contract) + _validate_entry_contract(contract)


def _source_selftest() -> None:
    with tempfile.TemporaryDirectory(prefix="qz-source-lock-") as tmp:
        root = Path(tmp)
        (root / "assets").mkdir(parents=True)
        source = root / "assets" / "book.pdf"
        source.write_bytes(b"%PDF-1.4\nsource-lock-test\n")
        blob = _git_blob_sha1(source)
        manifest = {"case_id": "fixture", "input": {"printed_pages": [1], "source_pages": {
            "mode": "repository-pdf", "file": "assets/book.pdf", "blob_sha": blob,
            "size_bytes": source.stat().st_size, "sha256": _sha256(source), "pages": [2],
            "audit_locator": {"repo": "fixture/repo", "ref": "main", "path": "assets/book.pdf", "blob_sha": blob},
        }}}
        binding, path, errors = _source_lock_binding(root, manifest)
        assert errors == [] and path == source and binding["binding_digest"]
        bad = json.loads(json.dumps(manifest))
        bad["input"]["source_pages"]["sha256"] = "0" * 64
        assert any("SHA256_DRIFT" in e for e in _source_lock_binding(root, bad)[2])
        remote = json.loads(json.dumps(manifest))
        remote["input"]["source_pages"] = {
            "mode": "remote-pdf", "repo": "x/y", "ref": "a" * 40, "path": "book.pdf",
            "blob_sha": "b" * 40, "size_bytes": 1, "sha256": "c" * 64, "pages": [2],
        }
        assert enforcement.validate_source_mode(remote)


def _phase_b_activation_selftest() -> None:
    with tempfile.TemporaryDirectory(prefix="qz-phase-b-activation-") as tmp:
        root = Path(tmp)
        assert _validate_phase_b_activation(root) == [
            "CONTENT_PHASE_B_CONTROLLER_NOT_IMPLEMENTED_PHASE_A_LOCK"
        ]
        activation_path = root / PHASE_B_ACTIVATION_PATH
        activation_path.parent.mkdir(parents=True, exist_ok=True)
        activation_path.write_text(
            "schema_id: teaching-demo-gate-b-activation-v1\n"
            "decision: GATE_B_PASS\n"
            "reviewer_role: INDEPENDENT_GATE_B_REVIEWER\n"
            "implementation_and_review_separate: true\n"
            "semantic_judge_runtime:\n"
            "  trust_state: GATE_B_CALIBRATED\n"
            "  science_evidence_judge_runner: forged-runner\n"
            "  enactment_student_judge_runner: forged-runner\n"
            "bindings: {}\n"
            "activation_digest: forged\n",
            encoding="utf-8",
        )
        errors = _validate_phase_b_activation(root)
        assert len(errors) == 1 and "REPOSITORY_SELF_ACTIVATION_FORBIDDEN" in errors[0]


def _migration_adapter_selftest() -> None:
    docs = {"semantic_preflight": {"practice_inventory": [
        {"item_id": "T1", "execution_scope": "trial_event", "prompt_role": "trial"},
        {"item_id": "S1", "execution_scope": "support_product", "prompt_role": "exam_skeleton"},
    ]}}
    assert enforcement.trial_event_practice_ids(docs["semantic_preflight"]) == ["T1"]
    synthetic = [
        "CONTENT_ACTUAL_ANSWER_RESOURCE_PREMATURE:R1:K1",
        "CONTENT_ACTUAL_BOARD_KNOWLEDGE_WITHOUT_FORMATION:B1:K1",
        "CONTENT_ACTUAL_BOARD_BEFORE_FORMATION:B1:K1",
        "CONTENT_ACTUAL_INTERACTION_CHAIN_INCOMPLETE:C1",
    ]
    obsolete = (
        "CONTENT_ACTUAL_ANSWER_RESOURCE_PREMATURE:",
        "CONTENT_ACTUAL_BOARD_KNOWLEDGE_WITHOUT_FORMATION:",
        "CONTENT_ACTUAL_BOARD_BEFORE_FORMATION:",
    )
    assert [e for e in synthetic if not e.startswith(obsolete)] == ["CONTENT_ACTUAL_INTERACTION_CHAIN_INCOMPLETE:C1"]


def _receipt_contract_selftest() -> None:
    requirement_ids = {
        rid for rid, spec in enforcement.ENFORCEMENT_SPECS.items()
        if enforcement.STAGE_ORDER.index(spec["stage"]) <= enforcement.MACHINE_GATE_MAX_STAGE
    }
    prefix = [{"from_state": "SOURCE_LOCKED", "to_state": "EVIDENCE_READY"}]
    bindings = {"fixture": "digest"}
    receipt = arch.make_machine_gate_receipt(
        source_commit="0" * 40, bindings=bindings,
        requirement_ids=requirement_ids, state_trace_prefix=prefix,
    )
    assert arch.validate_machine_gate_receipt(
        receipt, source_commit="0" * 40, bindings=bindings,
        requirement_ids=requirement_ids,
    ) == []
    assert receipt["enforcement_registry_digest"] == enforcement.registry_digest()
    assert receipt["state_trace_prefix_digest"] == arch.stable_json_sha256(prefix)
    assert all(item.get("runner") for item in receipt["requirements"])
    assert _validate_external_runner_resolution() == []


def _core_primitives_selftest() -> None:
    core.selftest()


def _capability_removal_selftest() -> None:
    """RRA4 regressions: no recoverable alternate aggregate capability exists."""
    assert not hasattr(core, "validate") and not hasattr(core, "main")
    assert not hasattr(enforcement, "validate_case")
    for forbidden in (
        "_run_core_primitives", "_validate_freeze_review_acceptance",
        "_guard_stage_collector", "_canonical_validate_context_allowed",
        "_make_canonical_context_guard",
    ):
        assert forbidden not in globals()
    assert validate.__closure__ is None

    # Compile the exact internal-core source with attacker-selected co_filename.
    # There is still no aggregate symbol to call because capability was removed.
    source = (ROOT / INTERNAL_CORE_PATH).read_text(encoding="utf-8")
    scope: dict[str, Any] = {
        "__name__": "_alternate_core_probe",
        "__file__": "/tmp/attacker/alternate_core.py",
    }
    exec(compile(source, "/tmp/attacker/alternate_core.py", "exec"), scope)
    assert "validate" not in scope and "main" not in scope


def _lifecycle_order_selftest() -> None:
    assert enforcement.STAGE_ORDER.index("SEMANTIC_JUDGED") < enforcement.STAGE_ORDER.index("SUBMISSION_FROZEN")


def selftest() -> None:
    _core_primitives_selftest()
    enforcement.selftest()
    _source_selftest()
    _phase_b_activation_selftest()
    _migration_adapter_selftest()
    _receipt_contract_selftest()
    _capability_removal_selftest()
    _lifecycle_order_selftest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--mode", choices=("readiness", "accepted"), default="readiness")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--check-single-line", action="store_true")
    parser.add_argument("--branch-inventory", type=Path)
    args = parser.parse_args()
    selftest()
    if args.selftest:
        print("PASS: canonical Teaching Demo content gate selftest (ADR-018 delivery/qualification split)")
        return 0
    if args.check_single_line:
        if not args.branch_inventory:
            parser.error("--check-single-line requires --branch-inventory JSON")
        try:
            branches = json.loads(args.branch_inventory.read_text(encoding="utf-8"))
            errors = validate_single_line(ROOT, branches)
        except (OSError, ValueError) as exc:
            errors = [f"CONTENT_SINGLE_LINE_INPUT_INVALID:{exc}"]
        print("FAIL: repository single-line cleanup" if errors else "PASS: supplied current tree and retired-branch inventory")
        for error in errors:
            print("- " + error)
        return 1 if errors else 0
    if not args.manifest:
        parser.error("--manifest is required unless --selftest/--check-single-line is used")
    errors = validate(args.manifest, require_independent=args.mode == "accepted")
    if errors:
        print(f"FAIL: canonical Teaching Demo content gate ({args.mode})")
        for error in errors:
            print("- " + error)
        return 1
    print(f"PASS: canonical Teaching Demo content gate ({args.mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
