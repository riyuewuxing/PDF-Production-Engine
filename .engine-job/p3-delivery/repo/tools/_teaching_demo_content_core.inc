#!/usr/bin/env python3
"""Teaching Demo Content deterministic primitive library.

Internal library only. This file intentionally exposes no complete readiness or
accepted orchestration and no CLI. The sole Teaching Demo Content decision
composer is ``tools/check_teaching_demo_content.py#validate``. The functions in
this module are low-level deterministic validators, binding helpers and primitive
selftests used by that canonical checker.

Gate A RRA4 physically removes the historical aggregate ``validate`` and
``main`` bodies. Capability isolation therefore does not depend on caller,
stack, path, code-object or closure metadata.
"""
from __future__ import annotations

from pathlib import Path
import re
import tempfile
from typing import Any

import yaml

import teaching_demo_content_architecture as arch

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = Path("production/contracts/teaching-demo-content.yaml")
PROCESS_PATH = Path("production/process/teaching-demo-content/PROCESS.md")
CHECKER_PATH = Path("tools/check_teaching_demo_content.py")
HELPER_PATH = Path("tools/teaching_demo_content_architecture.py")
REFERENCE_ROOT = Path("production/reference-materials/teacher_teaching_demo/purchased-transcript-selection-2026-08-27")
CANONICAL_PROCESS = PROCESS_PATH.as_posix()

REVIEW_FILENAME = "INDEPENDENT_CONTENT_REVIEW.yaml"
FREEZE_FILENAME = "SUBMISSION_FREEZE.yaml"
MACHINE_GATE_FILENAME = "MACHINE_GATE.yaml"
REVIEW_SCHEMA = "teaching-demo-content-review"
FREEZE_SCHEMA = "teaching-demo-content-submission-freeze"

USER_ROLES = ("reference_plan", "exam_skeleton", "trial", "defense", "analysis")
LEGACY_SEMANTIC_FILES = {
    "evidence": "evidence.yaml",
    "science_reasoning": "SCIENCE_REASONING_AUDIT.yaml",
    "teaching_boundary": "teaching-boundary.yaml",
    "point_chain": "point-chain.yaml",
    "student_state": "STUDENT_STATE_LEDGER.yaml",
    "resource_action": "RESOURCE_ACTION_MAP.yaml",
    "board_timeline": "BOARD_TIMELINE.yaml",
    "enactment_timeline": "ENACTMENT_TIMELINE.yaml",
    "semantic_preflight": "semantic-preflight-review.yaml",
}
ARCH_FILES = {
    "lesson_evidence_ir": "LESSON_EVIDENCE_IR.yaml",
    "script_events": "SCRIPT_EVENTS.yaml",
    "script_facts": "SCRIPT_FACTS.yaml",
    "work_packet": "WORK_PACKET.yaml",
    "machine_gate": MACHINE_GATE_FILENAME,
    "science_evidence_judge": "SCIENCE_EVIDENCE_JUDGE.yaml",
    "enactment_student_judge": "ENACTMENT_STUDENT_JUDGE.yaml",
}
BOARD_PLAN = "BOARD_PLAN.yaml"

SCIENCE_FIELDS = (
    "claim_id", "claim", "evidence_refs", "direct_observation", "inference",
    "alternative_explanations", "exclusion_or_limitation", "max_justified_conclusion",
    "boundary_not_claimed", "misconception_risk",
)
POINT_FIELDS = (
    "point_id", "learning_gain", "prerequisite_knowledge_ids", "evidence_or_resource_ids",
    "formation_cycle_id", "next_need", "out_of_scope_guard",
)
CYCLE_FIELDS = (
    "cycle_id", "point_id", "instruction_mode", "interaction_required", "knows_before",
    "visible_now", "resource_ids", "teacher_prompt", "student_task", "plausible_short_response",
    "likely_wrong_response", "scaffold_1", "scaffold_2", "formed_knowledge_ids",
    "formation_evidence", "enactment",
)
RESOURCE_FIELDS = (
    "resource_id", "asset_path_or_source_page", "identity", "reveal_before_cycle",
    "teacher_action", "student_observes", "directly_observed", "inferred_from_conditions",
    "task", "supports_claims", "use_mode", "visible_information_ids",
    "answer_bearing_information_ids", "mask_policy",
)
BOARD_FIELDS = (
    "delta_id", "trigger_cycle", "prerequisite_knowledge_ids", "newly_formed_knowledge_ids",
    "add_only", "forbidden_before_trigger",
)
IR_FIELDS = (
    "knowledge_id", "claim", "claim_strength", "source_evidence_ids", "prior_student_knowledge_ids",
    "visible_evidence_before_task", "resource_state_before_task", "student_task",
    "permissible_response", "forbidden_response_requires_future_info", "scaffold_level",
    "teacher_scaffold_boundary", "formation_claim", "formation_requires", "board_after_formation",
    "practice_links",
)

INSTRUCTION_MODES = {
    "teacher_explanation", "teacher_demonstration", "scaffolded_formation",
    "independent_transfer", "evaluation",
}
INTERACTIVE_MODES = {"scaffolded_formation", "independent_transfer", "evaluation"}
RESOURCE_USE_MODES = {"discovery", "scaffold", "verification", "illustration", "teacher_demo"}
MASK_POLICIES = {"none_needed", "masked_until_formation", "cropped_until_formation"}
RELEASE_STAGES = {"prior_known", "prompt", "student_paraphrase", "feedback", "formation", "teacher_explanation"}
FIGURE_DATA_STATUS = {"not_needed", "provided", "source_bound"}
SPOKEN_EVENT_TYPES = set(arch.TEXT_EVENT_TYPES)

FORBIDDEN_USER_PATTERNS = (
    re.compile(r"\bcase_id\b", re.I),
    re.compile(r"\bslot[_ -]?\d+\b", re.I),
    re.compile(r"\breceipt(?:_id)?\b", re.I),
    re.compile(r"\bevent_id\b", re.I),
    re.compile(r"\brequirement_id\b", re.I),
    re.compile(r"\bP3_[A-Z0-9_]+\b"),
    re.compile(r"\bM1-R\d+\b", re.I),
)


def _yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"top-level YAML must be mapping: {path}")
    return data


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _repo_path(root: Path, raw: Any, *, must_exist: bool = True) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("repository-relative path required")
    rel = Path(raw)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"unsafe repository path: {raw}")
    path = (root / rel).resolve()
    path.relative_to(root.resolve())
    if must_exist and not path.exists():
        raise ValueError(f"path missing: {raw}")
    return path


def _workspace_file(workspace: Path, raw: Any) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("workspace-relative path required")
    path = (workspace / raw).resolve()
    path.relative_to(workspace.resolve())
    if not path.is_file():
        raise ValueError(f"workspace file missing: {raw}")
    return path


def _sha256(path: Path) -> str:
    return arch.file_sha256(path)


def _repo_rel(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _required_fields(item: Any, fields: tuple[str, ...] | list[str], label: str, errors: list[str]) -> None:
    if not isinstance(item, dict):
        errors.append(f"{label}_NOT_MAPPING")
        return
    for field in fields:
        if field not in item or item.get(field) is None or item.get(field) == "":
            errors.append(f"{label}_FIELD_MISSING:{field}")


def _unique_ids(items: list[Any], field: str, label: str, errors: list[str]) -> list[str]:
    ids: list[str] = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict) or not _nonempty(item.get(field)):
            errors.append(f"{label}_ID_INVALID:{idx}")
            continue
        ids.append(item[field])
    if len(ids) != len(set(ids)):
        errors.append(f"{label}_ID_DUPLICATE")
    return ids


def _range2(value: Any) -> bool:
    return (
        isinstance(value, list) and len(value) == 2
        and all(isinstance(x, (int, float)) and not isinstance(x, bool) and x >= 0 for x in value)
        and value[1] >= value[0]
    )


def _normalized_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _render_trial_lines(events: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for event in events:
        if event.get("type") not in SPOKEN_EVENT_TYPES:
            continue
        text = event.get("text")
        if isinstance(text, str) and text.strip():
            lines.extend(_normalized_lines(text))
    return lines


def _ordered_contains(sequence: list[str], expected: list[str]) -> bool:
    cursor = 0
    for item in sequence:
        if cursor < len(expected) and item == expected[cursor]:
            cursor += 1
    return cursor == len(expected)


def validate_single_line(root: Path, branches: object = None) -> list[str]:
    errors: list[str] = []
    contract = _yaml(root / CONTRACT_PATH)
    policy = contract.get("single_line_policy") or {}
    for raw in policy.get("forbidden_current_tree_roots", []):
        if (root / raw).exists():
            errors.append(f"CONTENT_OLD_ROUTE_PRESENT:{raw}")
    for raw in policy.get("forbidden_current_tree_exact", []):
        if (root / raw).exists():
            errors.append(f"CONTENT_OLD_ROUTE_PRESENT:{raw}")
    for base in ("production/process", "production/teaching-demo-cases"):
        directory = root / base
        if not directory.exists():
            continue
        for path in directory.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            parts = path.relative_to(directory).parts[:-1]
            if any(re.search(r"(?:^|[-_])(backup|legacy|experimental|compatibility|revisions)(?:$|[-_])", p, re.I) for p in parts):
                errors.append(f"CONTENT_PARALLEL_COPY:{rel}")
            if base == "production/process" and parts and "teaching-demo" in parts[0] and parts[0] != "teaching-demo-content":
                errors.append(f"CONTENT_PARALLEL_PROCESS:{rel}")
    entries = (
        "AGENTS.md",
        "content/job-search/teacher/interview/teaching-demo/AGENTS.md",
        "content/job-search/teacher/interview/teaching-demo/README.md",
    )
    old_links = (
        "references/trial-script.md", "references/page-to-skeleton.md", "references/exam-skeleton-plan.md",
        "references/board-system.md", "NEXT_IMPLEMENTATION_SESSION.md", "transcript-closeout-m1",
    )
    for raw in entries:
        path = root / raw
        if not path.is_file():
            errors.append(f"CONTENT_ENTRY_MISSING:{raw}")
            continue
        text = path.read_text(encoding="utf-8")
        if CANONICAL_PROCESS not in text:
            errors.append(f"CONTENT_ENTRY_NOT_CANONICAL:{raw}")
        if any(old in text for old in old_links):
            errors.append(f"CONTENT_ENTRY_OLD_RULE_LINK:{raw}")
    state = _yaml(root / "CURRENT_STATE.yaml")
    current = state.get("teaching_demo_content") or {}
    if current.get("canonical_branch") != "main" or current.get("process") != CANONICAL_PROCESS:
        errors.append("CONTENT_GLOBAL_ENTRY_DRIFT")
    if branches is not None:
        if not isinstance(branches, list) or not branches:
            return errors + ["CONTENT_BRANCH_INVENTORY_INVALID"]
        names = [b.get("name") for b in branches if isinstance(b, dict)]
        if "main" not in names:
            errors.append("CONTENT_MAIN_BRANCH_MISSING")
        allowed_tree = policy.get("retired_branch_tree_sha")
        for branch in branches:
            if not isinstance(branch, dict) or branch.get("name") == "main":
                continue
            tree = ((branch.get("commit") or {}).get("tree") or {}).get("sha")
            if not allowed_tree or tree != allowed_tree:
                errors.append(f"CONTENT_REMOTE_BRANCH_REQUIRES_RETIREMENT:{branch.get('name')}")
    return errors


def validate_architecture_contract(contract: dict[str, Any]) -> list[str]:
    errors = arch.validate_requirement_registry(contract.get("requirement_registry"))
    if contract.get("version") != 9:
        errors.append(f"CONTENT_ARCH_CONTRACT_VERSION_INVALID:{contract.get('version')}")
    if contract.get("architecture_decision") != "architecture/adr/ADR-012-evidence-carrying-teaching-script-compiler.md":
        errors.append("CONTENT_ARCH_ADR_BINDING_INVALID")
    if set(contract.get("enforcement_classes") or []) != arch.ENFORCEMENT_CLASSES:
        errors.append("CONTENT_ARCH_ENFORCEMENT_CLASSES_DRIFT")
    state = contract.get("content_state_machine") or {}
    if tuple(state.get("states") or []) != arch.STATES:
        errors.append("CONTENT_ARCH_STATE_LIST_DRIFT")
    declared = {tuple(x) for x in state.get("allowed_transitions") or [] if isinstance(x, list) and len(x) == 2}
    if declared != arch.ALLOWED_TRANSITIONS:
        errors.append("CONTENT_ARCH_ALLOWED_TRANSITIONS_DRIFT")
    trace_policy = state.get("durable_transition_trace") or {}
    if trace_policy.get("complete_prefix_from_SOURCE_LOCKED_required") is not True:
        errors.append("CONTENT_ARCH_DURABLE_STATE_TRACE_POLICY_MISSING")
    work_required = (contract.get("phase_specific_work_packet") or {}).get("required_fields") or []
    if "state_trace" not in work_required:
        errors.append("CONTENT_ARCH_WORK_PACKET_STATE_TRACE_CONTRACT_MISSING")
    if (contract.get("semantic_preflight") or {}).get("author_self_checks_have_gate_authority") is not False:
        errors.append("CONTENT_ARCH_AUTHOR_SELF_CHECK_HAS_GATE_AUTHORITY")
    if (contract.get("semantic_judges") or {}).get("verdict_schema", {}).get("blocking_unknown_is_pass") is not False:
        errors.append("CONTENT_ARCH_UNKNOWN_POLICY_NOT_FAIL_CLOSED")
    return errors


def _user_texts(manifest: dict[str, Any], workspace: Path, errors: list[str]) -> dict[str, str]:
    sources = manifest.get("source") or {}
    if not isinstance(sources, dict):
        errors.append("CONTENT_MANIFEST_SOURCE_MAP_INVALID")
        return {}
    texts: dict[str, str] = {}
    for role in USER_ROLES:
        try:
            path = _workspace_file(workspace, sources.get(role))
            text = path.read_text(encoding="utf-8")
        except Exception as exc:
            errors.append(f"CONTENT_USER_ROLE_MISSING:{role}:{exc}")
            continue
        texts[role] = text
        for pattern in FORBIDDEN_USER_PATTERNS:
            match = pattern.search(text)
            if match:
                errors.append(f"CONTENT_INTERNAL_METADATA_LEAK:{role}:{match.group(0)}")
                break
    return texts


def _load_mapping(workspace: Path, mapping: dict[str, str], errors: list[str], label: str) -> dict[str, dict[str, Any]]:
    docs: dict[str, dict[str, Any]] = {}
    for key, filename in mapping.items():
        try:
            docs[key] = _yaml(workspace / filename)
        except Exception as exc:
            errors.append(f"{label}_INVALID:{filename}:{exc}")
    return docs


def _selected_reference_receipts(root: Path, evidence_doc: dict[str, Any], errors: list[str]) -> list[Path]:
    learning = evidence_doc.get("reference_learning")
    if not isinstance(learning, dict):
        errors.append("CONTENT_REFERENCE_LEARNING_MISSING")
        return []
    for key in ("lesson_family", "selected_case_receipts", "mechanisms", "transfer_to_cycles", "structural_candidate_comparison"):
        if learning.get(key) in (None, "", []):
            errors.append(f"CONTENT_REFERENCE_LEARNING_FIELD_MISSING:{key}")
    mechanisms = learning.get("mechanisms")
    if not isinstance(mechanisms, list) or not mechanisms or not all(_nonempty(x) for x in mechanisms):
        errors.append("CONTENT_REFERENCE_MECHANISMS_INVALID")
    transfers = learning.get("transfer_to_cycles")
    if not isinstance(transfers, dict) or not transfers:
        errors.append("CONTENT_REFERENCE_TRANSFER_MAP_INVALID")
    errors.extend(arch.validate_reference_candidate_comparison(learning.get("structural_candidate_comparison"), minimum=2))
    receipts = learning.get("selected_case_receipts")
    if not isinstance(receipts, list) or not receipts:
        errors.append("CONTENT_REFERENCE_RECEIPTS_MISSING")
        return []
    out: list[Path] = []
    ref_root = (root / REFERENCE_ROOT).resolve()
    for raw in receipts:
        try:
            path = _repo_path(root, raw)
            path.resolve().relative_to(ref_root)
        except Exception:
            errors.append(f"CONTENT_REFERENCE_RECEIPT_OUTSIDE_CANONICAL:{raw}")
            continue
        if path.name != "CASE.yaml":
            errors.append(f"CONTENT_REFERENCE_RECEIPT_NOT_CASE_YAML:{raw}")
            continue
        try:
            receipt = _yaml(path)
        except Exception as exc:
            errors.append(f"CONTENT_REFERENCE_RECEIPT_INVALID:{raw}:{exc}")
            continue
        verification = receipt.get("verification") or {}
        if verification.get("visual_open_and_review") != "PASS":
            errors.append(f"CONTENT_REFERENCE_RECEIPT_NOT_VISUALLY_REVIEWED:{raw}")
        if not isinstance(receipt.get("mechanism_summary"), list) or not receipt.get("mechanism_summary"):
            errors.append(f"CONTENT_REFERENCE_RECEIPT_MECHANISM_MISSING:{raw}")
        out.append(path)
    comparison = learning.get("structural_candidate_comparison") or {}
    selected = comparison.get("selected_case_receipt") if isinstance(comparison, dict) else None
    if selected not in receipts:
        errors.append("CONTENT_REFERENCE_SELECTED_COMPARISON_DRIFT")
    return out


def _validate_legacy_deterministic(manifest: dict[str, Any], docs: dict[str, dict[str, Any]],
                                   board_plan: dict[str, Any], user_texts: dict[str, str]) -> tuple[list[str], dict[str, Any]]:
    """Preserve deterministic v8 protections without treating author PASS as semantic evidence."""
    errors: list[str] = []
    context: dict[str, Any] = {}
    case_id = manifest.get("case_id")
    trial = user_texts.get("trial", "")

    evidence_units = docs["evidence"].get("evidence_units") or []
    if not isinstance(evidence_units, list) or not evidence_units:
        errors.append("CONTENT_EVIDENCE_UNITS_MISSING")
        evidence_units = []
    evidence_ids = _unique_ids(evidence_units, "id", "CONTENT_EVIDENCE", errors)
    for idx, unit in enumerate(evidence_units):
        if not isinstance(unit, dict):
            errors.append(f"CONTENT_EVIDENCE_NOT_MAPPING:{idx}")
            continue
        if not _nonempty(unit.get("summary")):
            errors.append(f"CONTENT_EVIDENCE_SUMMARY_MISSING:{idx}")
        if not _nonempty(unit.get("kind")):
            errors.append(f"CONTENT_EVIDENCE_KIND_MISSING:{idx}")
    context["evidence_ids"] = set(evidence_ids)

    claims = docs["science_reasoning"].get("claims") or []
    if not isinstance(claims, list) or not claims:
        errors.append("CONTENT_SCIENCE_CLAIMS_MISSING")
        claims = []
    claim_ids = _unique_ids(claims, "claim_id", "CONTENT_CLAIM", errors)
    for idx, claim in enumerate(claims):
        _required_fields(claim, SCIENCE_FIELDS, f"CONTENT_CLAIM[{idx}]", errors)
        if not isinstance(claim, dict):
            continue
        refs = claim.get("evidence_refs")
        if not isinstance(refs, list) or not refs:
            errors.append(f"CONTENT_CLAIM_EVIDENCE_REFS_INVALID:{claim.get('claim_id')}")
        else:
            for ref in refs:
                if ref not in evidence_ids:
                    errors.append(f"CONTENT_CLAIM_EVIDENCE_UNKNOWN:{claim.get('claim_id')}:{ref}")
        if not isinstance(claim.get("alternative_explanations"), list):
            errors.append(f"CONTENT_CLAIM_ALTERNATIVES_INVALID:{claim.get('claim_id')}")
    context["claim_ids"] = set(claim_ids)

    boundary = docs["teaching_boundary"]
    for key in ("must_teach", "may_mention", "out_of_scope"):
        if not isinstance(boundary.get(key), list):
            errors.append(f"CONTENT_BOUNDARY_FIELD_INVALID:{key}")
    if not boundary.get("must_teach"):
        errors.append("CONTENT_BOUNDARY_MUST_TEACH_EMPTY")

    points = docs["point_chain"].get("points") or []
    if not isinstance(points, list) or not points:
        errors.append("CONTENT_POINT_CHAIN_MISSING")
        points = []
    point_ids = _unique_ids(points, "point_id", "CONTENT_POINT", errors)
    for idx, point in enumerate(points):
        _required_fields(point, POINT_FIELDS, f"CONTENT_POINT[{idx}]", errors)
        if isinstance(point, dict):
            for key in ("prerequisite_knowledge_ids", "evidence_or_resource_ids"):
                if not isinstance(point.get(key), list):
                    errors.append(f"CONTENT_POINT_LIST_INVALID:{point.get('point_id')}:{key}")

    cycles = docs["student_state"].get("cycles") or []
    if not isinstance(cycles, list) or not cycles:
        errors.append("CONTENT_STUDENT_CYCLES_MISSING")
        cycles = []
    cycle_ids = _unique_ids(cycles, "cycle_id", "CONTENT_CYCLE", errors)
    cycle_index = {cid: i for i, cid in enumerate(cycle_ids)}
    cycle_by_id: dict[str, dict[str, Any]] = {}
    knowledge_formation: dict[str, str] = {}
    formed_by_cycle: dict[str, set[str]] = {}
    cumulative: set[str] = set()
    for idx, cycle in enumerate(cycles):
        _required_fields(cycle, CYCLE_FIELDS, f"CONTENT_CYCLE[{idx}]", errors)
        if not isinstance(cycle, dict):
            continue
        cid = str(cycle.get("cycle_id"))
        cycle_by_id[cid] = cycle
        if cycle.get("point_id") not in point_ids:
            errors.append(f"CONTENT_CYCLE_POINT_UNKNOWN:{cid}:{cycle.get('point_id')}")
        mode = cycle.get("instruction_mode")
        if mode not in INSTRUCTION_MODES:
            errors.append(f"CONTENT_CYCLE_INSTRUCTION_MODE_INVALID:{cid}:{mode}")
        interaction = cycle.get("interaction_required")
        if not isinstance(interaction, bool):
            errors.append(f"CONTENT_CYCLE_INTERACTION_FLAG_INVALID:{cid}")
        if mode in INTERACTIVE_MODES and interaction is not True:
            errors.append(f"CONTENT_INTERACTIVE_MODE_MUST_PERFORM_INTERACTION:{cid}")
        if mode not in INTERACTIVE_MODES and interaction is True:
            errors.append(f"CONTENT_NONINTERACTIVE_MODE_MISDECLARED_INTERACTIVE:{cid}")
        for key in ("knows_before", "visible_now", "resource_ids", "formed_knowledge_ids"):
            if not isinstance(cycle.get(key), list):
                errors.append(f"CONTENT_CYCLE_LIST_INVALID:{cid}:{key}")
        formed = cycle.get("formed_knowledge_ids")
        if not isinstance(formed, list) or not formed or not all(_nonempty(x) for x in formed):
            errors.append(f"CONTENT_CYCLE_FORMED_KNOWLEDGE_INVALID:{cid}")
            formed = []
        for kid in formed:
            if kid in knowledge_formation:
                errors.append(f"CONTENT_KNOWLEDGE_FORMED_TWICE:{kid}")
            knowledge_formation[kid] = cid
        cumulative |= set(formed)
        formed_by_cycle[cid] = set(cumulative)
        enact = cycle.get("enactment")
        if not isinstance(enact, dict):
            errors.append(f"CONTENT_CYCLE_ENACTMENT_INVALID:{cid}")
            continue
        keys = ["prompt_anchor", "formation_anchor"]
        if interaction:
            keys = ["prompt_anchor", "invite_anchor", "listen_anchor", "paraphrase_anchor", "feedback_anchor", "formation_anchor"]
        positions: list[int] = []
        for key in keys:
            anchor = enact.get(key)
            if not _nonempty(anchor):
                errors.append(f"CONTENT_ENACTMENT_ANCHOR_MISSING:{cid}:{key}")
                continue
            count = trial.count(anchor)
            if count != 1:
                errors.append(f"CONTENT_ENACTMENT_ANCHOR_OCCURRENCE:{cid}:{key}:{count}")
            else:
                positions.append(trial.index(anchor))
        if len(positions) == len(keys) and positions != sorted(positions):
            errors.append(f"CONTENT_ENACTMENT_ANCHOR_ORDER_INVALID:{cid}")
        if not isinstance(enact.get("board_delta_ids"), list) or not enact.get("board_delta_ids"):
            errors.append(f"CONTENT_ENACTMENT_BOARD_IDS_INVALID:{cid}")
    context.update({"cycle_ids": cycle_ids, "cycle_index": cycle_index, "cycle_by_id": cycle_by_id,
                    "knowledge_formation": knowledge_formation, "formed_by_cycle": formed_by_cycle})

    for point in points:
        if isinstance(point, dict) and point.get("formation_cycle_id") not in cycle_index:
            errors.append(f"CONTENT_POINT_FORMATION_CYCLE_UNKNOWN:{point.get('point_id')}:{point.get('formation_cycle_id')}")

    resources = docs["resource_action"].get("resources") or []
    if not isinstance(resources, list):
        errors.append("CONTENT_RESOURCES_INVALID")
        resources = []
    resource_ids = _unique_ids(resources, "resource_id", "CONTENT_RESOURCE", errors)
    resource_by_id: dict[str, dict[str, Any]] = {}
    for idx, resource in enumerate(resources):
        _required_fields(resource, RESOURCE_FIELDS, f"CONTENT_RESOURCE[{idx}]", errors)
        if not isinstance(resource, dict):
            continue
        rid = str(resource.get("resource_id"))
        resource_by_id[rid] = resource
        if resource.get("reveal_before_cycle") not in cycle_index:
            errors.append(f"CONTENT_RESOURCE_REVEAL_CYCLE_UNKNOWN:{rid}:{resource.get('reveal_before_cycle')}")
        if resource.get("use_mode") not in RESOURCE_USE_MODES:
            errors.append(f"CONTENT_RESOURCE_USE_MODE_INVALID:{rid}:{resource.get('use_mode')}")
        if resource.get("mask_policy") not in MASK_POLICIES:
            errors.append(f"CONTENT_RESOURCE_MASK_POLICY_INVALID:{rid}:{resource.get('mask_policy')}")
        for key in ("visible_information_ids", "answer_bearing_information_ids", "supports_claims"):
            if not isinstance(resource.get(key), list):
                errors.append(f"CONTENT_RESOURCE_LIST_INVALID:{rid}:{key}")
        for claim_id in resource.get("supports_claims") or []:
            if claim_id not in claim_ids:
                errors.append(f"CONTENT_RESOURCE_CLAIM_UNKNOWN:{rid}:{claim_id}")
        if (resource.get("answer_bearing_information_ids") and resource.get("use_mode") in {"discovery", "scaffold"}
                and resource.get("mask_policy") not in {"masked_until_formation", "cropped_until_formation"}):
            errors.append(f"CONTENT_ANSWER_BEARING_RESOURCE_UNMASKED:{rid}")
    context.update({"resource_ids": set(resource_ids), "resource_by_id": resource_by_id})

    valid_refs = set(evidence_ids) | set(resource_ids)
    for point in points:
        if isinstance(point, dict):
            for ref in point.get("evidence_or_resource_ids") or []:
                if ref not in valid_refs:
                    errors.append(f"CONTENT_POINT_SUPPORT_UNKNOWN:{point.get('point_id')}:{ref}")
    for cid, cycle in cycle_by_id.items():
        for rid in cycle.get("resource_ids") or []:
            if rid not in resource_by_id:
                errors.append(f"CONTENT_CYCLE_RESOURCE_UNKNOWN:{cid}:{rid}")
            else:
                reveal = resource_by_id[rid].get("reveal_before_cycle")
                if reveal in cycle_index and cycle_index[reveal] > cycle_index.get(cid, -1):
                    errors.append(f"CONTENT_CYCLE_USES_UNREVEALED_RESOURCE:{cid}:{rid}")

    transfers = (docs["evidence"].get("reference_learning") or {}).get("transfer_to_cycles")
    if isinstance(transfers, dict):
        unknown = sorted(set(transfers) - set(cycle_ids))
        if unknown:
            errors.append(f"CONTENT_REFERENCE_TRANSFER_UNKNOWN_CYCLE:{unknown}")

    deltas = docs["board_timeline"].get("board_deltas") or []
    if not isinstance(deltas, list) or not deltas:
        errors.append("CONTENT_BOARD_DELTAS_MISSING")
        deltas = []
    delta_ids = _unique_ids(deltas, "delta_id", "CONTENT_BOARD_DELTA", errors)
    delta_by_id: dict[str, dict[str, Any]] = {}
    flattened_board: list[str] = []
    expected_board_events: list[tuple[str, str, set[str]]] = []
    last_trigger = -1
    for idx, delta in enumerate(deltas):
        _required_fields(delta, BOARD_FIELDS, f"CONTENT_BOARD_DELTA[{idx}]", errors)
        if not isinstance(delta, dict):
            continue
        did = str(delta.get("delta_id"))
        delta_by_id[did] = delta
        trigger = delta.get("trigger_cycle")
        if trigger not in cycle_index:
            errors.append(f"CONTENT_BOARD_TRIGGER_UNKNOWN:{did}:{trigger}")
            continue
        trigger_index = cycle_index[trigger]
        if trigger_index < last_trigger:
            errors.append(f"CONTENT_BOARD_TIME_ORDER_DRIFT:{did}")
        last_trigger = max(last_trigger, trigger_index)
        prereq, newly, add_only = delta.get("prerequisite_knowledge_ids"), delta.get("newly_formed_knowledge_ids"), delta.get("add_only")
        if not isinstance(prereq, list) or not isinstance(newly, list) or not isinstance(add_only, list):
            errors.append(f"CONTENT_BOARD_KNOWLEDGE_LIST_INVALID:{did}")
            continue
        if not add_only:
            errors.append(f"CONTENT_BOARD_EMPTY_DELTA:{did}")
        flattened_board.extend(str(x) for x in add_only)
        knowledge_used = set(str(x) for x in prereq + newly)
        expected_board_events.extend((did, str(text), knowledge_used) for text in add_only)
        available = formed_by_cycle.get(str(trigger), set())
        missing = set(prereq) - available
        if missing:
            errors.append(f"CONTENT_BOARD_USES_UNFORMED_KNOWLEDGE:{did}:{sorted(missing)}")
        unformed_results = set(newly) - available
        if unformed_results:
            errors.append(f"CONTENT_BOARD_WRITES_UNFORMED_RESULT:{did}:{sorted(unformed_results)}")
    context.update({"delta_ids": set(delta_ids), "delta_by_id": delta_by_id, "expected_board_events": expected_board_events})
    for cid, cycle in cycle_by_id.items():
        enact = cycle.get("enactment") or {}
        for did in enact.get("board_delta_ids") or []:
            if did not in delta_ids:
                errors.append(f"CONTENT_ENACTMENT_BOARD_DELTA_UNKNOWN:{cid}:{did}")
    if board_plan.get("source_of_truth") != "BOARD_TIMELINE.yaml":
        errors.append("CONTENT_BOARD_PLAN_NOT_DERIVED_FROM_TIMELINE")
    if board_plan.get("final_board") != flattened_board:
        errors.append("CONTENT_FINAL_BOARD_NOT_DELTA_ACCUMULATION")

    preflight = docs["semantic_preflight"]
    for key in ("science_red_team", "student_state_simulation", "enactment_board_dry_run"):
        if preflight.get(key) is None:
            errors.append(f"CONTENT_AUTHOR_SELF_CHECK_MISSING:{key}")
    if preflight.get("hard_fail_triggered") not in ([], None):
        errors.append("CONTENT_AUTHOR_PREFLIGHT_HARD_FAIL_PRESENT")
    cycle_audit = preflight.get("cycle_enactment_audit")
    if not isinstance(cycle_audit, list):
        errors.append("CONTENT_CYCLE_ENACTMENT_AUDIT_MISSING")
    else:
        audited = {x.get("cycle_id") for x in cycle_audit if isinstance(x, dict)}
        if audited != set(cycle_ids):
            errors.append("CONTENT_CYCLE_ENACTMENT_AUDIT_COVERAGE_DRIFT")
        for item in cycle_audit:
            if not isinstance(item, dict) or not _nonempty(item.get("attack_notes")):
                errors.append("CONTENT_CYCLE_ENACTMENT_AUDIT_ITEM_INVALID")

    release_audit = preflight.get("information_release_audit")
    if not isinstance(release_audit, list):
        errors.append("CONTENT_INFORMATION_RELEASE_AUDIT_MISSING")
    else:
        release_ids: set[str] = set()
        for item in release_audit:
            _required_fields(item, ["knowledge_id", "formation_cycle_id", "spoken_first_release_anchor", "spoken_release_stage",
                                    "resource_answer_visible_before_task", "board_visible_before_task", "decision"],
                             "CONTENT_INFORMATION_RELEASE", errors)
            if not isinstance(item, dict):
                continue
            kid = item.get("knowledge_id")
            release_ids.add(str(kid))
            if item.get("formation_cycle_id") != knowledge_formation.get(kid):
                errors.append(f"CONTENT_INFORMATION_RELEASE_FORMATION_DRIFT:{kid}")
            if item.get("spoken_release_stage") not in RELEASE_STAGES:
                errors.append(f"CONTENT_INFORMATION_RELEASE_STAGE_INVALID:{kid}")
            anchor = item.get("spoken_first_release_anchor")
            if _nonempty(anchor) and trial.count(anchor) != 1:
                errors.append(f"CONTENT_INFORMATION_RELEASE_ANCHOR_INVALID:{kid}:{trial.count(anchor)}")
        if release_ids != set(knowledge_formation):
            errors.append("CONTENT_INFORMATION_RELEASE_COVERAGE_DRIFT")

    if preflight.get("practice_inventory_complete") is not True:
        errors.append("CONTENT_PRACTICE_INVENTORY_NOT_COMPLETE")
    practice = preflight.get("practice_inventory")
    if not isinstance(practice, list):
        errors.append("CONTENT_PRACTICE_INVENTORY_INVALID")
        practice = []
    practice_ids = _unique_ids(practice, "item_id", "CONTENT_PRACTICE", errors)
    for idx, item in enumerate(practice):
        _required_fields(item, ["item_id", "prompt_role", "prompt_anchor", "answer_role", "answer_anchor", "figure_or_data_status", "decision"],
                         f"CONTENT_PRACTICE[{idx}]", errors)
        if not isinstance(item, dict):
            continue
        pr, ar = item.get("prompt_role"), item.get("answer_role")
        if pr not in user_texts or ar not in user_texts:
            errors.append(f"CONTENT_PRACTICE_ROLE_INVALID:{item.get('item_id')}")
            continue
        if user_texts[pr].count(item.get("prompt_anchor", "")) != 1:
            errors.append(f"CONTENT_PRACTICE_PROMPT_ANCHOR_INVALID:{item.get('item_id')}")
        if user_texts[ar].count(item.get("answer_anchor", "")) != 1:
            errors.append(f"CONTENT_PRACTICE_ANSWER_ANCHOR_INVALID:{item.get('item_id')}")
        if item.get("figure_or_data_status") not in FIGURE_DATA_STATUS:
            errors.append(f"CONTENT_PRACTICE_DATA_STATUS_INVALID:{item.get('item_id')}")
    context["practice_ids"] = set(practice_ids)

    timeline = docs["enactment_timeline"]
    status = timeline.get("status")
    if status not in {"ESTIMATE", "MEASURED"}:
        errors.append("CONTENT_ENACTMENT_STATUS_INVALID")
    if status == "MEASURED" and not _nonempty(timeline.get("rehearsal_evidence")):
        errors.append("CONTENT_MEASURED_WITHOUT_REHEARSAL_EVIDENCE")
    total_min = total_max = 0.0
    segments = timeline.get("segments") or []
    if not isinstance(segments, list) or not segments:
        errors.append("CONTENT_ENACTMENT_SEGMENTS_MISSING")
        segments = []
    for idx, seg in enumerate(segments):
        if not isinstance(seg, dict):
            errors.append(f"CONTENT_ENACTMENT_SEGMENT_INVALID:{idx}")
            continue
        for key in ("id", "trial_anchor", "spoken_equivalent", "speech_seconds_range", "board_seconds", "resource_view_seconds",
                    "think_or_response_seconds", "overlap", "elapsed_seconds_range"):
            if seg.get(key) is None or seg.get(key) == "":
                errors.append(f"CONTENT_ENACTMENT_SEGMENT_FIELD_MISSING:{idx}:{key}")
        anchor = seg.get("trial_anchor")
        if _nonempty(anchor) and trial.count(anchor) != 1:
            errors.append(f"CONTENT_ENACTMENT_SEGMENT_ANCHOR_INVALID:{idx}:{trial.count(anchor)}")
        speech = seg.get("speech_seconds_range")
        if not _range2(speech):
            errors.append(f"CONTENT_ENACTMENT_SPEECH_RANGE_INVALID:{idx}")
            continue
        fixed = 0.0
        for key in ("board_seconds", "resource_view_seconds", "think_or_response_seconds"):
            value = seg.get(key)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                errors.append(f"CONTENT_ENACTMENT_TIME_INVALID:{idx}:{key}")
            else:
                fixed += float(value)
        overlap_min = overlap_max = 0.0
        overlaps = seg.get("overlap")
        if not isinstance(overlaps, list):
            errors.append(f"CONTENT_ENACTMENT_OVERLAP_INVALID:{idx}")
            overlaps = []
        for j, ov in enumerate(overlaps):
            if not isinstance(ov, dict) or not isinstance(ov.get("between"), list) or len(ov.get("between")) != 2 or not _range2(ov.get("seconds_range")):
                errors.append(f"CONTENT_ENACTMENT_OVERLAP_ITEM_INVALID:{idx}:{j}")
                continue
            overlap_min += float(ov["seconds_range"][0]); overlap_max += float(ov["seconds_range"][1])
        calc = [float(speech[0]) + fixed - overlap_max, float(speech[1]) + fixed - overlap_min]
        declared = seg.get("elapsed_seconds_range")
        if not _range2(declared) or any(abs(float(declared[k]) - calc[k]) > 1e-6 for k in (0, 1)):
            errors.append(f"CONTENT_ENACTMENT_ELAPSED_DRIFT:{idx}:expected={calc}:actual={declared}")
        total_min += calc[0]; total_max += calc[1]
    total = timeline.get("total_seconds_range")
    if not _range2(total) or any(abs(float(total[k]) - [total_min, total_max][k]) > 1e-6 for k in (0, 1)):
        errors.append(f"CONTENT_ENACTMENT_TOTAL_DRIFT:expected={[total_min,total_max]}:actual={total}")
    profile = timeline.get("duration_profile")
    if not isinstance(profile, dict) or profile.get("source") not in {"task", "declared_profile", "none"}:
        errors.append("CONTENT_DURATION_PROFILE_INVALID")
    elif profile.get("source") != "none":
        if not _range2(profile.get("target_seconds_range")):
            errors.append("CONTENT_DURATION_TARGET_INVALID")
        sensitivity = profile.get("sensitivity_check")
        if not isinstance(sensitivity, dict) or not _nonempty(sensitivity.get("note")):
            errors.append("CONTENT_DURATION_SENSITIVITY_INVALID")

    for key, doc in docs.items():
        declared = doc.get("case_id")
        if declared is not None and declared != case_id:
            errors.append(f"CONTENT_CASE_ID_DRIFT:{key}:{declared!r}!={case_id!r}")
    if board_plan.get("case_id") not in (None, case_id):
        errors.append("CONTENT_CASE_ID_DRIFT:board_plan")
    return errors, context


def _validate_ir(contract: dict[str, Any], ir: dict[str, Any], source_ids: set[str]) -> tuple[list[str], set[str]]:
    errors: list[str] = []
    if ir.get("schema_id") != "teaching-demo-lesson-evidence-ir-v1":
        errors.append("CONTENT_ARCH_IR_SCHEMA_INVALID")
    units = ir.get("knowledge_units")
    if not isinstance(units, list) or not units:
        errors.append("CONTENT_ARCH_IR_KNOWLEDGE_UNITS_MISSING")
        units = []
    _unique_ids(units, "knowledge_id", "CONTENT_ARCH_IR_KNOWLEDGE", errors)
    required = tuple((contract.get("lesson_evidence_ir") or {}).get("each_knowledge_unit_requires") or IR_FIELDS)
    for idx, unit in enumerate(units):
        _required_fields(unit, required, f"CONTENT_ARCH_IR_UNIT[{idx}]", errors)
        if not isinstance(unit, dict):
            continue
        for key in ("source_evidence_ids", "prior_student_knowledge_ids", "visible_evidence_before_task",
                    "resource_state_before_task", "forbidden_response_requires_future_info", "formation_requires",
                    "board_after_formation", "practice_links"):
            if not isinstance(unit.get(key), list):
                errors.append(f"CONTENT_ARCH_IR_LIST_INVALID:{unit.get('knowledge_id')}:{key}")
        for sid in unit.get("source_evidence_ids") or []:
            if sid not in source_ids:
                errors.append(f"CONTENT_ARCH_IR_SOURCE_EVIDENCE_UNKNOWN:{unit.get('knowledge_id')}:{sid}")
    required_formula_ids = ir.get("required_formula_ids", [])
    if not isinstance(required_formula_ids, list) or not all(_nonempty(x) for x in required_formula_ids):
        errors.append("CONTENT_ARCH_IR_REQUIRED_FORMULA_IDS_INVALID")
        required_formula_ids = []
    return errors, set(required_formula_ids)


def _machine_requirement_ids(contract: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for item in contract.get("requirement_registry") or []:
        if not isinstance(item, dict) or item.get("severity") != "HARD" or item.get("enforcement_class") != "MACHINE_DETERMINISTIC":
            continue
        rid = item.get("requirement_id")
        if not isinstance(rid, str):
            continue
        if rid.startswith("REQ-FRZ-") or rid.startswith("REQ-REV-") or rid == "REQ-STA-003":
            continue
        out.add(rid)
    return out


def _semantic_requirement_ids(contract: dict[str, Any], enforcer: str) -> set[str]:
    out: set[str] = set()
    for item in contract.get("requirement_registry") or []:
        if not isinstance(item, dict):
            continue
        if item.get("severity") == "HARD" and item.get("enforcement_class") == "SEMANTIC_JUDGE" and item.get("enforcer") == enforcer:
            rid = item.get("requirement_id")
            if isinstance(rid, str):
                out.add(rid)
    return out


def _machine_gate_bindings(root: Path, manifest_path: Path, manifest: dict[str, Any], workspace: Path) -> dict[str, str]:
    paths = {
        "manifest": manifest_path,
        "process": root / PROCESS_PATH,
        "contract": root / CONTRACT_PATH,
        "checker": root / CHECKER_PATH,
        "helper": root / HELPER_PATH,
        "lesson_evidence_ir": workspace / ARCH_FILES["lesson_evidence_ir"],
        "script_events": workspace / ARCH_FILES["script_events"],
        "script_facts_file": workspace / ARCH_FILES["script_facts"],
        "evidence": workspace / LEGACY_SEMANTIC_FILES["evidence"],
        "student_state": workspace / LEGACY_SEMANTIC_FILES["student_state"],
        "resource_action": workspace / LEGACY_SEMANTIC_FILES["resource_action"],
        "board_timeline": workspace / LEGACY_SEMANTIC_FILES["board_timeline"],
        "board_plan": workspace / BOARD_PLAN,
        "enactment_timeline": workspace / LEGACY_SEMANTIC_FILES["enactment_timeline"],
        "semantic_preflight": workspace / LEGACY_SEMANTIC_FILES["semantic_preflight"],
        "trial": _workspace_file(workspace, (manifest.get("source") or {}).get("trial")),
    }
    return {key: _sha256(path) for key, path in paths.items()}


def _judge_binding_basis(root: Path, manifest_path: Path, manifest: dict[str, Any], workspace: Path) -> dict[str, str]:
    basis = _machine_gate_bindings(root, manifest_path, manifest, workspace)
    basis["machine_gate_file"] = _sha256(workspace / MACHINE_GATE_FILENAME)
    return dict(sorted(basis.items()))


def _validate_judge_document(name: str, doc: dict[str, Any], *, enforcer: str, contract: dict[str, Any],
                             basis: dict[str, str], events: list[dict[str, Any]], facts: dict[str, Any],
                             source_ids: set[str], final_texts: list[str]) -> list[str]:
    errors: list[str] = []
    if doc.get("schema_id") != "teaching-demo-semantic-judge-v1":
        errors.append(f"CONTENT_SEMANTIC_JUDGE_SCHEMA_INVALID:{name}")
    if doc.get("judge") != enforcer:
        errors.append(f"CONTENT_SEMANTIC_JUDGE_ID_INVALID:{name}:{doc.get('judge')}")
    if doc.get("reviewer_role") != "SEMANTIC_JUDGE":
        errors.append(f"CONTENT_SEMANTIC_JUDGE_ROLE_INVALID:{name}")
    if doc.get("implementation_and_judge_separate") is not True:
        errors.append(f"CONTENT_SEMANTIC_JUDGE_SEPARATION_NOT_DECLARED:{name}")
    if doc.get("bindings") != basis:
        errors.append(f"CONTENT_SEMANTIC_JUDGE_BINDING_STALE:{name}")
    expected_input_digest = arch.stable_json_sha256({"judge": enforcer, "bindings": basis})
    if doc.get("input_digest") != expected_input_digest:
        errors.append(f"CONTENT_SEMANTIC_JUDGE_INPUT_DIGEST_DRIFT:{name}")
    required_ids = _semantic_requirement_ids(contract, enforcer)
    verdicts = doc.get("verdicts")
    if not isinstance(verdicts, list) or not verdicts:
        return errors + [f"CONTENT_SEMANTIC_JUDGE_VERDICTS_MISSING:{name}"]
    seen: set[str] = set()
    for idx, item in enumerate(verdicts):
        errors.extend(arch.validate_judge_verdict(item, blocking=True, judge_name=f"{name}[{idx}]"))
        if not isinstance(item, dict):
            continue
        rid = item.get("requirement_id")
        if isinstance(rid, str):
            if rid in seen:
                errors.append(f"CONTENT_SEMANTIC_JUDGE_REQUIREMENT_DUPLICATE:{name}:{rid}")
            seen.add(rid)
        errors.extend(arch.validate_evidence_refs(item.get("evidence_refs"), events=events, facts=facts,
                                                  source_ids=source_ids, final_texts=final_texts))
    if seen != required_ids:
        errors.append(f"CONTENT_SEMANTIC_JUDGE_REQUIREMENT_COVERAGE_DRIFT:{name}:expected={sorted(required_ids)} actual={sorted(seen)}")
    return errors


def validate_architecture_case(root: Path, contract: dict[str, Any], manifest_path: Path, manifest: dict[str, Any],
                               workspace: Path, legacy: dict[str, dict[str, Any]], arch_docs: dict[str, dict[str, Any]],
                               board_plan: dict[str, Any], user_texts: dict[str, str], legacy_context: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    ir_errors, required_formula_ids = _validate_ir(contract, arch_docs["lesson_evidence_ir"], legacy_context["evidence_ids"])
    errors.extend(ir_errors)

    events_doc = arch_docs["script_events"]
    if events_doc.get("schema_id") != "teaching-demo-script-event-stream-v1":
        errors.append("CONTENT_ARCH_EVENT_SCHEMA_INVALID")
    events = events_doc.get("events")
    errors.extend(arch.validate_event_stream(events))
    if not isinstance(events, list):
        return errors
    event_dicts = [x for x in events if isinstance(x, dict)]
    facts = arch.derive_script_facts(event_dicts)
    if arch_docs["script_facts"] != facts:
        errors.append("CONTENT_ARCH_SCRIPT_FACTS_NOT_MACHINE_DERIVED")

    trial_lines = _normalized_lines(user_texts.get("trial", ""))
    rendered_lines = _render_trial_lines(event_dicts)
    if trial_lines != rendered_lines:
        errors.append("CONTENT_ACTUAL_SPOKEN_COVERAGE_NOT_COMPLETE")

    expected_chain = ["ASK", "INVITE", "WAIT", "STUDENT_RESPONSE", "PARAPHRASE", "FEEDBACK"]
    facts_sequences = facts.get("cycle_event_sequence") or {}
    for cycle in legacy.get("student_state", {}).get("cycles") or []:
        if not isinstance(cycle, dict) or cycle.get("instruction_mode") not in INTERACTIVE_MODES:
            continue
        cid = str(cycle.get("cycle_id"))
        if not _ordered_contains(facts_sequences.get(cid) or [], expected_chain):
            errors.append(f"CONTENT_ACTUAL_INTERACTION_CHAIN_INCOMPLETE:{cid}")

    resource_ids = legacy_context["resource_ids"]
    shown = {str(x.get("resource_id")) for x in facts.get("resource_shows") or [] if x.get("resource_id")}
    if resource_ids - shown:
        errors.append(f"CONTENT_ACTUAL_RESOURCE_NOT_SHOWN:{sorted(resource_ids-shown)}")

    shown_ord: dict[str, int] = {}
    mask_ord: dict[str, list[int]] = {}
    for i, event in enumerate(event_dicts):
        rid = event.get("resource_id")
        if event.get("type") == "RESOURCE_SHOW" and isinstance(rid, str):
            shown_ord.setdefault(rid, i)
        if event.get("type") == "RESOURCE_HIDE_OR_MASK" and isinstance(rid, str):
            mask_ord.setdefault(rid, []).append(i)
    first_release = facts.get("first_release") or {}
    for rid, resource in legacy_context["resource_by_id"].items():
        for kid in resource.get("answer_bearing_information_ids") or []:
            release = first_release.get(str(kid)) if isinstance(first_release, dict) else None
            if rid not in shown_ord or not isinstance(release, dict):
                continue
            release_ordinal = release.get("ordinal")
            if isinstance(release_ordinal, int) and shown_ord[rid] < release_ordinal and resource.get("use_mode") in {"discovery", "scaffold"}:
                masks = mask_ord.get(rid, [])
                if not any(m <= shown_ord[rid] for m in masks):
                    errors.append(f"CONTENT_ACTUAL_ANSWER_RESOURCE_PREMATURE:{rid}:{kid}")

    board_adds = facts.get("board_adds") or []
    board_actual = [str(x.get("text")) for x in board_adds if x.get("text") is not None]
    if board_actual != [str(x) for x in board_plan.get("final_board") or []]:
        errors.append("CONTENT_ACTUAL_FINAL_BOARD_NOT_EVENT_ACCUMULATION")
    expected_board = legacy_context.get("expected_board_events") or []
    actual_board_pairs = [(str(x.get("board_delta_id")), str(x.get("text"))) for x in board_adds]
    expected_board_pairs = [(did, text) for did, text, _ in expected_board]
    if actual_board_pairs != expected_board_pairs:
        errors.append(f"CONTENT_ACTUAL_BOARD_DELTA_BINDING_DRIFT:expected={expected_board_pairs}:actual={actual_board_pairs}")
    for index, item in enumerate(board_adds):
        if index >= len(expected_board):
            break
        expected_did, expected_text, knowledge_ids = expected_board[index]
        if str(item.get("board_delta_id")) != expected_did or str(item.get("text")) != expected_text:
            continue
        ordinal = item.get("ordinal")
        if not isinstance(ordinal, int):
            errors.append(f"CONTENT_ACTUAL_BOARD_ORDINAL_INVALID:{item.get('event_id')}")
            continue
        for kid in sorted(knowledge_ids):
            release = first_release.get(str(kid)) if isinstance(first_release, dict) else None
            if not isinstance(release, dict) or not isinstance(release.get("ordinal"), int):
                errors.append(f"CONTENT_ACTUAL_BOARD_KNOWLEDGE_WITHOUT_FORMATION:{item.get('event_id')}:{kid}")
                continue
            if ordinal < int(release["ordinal"]):
                errors.append(f"CONTENT_ACTUAL_BOARD_BEFORE_FORMATION:{item.get('event_id')}:{kid}")

    declared_practice = legacy_context["practice_ids"]
    actual_practice = {str(x.get("practice_id")) for x in facts.get("practice_events") or [] if x.get("practice_id")}
    if declared_practice != actual_practice:
        errors.append(f"CONTENT_ACTUAL_PRACTICE_INVENTORY_DRIFT:declared={sorted(declared_practice)} actual={sorted(actual_practice)}")

    actual_formula_ids = {str(x.get("formula_id")) for x in facts.get("formula_oralizations") or [] if x.get("formula_id")}
    if not required_formula_ids.issubset(actual_formula_ids):
        errors.append(f"CONTENT_ACTUAL_FORMULA_ORALIZATION_MISSING:{sorted(required_formula_ids-actual_formula_ids)}")

    for idx, event in enumerate(event_dicts):
        etype = event.get("type")
        timing = event.get("timing") or {}
        if etype in SPOKEN_EVENT_TYPES and _nonempty(event.get("text")):
            key = "wait_seconds" if etype == "WAIT" else "speech_seconds"
            if not isinstance(timing, dict) or not isinstance(timing.get(key), (int, float)) or timing.get(key) <= 0:
                errors.append(f"CONTENT_ACTUAL_EVENT_TIMING_MISSING:{idx}:{etype}:{key}")
        elif etype in {"RESOURCE_SHOW", "RESOURCE_HIDE_OR_MASK", "BOARD_ADD"}:
            if not isinstance(timing, dict) or not isinstance(timing.get("action_seconds"), (int, float)) or timing.get("action_seconds") < 0:
                errors.append(f"CONTENT_ACTUAL_EVENT_TIMING_MISSING:{idx}:{etype}:action_seconds")

    work_packet = arch_docs["work_packet"]
    known_req_ids = arch.requirement_ids(contract.get("requirement_registry"))
    errors.extend(arch.validate_work_packet(work_packet, known_requirement_ids=known_req_ids))
    if work_packet.get("current_state") != "SUBMISSION_FROZEN":
        errors.append(f"CONTENT_ARCH_WORK_PACKET_STATE_NOT_SUBMISSION_FROZEN:{work_packet.get('current_state')}")
    if work_packet.get("next_gate") != "HUMAN_ACCEPTED":
        errors.append(f"CONTENT_ARCH_WORK_PACKET_NEXT_GATE_INVALID:{work_packet.get('next_gate')}")
    main_sha = work_packet.get("main_sha")
    if not isinstance(main_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", main_sha):
        errors.append("CONTENT_ARCH_WORK_PACKET_MAIN_SHA_INVALID")
        main_sha = ""

    machine_bindings = _machine_gate_bindings(root, manifest_path, manifest, workspace)
    machine_ids = _machine_requirement_ids(contract)
    errors.extend(arch.validate_machine_gate_receipt(arch_docs["machine_gate"], source_commit=main_sha,
                                                     bindings=machine_bindings, requirement_ids=machine_ids))

    judge_basis = _judge_binding_basis(root, manifest_path, manifest, workspace)
    final_texts = [user_texts.get(role, "") for role in USER_ROLES]
    errors.extend(_validate_judge_document(
        "science_evidence", arch_docs["science_evidence_judge"], enforcer="Science/Evidence Judge", contract=contract,
        basis=judge_basis, events=event_dicts, facts=facts, source_ids=legacy_context["evidence_ids"], final_texts=final_texts,
    ))
    errors.extend(_validate_judge_document(
        "enactment_student", arch_docs["enactment_student_judge"], enforcer="Enactment/Student Judge", contract=contract,
        basis=judge_basis, events=event_dicts, facts=facts, source_ids=legacy_context["evidence_ids"], final_texts=final_texts,
    ))
    return errors


def expected_submission_bindings(root: Path, manifest_path: Path, manifest: dict[str, Any], workspace: Path,
                                 selected_receipts: list[Path]) -> dict[str, dict[str, str]]:
    contract = _yaml(root / CONTRACT_PATH)
    usage_contract = (contract.get("repository_reference_benchmark") or {}).get("usage_contract")
    paths: dict[str, Path] = {
        "manifest": manifest_path,
        "content_process": root / PROCESS_PATH,
        "content_contract": root / CONTRACT_PATH,
        "content_checker": root / CHECKER_PATH,
        "content_architecture_helper": root / HELPER_PATH,
        "reference_usage_contract": _repo_path(root, usage_contract),
        "board_plan": workspace / BOARD_PLAN,
    }
    for key, filename in LEGACY_SEMANTIC_FILES.items():
        paths[key] = workspace / filename
    for key, filename in ARCH_FILES.items():
        paths[key] = workspace / filename
    sources = manifest.get("source") or {}
    for role in USER_ROLES:
        paths[role] = _workspace_file(workspace, sources.get(role))
    for idx, path in enumerate(selected_receipts, start=1):
        paths[f"reference_receipt_{idx:02d}"] = path
    out: dict[str, dict[str, str]] = {}
    for key, path in paths.items():
        if not path.is_file():
            raise ValueError(f"submission-bound file missing: {key}:{path}")
        out[key] = {"path": _repo_rel(root, path), "sha256": _sha256(path)}
    return out


def validate_submission_freeze(root: Path, manifest_path: Path, manifest: dict[str, Any], workspace: Path,
                               selected_receipts: list[Path], *, expected_source_commit: str | None = None) -> list[str]:
    errors: list[str] = []
    freeze_path = workspace / FREEZE_FILENAME
    if not freeze_path.is_file():
        return [f"CONTENT_SUBMISSION_FREEZE_MISSING:{_repo_rel(root, freeze_path)}"]
    try:
        freeze = _yaml(freeze_path)
        expected = expected_submission_bindings(root, manifest_path, manifest, workspace, selected_receipts)
    except Exception as exc:
        return [f"CONTENT_SUBMISSION_FREEZE_LOAD_FAILED:{exc}"]
    if freeze.get("schema_id") != FREEZE_SCHEMA:
        errors.append("CONTENT_SUBMISSION_FREEZE_SCHEMA_DRIFT")
    if freeze.get("case_id") != manifest.get("case_id"):
        errors.append("CONTENT_SUBMISSION_FREEZE_CASE_DRIFT")
    source_commit = freeze.get("source_commit")
    if not isinstance(source_commit, str) or not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        errors.append("CONTENT_SUBMISSION_FREEZE_SOURCE_COMMIT_INVALID")
    if expected_source_commit is not None and source_commit != expected_source_commit:
        errors.append(f"CONTENT_SUBMISSION_FREEZE_SOURCE_COMMIT_DRIFT:{source_commit}!={expected_source_commit}")
    bindings = freeze.get("bindings")
    if not isinstance(bindings, dict):
        errors.append("CONTENT_SUBMISSION_FREEZE_BINDINGS_INVALID")
    else:
        if set(bindings) != set(expected):
            errors.append(f"CONTENT_SUBMISSION_FREEZE_BINDING_KEYS_DRIFT:expected={sorted(expected)} actual={sorted(bindings)}")
        for key, expected_item in expected.items():
            if bindings.get(key) != expected_item:
                errors.append(f"CONTENT_SUBMISSION_FREEZE_STALE:{key}")
    return errors


def expected_review_bindings(root: Path, manifest_path: Path, manifest: dict[str, Any], workspace: Path,
                             selected_receipts: list[Path]) -> dict[str, dict[str, str]]:
    out = expected_submission_bindings(root, manifest_path, manifest, workspace, selected_receipts)
    freeze_path = workspace / FREEZE_FILENAME
    out["submission_freeze"] = {"path": _repo_rel(root, freeze_path), "sha256": _sha256(freeze_path)}
    return out


def validate_independent_review(root: Path, contract: dict[str, Any], manifest_path: Path, manifest: dict[str, Any],
                                workspace: Path, selected_receipts: list[Path]) -> list[str]:
    errors: list[str] = []
    review_path = workspace / REVIEW_FILENAME
    if not review_path.is_file():
        return [f"CONTENT_INDEPENDENT_REVIEW_MISSING:{_repo_rel(root, review_path)}"]
    try:
        review = _yaml(review_path)
        expected = expected_review_bindings(root, manifest_path, manifest, workspace, selected_receipts)
    except Exception as exc:
        return [f"CONTENT_INDEPENDENT_REVIEW_LOAD_FAILED:{exc}"]
    if review.get("schema_id") != REVIEW_SCHEMA:
        errors.append("CONTENT_INDEPENDENT_REVIEW_SCHEMA_DRIFT")
    if review.get("case_id") != manifest.get("case_id"):
        errors.append("CONTENT_INDEPENDENT_REVIEW_CASE_DRIFT")
    if review.get("reviewer_role") != "INDEPENDENT_HUMAN" or review.get("implementation_and_review_separate") is not True:
        errors.append("CONTENT_INDEPENDENT_REVIEW_SEPARATION_INVALID")
    if review.get("decision") != "PASS":
        errors.append("CONTENT_INDEPENDENT_REVIEW_NOT_PASS")
    if review.get("hard_fail_triggered") not in ([], None):
        errors.append("CONTENT_INDEPENDENT_REVIEW_HARD_FAIL_PRESENT")
    policy = (contract.get("score") or {}).get("dimensions") or {}
    scores = review.get("scores") or {}
    total = 0
    for name, dim in policy.items():
        value = scores.get(name) if isinstance(scores, dict) else None
        maximum = int((dim or {}).get("points") or 0)
        minimum = int((dim or {}).get("minimum") or 0)
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= maximum:
            errors.append(f"CONTENT_INDEPENDENT_SCORE_INVALID:{name}:{value!r}")
            continue
        total += value
        if value < minimum:
            errors.append(f"CONTENT_INDEPENDENT_DIMENSION_BELOW_MIN:{name}:{value}<{minimum}")
    if review.get("total_score") != total:
        errors.append(f"CONTENT_INDEPENDENT_TOTAL_DRIFT:{review.get('total_score')}!={total}")
    threshold = int((contract.get("review_and_unlock") or {}).get("independent_pass_threshold") or 92)
    if total < threshold:
        errors.append(f"CONTENT_INDEPENDENT_SCORE_BELOW_THRESHOLD:{total}<{threshold}")
    if review.get("bindings") != expected:
        errors.append("CONTENT_INDEPENDENT_STALE_BINDING")
    return errors


def single_line_selftest() -> None:
    with tempfile.TemporaryDirectory(prefix="qz-single-line-") as tmp:
        root = Path(tmp)
        (root / "production/contracts").mkdir(parents=True)
        c = {"single_line_policy": {"canonical_branch": "main", "retired_branch_tree_sha": "retired-test-tree",
                                      "forbidden_current_tree_roots": ["old-route"], "forbidden_current_tree_exact": ["old.md"]}}
        (root / CONTRACT_PATH).write_text(yaml.safe_dump(c), encoding="utf-8")
        for raw in ("AGENTS.md", "content/job-search/teacher/interview/teaching-demo/AGENTS.md",
                    "content/job-search/teacher/interview/teaching-demo/README.md"):
            p = root / raw
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(CANONICAL_PROCESS, encoding="utf-8")
        (root / "CURRENT_STATE.yaml").write_text(
            yaml.safe_dump({"teaching_demo_content": {"canonical_branch": "main", "process": CANONICAL_PROCESS}}), encoding="utf-8")
        good = [{"name": "main"}, {"name": "old", "commit": {"tree": {"sha": "retired-test-tree"}}}]
        assert validate_single_line(root, good) == []
        bad = [{"name": "main"}, {"name": "old", "commit": {"tree": {"sha": "project-tree"}}}]
        assert any("REMOTE_BRANCH" in e for e in validate_single_line(root, bad))


def architecture_selftest() -> None:
    arch.selftest()
    contract = {
        "version": 9,
        "architecture_decision": "architecture/adr/ADR-012-evidence-carrying-teaching-script-compiler.md",
        "enforcement_classes": sorted(arch.ENFORCEMENT_CLASSES),
        "requirement_registry": [{
            "requirement_id": "REQ-STA-001", "severity": "HARD", "authority_source": "ADR-012", "subject": "state",
            "enforcement_class": "MACHINE_DETERMINISTIC", "enforcer": "checker", "evidence_required": ["transition"],
            "failure_code": "CONTENT_ARCH_STATE_TRANSITION_FORBIDDEN", "gate_effect": "blocks",
        }],
        "content_state_machine": {
            "states": list(arch.STATES),
            "allowed_transitions": [list(x) for x in sorted(arch.ALLOWED_TRANSITIONS)],
            "durable_transition_trace": {"complete_prefix_from_SOURCE_LOCKED_required": True},
        },
        "phase_specific_work_packet": {"required_fields": ["state_trace"]},
        "semantic_preflight": {"author_self_checks_have_gate_authority": False},
        "semantic_judges": {"verdict_schema": {"blocking_unknown_is_pass": False}},
    }
    assert validate_architecture_contract(contract) == []
    assert arch.validate_state_transition("SCRIPT_BUILT", "SCRIPT_FACTS_DERIVED") == []
    assert any("FORBIDDEN" in e for e in arch.validate_state_transition("SCRIPT_BUILT", "SUBMISSION_FROZEN"))
    verdict = {
        "requirement_id": "REQ-SCI-001", "verdict": "UNKNOWN", "claim": "evidence uncertain",
        "evidence_refs": ["event:E1"], "reason": "insufficient", "confidence": 0.5,
    }
    assert any("BLOCKING_UNKNOWN" in e for e in arch.validate_judge_verdict(verdict, blocking=True))


def selftest() -> None:
    single_line_selftest()
    architecture_selftest()
