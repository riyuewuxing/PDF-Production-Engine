#!/usr/bin/env python3
"""Synthetic P3 fixture for the real canonical delivery-accepted path.

The fixture copies the exact current Teaching Demo content contract/checker bytes
into a temporary repository root, then synthesizes only non-product content and
evidence. It exercises the canonical validate(..., require_independent=True)
path without granting Phase-B qualification authority.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shutil
import sys
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

import check_teaching_demo_content as content_gate  # noqa: E402
import check_teaching_demo_case as case_gate  # noqa: E402


CASE_ID = "synthetic-p3-delivery"
TITLE = "合成交付验收样例"
WORKSPACE_REL = f"production/teaching-demo-cases/{CASE_ID}"
MANIFEST_REL = f"{WORKSPACE_REL}/manifest.yaml"
SOURCE_REL = "assets/synthetic/p3-source.pdf"
SOURCE_COMMIT = "c" * 40

AUTHORITY_FILES = (
    "production/contracts/teaching-demo-content.yaml",
    "production/contracts/teacher-trial-two-pdf-v1.yaml",
    "production/process/teaching-demo-content/PROCESS.md",
    "tools/check_teaching_demo_content.py",
    "tools/_teaching_demo_content_core.inc",
    "tools/teaching_demo_content_architecture.py",
    "tools/_teaching_demo_content_architecture_impl.py",
    "tools/teaching_demo_content_enforcement.py",
)


def dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(value, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def copy_authority(root: Path) -> None:
    for raw in AUTHORITY_FILES:
        source = REPO_ROOT / raw
        target = root / raw
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

    canonical = content_gate.core.CANONICAL_PROCESS
    for raw in (
        "AGENTS.md",
        "content/job-search/teacher/interview/teaching-demo/AGENTS.md",
        "content/job-search/teacher/interview/teaching-demo/README.md",
    ):
        path = root / raw
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"Synthetic fixture entry. Canonical authority: {canonical}\n",
            encoding="utf-8",
        )
    dump(
        root / "CURRENT_STATE.yaml",
        {
            "teaching_demo_content": {
                "canonical_branch": "main",
                "process": canonical,
            }
        },
    )


def git_blob_sha1(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(
        f"blob {len(data)}\0".encode("ascii") + data
    ).hexdigest()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stable(value: Any) -> str:
    return content_gate.arch.stable_json_sha256(value)


def transition(current: str, target: str, refs: list[str]) -> dict[str, Any]:
    item: dict[str, Any] = {
        "from_state": current,
        "to_state": target,
        "evidence_refs": refs,
    }
    item["transition_digest"] = stable(item)
    return item


def make_reference_receipts(root: Path, contract: dict[str, Any]) -> list[str]:
    reference_root = (
        root
        / "production/reference-materials/teacher_teaching_demo/"
        "purchased-transcript-selection-2026-08-27"
    )
    case_paths: list[str] = []
    for number in (1, 2):
        raw = (
            "production/reference-materials/teacher_teaching_demo/"
            "purchased-transcript-selection-2026-08-27/"
            f"cases/synthetic-{number}/CASE.yaml"
        )
        dump(
            root / raw,
            {
                "version": 1,
                "case_id": f"synthetic-ref-{number}",
                "verification": {"visual_open_and_review": "PASS"},
                "mechanism_summary": [f"synthetic mechanism {number}"],
            },
        )
        case_paths.append(raw)

    usage = (contract.get("repository_reference_benchmark") or {}).get(
        "usage_contract"
    )
    if not isinstance(usage, str) or not usage:
        raise AssertionError("reference usage contract path missing")
    dump(
        root / usage,
        {
            "version": 1,
            "fixture": True,
            "purpose": "synthetic structural reference binding",
        },
    )
    if not reference_root.is_dir():
        raise AssertionError("synthetic reference root missing")
    return case_paths


def make_events() -> list[dict[str, Any]]:
    return [
        {
            "event_id": "E1",
            "type": "RESOURCE_SHOW",
            "cycle_id": "C1",
            "resource_id": "R1",
            "visibility": "SAFE",
            "timing": {"action_seconds": 1},
        },
        {
            "event_id": "E2",
            "type": "ASK",
            "cycle_id": "C1",
            "text": "请先观察这组现象，再说你能得到什么判断。",
            "timing": {"speech_seconds": 2},
        },
        {
            "event_id": "E3",
            "type": "INVITE",
            "cycle_id": "C1",
            "text": "请这位同学先独立说出你的判断。",
            "timing": {"speech_seconds": 1},
        },
        {
            "event_id": "E4",
            "type": "WAIT",
            "cycle_id": "C1",
            "text": "我等你观察和思考。",
            "timing": {"wait_seconds": 1},
        },
        {
            "event_id": "E5",
            "type": "STUDENT_RESPONSE",
            "cycle_id": "C1",
            "text": "我根据眼前现象判断，这个规律成立。",
            "releases": [],
            "release_claims": [
                {"knowledge_id": "K1", "visible_span": "这个规律成立"}
            ],
            "timing": {"speech_seconds": 2},
        },
        {
            "event_id": "E6",
            "type": "PARAPHRASE",
            "cycle_id": "C1",
            "text": "这位同学先依据可见现象，再给出了有限判断。",
            "timing": {"speech_seconds": 2},
        },
        {
            "event_id": "E7",
            "type": "FEEDBACK",
            "cycle_id": "C1",
            "text": "证据和判断对应得很好，我们保留这个条件边界。",
            "timing": {"speech_seconds": 2},
        },
        {
            "event_id": "E8",
            "type": "BOARD_ADD",
            "cycle_id": "C1",
            "board_delta_id": "B1",
            "text": "观察证据 → 有限结论",
            "timing": {"action_seconds": 1},
        },
        {
            "event_id": "E9",
            "type": "PRACTICE",
            "cycle_id": "C1",
            "practice_id": "P1",
            "text": "请用刚形成的规律判断一个新的相同条件情境。",
            "timing": {"speech_seconds": 2},
        },
        {
            "event_id": "E10",
            "type": "WAIT",
            "cycle_id": "C1",
            "text": "再独立想一想。",
            "timing": {"wait_seconds": 1},
        },
        {
            "event_id": "E11",
            "type": "STUDENT_RESPONSE",
            "cycle_id": "C1",
            "text": "新情境仍满足相同条件，所以可以应用刚形成的规律。",
            "timing": {"speech_seconds": 2},
        },
        {
            "event_id": "E12",
            "type": "FEEDBACK",
            "cycle_id": "C1",
            "text": "这个迁移没有改变原来的适用条件。",
            "timing": {"speech_seconds": 1},
        },
    ]


def prepare_fixture(root: Path) -> Path:
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    copy_authority(root)
    contract = content_gate.core._yaml(
        root / "production/contracts/teaching-demo-content.yaml"
    )
    product_contract = content_gate.core._yaml(
        root / "production/contracts/teacher-trial-two-pdf-v1.yaml"
    )
    workspace = root / WORKSPACE_REL
    workspace.mkdir(parents=True, exist_ok=True)

    source_path = root / SOURCE_REL
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(
        b"%PDF-1.4\n% synthetic p3 source only\n"
        + b"x" * 120_000
    )
    blob = git_blob_sha1(source_path)
    source_sha = file_sha256(source_path)

    scaffold = (product_contract.get("case_manifest") or {}).get("scaffold") or {}
    source_map = dict(scaffold.get("source_files") or {})
    if not source_map:
        raise AssertionError("product source scaffold missing")

    events = make_events()
    trial_lines = content_gate.core._render_trial_lines(events)
    texts = {
        "01_训练参考教案.md": (
            "训练参考：先观察证据，再形成有边界的判断。\n"
            "答案：在新情境中应用已经形成的规律。\n"
        ),
        "02_考场骨架教案.md": (
            "考场骨架：观察、提问、倾听、形成、板书、迁移。\n"
        ),
        "03_逐字稿.md": "\n".join(trial_lines) + "\n",
        "04_课题专属答辩.md": (
            "答辩：本样例只证明合成交付验收链，不代表真实产品。\n"
        ),
        "05_教材到骨架提炼解析.md": (
            "解析：证据先于结论，板书晚于知识形成。\n"
        ),
    }
    for filename, text_value in texts.items():
        (workspace / filename).write_text(text_value, encoding="utf-8")

    reference_paths = make_reference_receipts(root, contract)
    candidates = []
    for index, raw in enumerate(reference_paths, start=1):
        candidates.append(
            {
                "case_receipt": raw,
                "case_receipt_sha256": file_sha256(root / raw),
                "lesson_mechanism": f"mechanism-{index}",
                "evidence_type": "synthetic",
                "knowledge_formation_pattern": "observe-then-form",
                "student_task_type": "bounded-judgment",
                "resource_interaction": "safe-show",
                "misconception_structure": "overclaim-risk",
                "reasoning_pattern": "evidence-to-bounded-claim",
                "classroom_enactment_pattern": "ask-listen-paraphrase-feedback",
            }
        )

    evidence = {
        "case_id": CASE_ID,
        "title": TITLE,
        "printed_pages": [1],
        "scaffold_status": "READY",
        "source_locator": {
            "repo": "synthetic/repo",
            "ref": SOURCE_COMMIT,
            "path": SOURCE_REL,
            "blob_sha": blob,
            "pdf_pages": [1],
        },
        "evidence_units": [
            {
                "id": "E1",
                "kind": "synthetic_source",
                "summary": "可见现象支持一个有条件边界的课堂判断。",
            }
        ],
        "reference_learning": {
            "lesson_family": "synthetic",
            "selected_case_receipts": reference_paths,
            "mechanisms": ["observe-before-claim"],
            "transfer_to_cycles": {"C1": "synthetic transfer"},
            "structural_candidate_comparison": {
                "candidates": candidates,
                "selected_case_receipt": reference_paths[0],
                "selection_rationale": "synthetic structural comparison",
                "transfer_mapping": {"C1": "use selected mechanism"},
            },
        },
    }
    dump(workspace / "evidence.yaml", evidence)

    dump(
        workspace / "SCIENCE_REASONING_AUDIT.yaml",
        {
            "case_id": CASE_ID,
            "claims": [
                {
                    "claim_id": "C1",
                    "claim": "当前可见证据只支持当前条件下的有限判断。",
                    "evidence_refs": ["E1"],
                    "direct_observation": "学生先看到合成现象。",
                    "inference": "在当前条件下形成有限判断。",
                    "alternative_explanations": ["条件变化时结论可能改变"],
                    "exclusion_or_limitation": "不外推到未给出的条件。",
                    "max_justified_conclusion": "这个规律在当前条件下成立。",
                    "boundary_not_claimed": "不声明普遍无条件成立。",
                    "misconception_risk": "把有限结论过度推广。",
                }
            ],
        },
    )
    dump(
        workspace / "teaching-boundary.yaml",
        {
            "case_id": CASE_ID,
            "must_teach": ["证据先于有限结论"],
            "may_mention": ["相同条件下迁移"],
            "out_of_scope": ["真实学科产品结论"],
        },
    )
    dump(
        workspace / "point-chain.yaml",
        {
            "case_id": CASE_ID,
            "points": [
                {
                    "point_id": "PT1",
                    "learning_gain": "能从可见证据形成有限判断。",
                    "prerequisite_knowledge_ids": [],
                    "evidence_or_resource_ids": ["E1", "R1"],
                    "formation_cycle_id": "C1",
                    "next_need": "迁移到相同条件新情境。",
                    "out_of_scope_guard": "不外推条件。",
                }
            ],
        },
    )
    dump(
        workspace / "STUDENT_STATE_LEDGER.yaml",
        {
            "case_id": CASE_ID,
            "cycles": [
                {
                    "cycle_id": "C1",
                    "point_id": "PT1",
                    "instruction_mode": "scaffolded_formation",
                    "interaction_required": True,
                    "knows_before": [],
                    "visible_now": ["OBS1"],
                    "resource_ids": ["R1"],
                    "teacher_prompt": "先观察再判断。",
                    "student_task": "说出可由现象支持的有限判断。",
                    "plausible_short_response": "这个规律成立。",
                    "likely_wrong_response": "任何条件下都成立。",
                    "scaffold_1": "只看当前可见现象。",
                    "scaffold_2": "保留当前条件。",
                    "formed_knowledge_ids": ["K1"],
                    "formation_evidence": "E5 学生回答形成有限结论。",
                    "enactment": {
                        "prompt_anchor": events[1]["text"],
                        "invite_anchor": events[2]["text"],
                        "listen_anchor": events[3]["text"],
                        "paraphrase_anchor": events[5]["text"],
                        "feedback_anchor": events[6]["text"],
                        "formation_anchor": events[4]["text"],
                        "board_delta_ids": ["B1"],
                    },
                }
            ],
        },
    )
    dump(
        workspace / "RESOURCE_ACTION_MAP.yaml",
        {
            "case_id": CASE_ID,
            "resources": [
                {
                    "resource_id": "R1",
                    "asset_path_or_source_page": SOURCE_REL + "#page-1",
                    "identity": "synthetic visible evidence",
                    "reveal_before_cycle": "C1",
                    "teacher_action": "展示非答案型合成现象。",
                    "student_observes": "观察到一个稳定现象。",
                    "directly_observed": "仅观察当前现象。",
                    "inferred_from_conditions": "只形成当前条件下判断。",
                    "task": "观察后给出有限判断。",
                    "supports_claims": ["C1"],
                    "use_mode": "illustration",
                    "visible_information_ids": ["OBS1"],
                    "answer_bearing_information_ids": [],
                    "mask_policy": "none_needed",
                }
            ],
        },
    )
    dump(
        workspace / "BOARD_TIMELINE.yaml",
        {
            "case_id": CASE_ID,
            "board_deltas": [
                {
                    "delta_id": "B1",
                    "trigger_cycle": "C1",
                    "prerequisite_knowledge_ids": [],
                    "newly_formed_knowledge_ids": ["K1"],
                    "add_only": ["观察证据 → 有限结论"],
                    "forbidden_before_trigger": ["有限结论"],
                }
            ],
        },
    )
    dump(
        workspace / "BOARD_PLAN.yaml",
        {
            "case_id": CASE_ID,
            "source_of_truth": "BOARD_TIMELINE.yaml",
            "final_board": ["观察证据 → 有限结论"],
        },
    )
    dump(
        workspace / "semantic-preflight-review.yaml",
        {
            "case_id": CASE_ID,
            "science_red_team": {"decision": "PASS"},
            "student_state_simulation": {"decision": "PASS"},
            "enactment_board_dry_run": {"decision": "PASS"},
            "hard_fail_triggered": [],
            "cycle_enactment_audit": [
                {
                    "cycle_id": "C1",
                    "decision": "PASS",
                    "attack_notes": "synthetic fixture checks interaction ordering",
                }
            ],
            "information_release_audit": [
                {
                    "knowledge_id": "K1",
                    "formation_cycle_id": "C1",
                    "spoken_first_release_anchor": events[4]["text"],
                    "spoken_release_stage": "student_paraphrase",
                    "resource_answer_visible_before_task": False,
                    "board_visible_before_task": False,
                    "decision": "PASS",
                }
            ],
            "practice_inventory_complete": True,
            "practice_inventory": [
                {
                    "item_id": "P1",
                    "execution_scope": "trial_event",
                    "prompt_role": "trial",
                    "prompt_anchor": events[8]["text"],
                    "answer_role": "reference_plan",
                    "answer_anchor": "答案：在新情境中应用已经形成的规律。",
                    "figure_or_data_status": "not_needed",
                    "decision": "PASS",
                }
            ],
        },
    )
    dump(
        workspace / "ENACTMENT_TIMELINE.yaml",
        {
            "case_id": CASE_ID,
            "status": "ESTIMATE",
            "duration_profile": {
                "source": "declared_profile",
                "target_seconds_range": [10, 20],
                "sensitivity_check": {
                    "decision": "PASS",
                    "note": "synthetic single-cycle timing arithmetic",
                },
            },
            "segments": [
                {
                    "id": "T1",
                    "trial_anchor": events[1]["text"],
                    "spoken_equivalent": "synthetic single-cycle enactment",
                    "speech_seconds_range": [10, 10],
                    "board_seconds": 1,
                    "resource_view_seconds": 1,
                    "think_or_response_seconds": 1,
                    "overlap": [],
                    "elapsed_seconds_range": [13, 13],
                }
            ],
            "total_seconds_range": [13, 13],
        },
    )

    dump(
        workspace / "LESSON_EVIDENCE_IR.yaml",
        {
            "schema_id": "teaching-demo-lesson-evidence-ir-v1",
            "knowledge_units": [
                {
                    "knowledge_id": "K1",
                    "claim": "当前条件下有限结论成立。",
                    "claim_strength": "bounded",
                    "source_evidence_ids": ["E1"],
                    "prior_student_knowledge_ids": [],
                    "visible_evidence_before_task": ["OBS1"],
                    "resource_state_before_task": ["R1 visible"],
                    "student_task": "依据当前现象给出有限判断。",
                    "permissible_response": "这个规律成立。",
                    "forbidden_response_requires_future_info": [],
                    "scaffold_level": "minimal",
                    "teacher_scaffold_boundary": "教师不提前给出结论。",
                    "formation_claim": "这个规律成立",
                    "formation_requires": ["event:E5"],
                    "board_after_formation": ["B1"],
                    "practice_links": ["P1"],
                }
            ],
            "required_formula_ids": [],
        },
    )
    dump(
        workspace / "SCRIPT_EVENTS.yaml",
        {
            "schema_id": "teaching-demo-script-event-stream-v1",
            "events": events,
        },
    )
    dump(workspace / "SCRIPT_FACTS.yaml", content_gate.arch.derive_script_facts(events))

    dump(
        workspace / "evidence-placeholder.yaml",
        {"fixture": True},
    )

    manifest = {
        "version": 1,
        "schema_id": "teacher-trial-case-v1",
        "instance_revision": 1,
        "mode": "single-run",
        "case_id": CASE_ID,
        "title": TITLE,
        "product_contract": "teacher-trial-two-pdf-v1",
        "content_contract": "teaching-demo-content",
        "workspace": WORKSPACE_REL,
        "source": source_map,
        "deliverables": {
            "training": f"{TITLE}｜面试训练稿.pdf",
            "extraction": f"{TITLE}｜教材到骨架提炼解析.pdf",
        },
        "pdf_dir": f"outputs/teaching-demo/{CASE_ID}",
        "tex_dir": f"outputs/teaching-demo/{CASE_ID}-tex",
        "render_dir": f"qa/teaching-demo/{CASE_ID}-rendered",
        "cache_dir": f"{WORKSPACE_REL}/.source-cache",
        "constraints": {"board_sections_min": 1, "figure_count_min": 0},
        "input": {
            "authority": "exact-page-repository",
            "book": "synthetic-source.pdf",
            "book_id": "synthetic-p3",
            "printed_pages": [1],
            "source_pages": {
                "mode": "repository-pdf",
                "file": SOURCE_REL,
                "blob_sha": blob,
                "size_bytes": source_path.stat().st_size,
                "sha256": source_sha,
                "pages": [1],
                "audit_locator": {
                    "repo": "synthetic/repo",
                    "ref": SOURCE_COMMIT,
                    "path": SOURCE_REL,
                    "blob_sha": blob,
                },
            },
        },
    }
    manifest_path = root / MANIFEST_REL
    dump(manifest_path, manifest)

    source_binding, _, source_errors = content_gate._source_lock_binding(
        root, manifest
    )
    if source_errors:
        raise AssertionError(
            "synthetic source lock rejected: " + " | ".join(source_errors)
        )
    source_review = {
        "schema_id": "teaching-demo-source-review-v1",
        "case_id": CASE_ID,
        "reviewer_role": "INDEPENDENT_SOURCE_REVIEWER",
        "implementation_and_review_separate": True,
        "source_binding": source_binding,
        "reviewed_printed_pages": [1],
        "reviewed_pdf_pages": [1],
        "visual_open_and_review": "PASS",
        "review_notes": "Synthetic source surface reviewed for fixture semantics only.",
    }
    source_review["receipt_digest"] = stable(source_review)
    dump(workspace / "SOURCE_REVIEW.yaml", source_review)

    trace = [
        transition(
            "SOURCE_LOCKED",
            "EVIDENCE_READY",
            [
                f"source-lock:{source_binding['binding_digest']}",
                "artifact:SOURCE_REVIEW.yaml",
            ],
        ),
        transition(
            "EVIDENCE_READY",
            "IR_READY",
            ["artifact:LESSON_EVIDENCE_IR.yaml"],
        ),
        transition(
            "IR_READY",
            "SCRIPT_BUILT",
            ["artifact:SCRIPT_EVENTS.yaml"],
        ),
        transition(
            "SCRIPT_BUILT",
            "SCRIPT_FACTS_DERIVED",
            ["artifact:SCRIPT_FACTS.yaml"],
        ),
        transition(
            "SCRIPT_FACTS_DERIVED",
            "MACHINE_GATED",
            ["artifact:MACHINE_GATE.yaml"],
        ),
        transition(
            "MACHINE_GATED",
            "SEMANTIC_JUDGED",
            [
                "artifact:SCIENCE_EVIDENCE_JUDGE.yaml",
                "artifact:ENACTMENT_STUDENT_JUDGE.yaml",
            ],
        ),
        transition(
            "SEMANTIC_JUDGED",
            "SUBMISSION_FROZEN",
            ["artifact:SUBMISSION_FREEZE.yaml"],
        ),
    ]
    work_packet = {
        "schema_id": "teaching-demo-work-packet-v1",
        "main_sha": SOURCE_COMMIT,
        "current_state": "SUBMISSION_FROZEN",
        "task_schema": "synthetic-p3-delivery-acceptance",
        "requirement_ids": sorted(
            content_gate.arch.requirement_ids(contract.get("requirement_registry"))
        ),
        "source_refs": ["E1"],
        "reference_mechanisms": ["observe-before-claim"],
        "allowed_writes": ["synthetic-fixture"],
        "forbidden_writes": ["product-pdf"],
        "expected_evidence": ["freeze", "independent-review", "human-receipt"],
        "next_gate": "HUMAN_ACCEPTED",
        "state_trace": trace,
    }
    dump(workspace / "WORK_PACKET.yaml", work_packet)

    machine_bindings = content_gate.core._machine_gate_bindings(
        root, manifest_path, manifest, workspace
    )
    machine_ids = content_gate.enforcement.machine_gate_requirement_ids(contract)
    machine_receipt = content_gate.enforcement.make_machine_gate_receipt(
        source_commit=SOURCE_COMMIT,
        bindings=machine_bindings,
        requirement_ids=machine_ids,
        state_trace_prefix=content_gate._machine_gate_trace_prefix(work_packet),
    )
    dump(workspace / "MACHINE_GATE.yaml", machine_receipt)

    judge_basis = content_gate.core._judge_binding_basis(
        root, manifest_path, manifest, workspace
    )
    claims = content_gate.enforcement._release_claims_from_events(events)

    def judge_document(enforcer: str) -> dict[str, Any]:
        required_ids = content_gate.core._semantic_requirement_ids(
            contract, enforcer
        )
        rows = []
        release_refs = {
            f"event:{item['event_id']}" for item in claims
        } | {
            f"exact-text:{item['visible_span']}" for item in claims
        }
        base_refs = ["event:E5", "source:E1", "exact-text:这个规律成立"]
        for rid in sorted(required_ids):
            refs = list(base_refs)
            if rid == content_gate.enforcement.RELEASE_SEMANTIC_REQUIREMENT_ID:
                refs = sorted(set(refs) | release_refs)
            rows.append(
                {
                    "requirement_id": rid,
                    "verdict": "PASS",
                    "claim": "synthetic evidence-bound PASS for current product fixture",
                    "evidence_refs": refs,
                    "reason": "fixture evidence refs resolve to current bytes/events",
                    "confidence": 1.0,
                }
            )
        doc: dict[str, Any] = {
            "schema_id": "teaching-demo-semantic-judge-v1",
            "judge": enforcer,
            "reviewer_role": "SEMANTIC_JUDGE",
            "implementation_and_judge_separate": True,
            "bindings": judge_basis,
            "input_digest": stable(
                {"judge": enforcer, "bindings": judge_basis}
            ),
            "verdicts": rows,
        }
        if enforcer == "Science/Evidence Judge":
            doc["release_verifications"] = [
                {
                    "knowledge_id": item["knowledge_id"],
                    "event_id": item["event_id"],
                    "visible_span": item["visible_span"],
                    "verdict": "PASS",
                    "reason": "same-event visible span establishes synthetic K1",
                    "confidence": 1.0,
                    "evidence_refs": [
                        f"event:{item['event_id']}",
                        f"exact-text:{item['visible_span']}",
                    ],
                }
                for item in claims
            ]
        return doc

    dump(
        workspace / "SCIENCE_EVIDENCE_JUDGE.yaml",
        judge_document("Science/Evidence Judge"),
    )
    dump(
        workspace / "ENACTMENT_STUDENT_JUDGE.yaml",
        judge_document("Enactment/Student Judge"),
    )

    selected_receipts = content_gate._reference_receipt_paths(root, workspace)
    freeze_bindings = content_gate.core.expected_submission_bindings(
        root, manifest_path, manifest, workspace, selected_receipts
    )
    dump(
        workspace / "SUBMISSION_FREEZE.yaml",
        {
            "schema_id": "teaching-demo-content-submission-freeze",
            "case_id": CASE_ID,
            "source_commit": SOURCE_COMMIT,
            "bindings": freeze_bindings,
        },
    )

    score_policy = (contract.get("score") or {}).get("dimensions") or {}
    scores = {
        name: int((spec or {}).get("points") or 0)
        for name, spec in score_policy.items()
    }
    review_bindings = content_gate.core.expected_review_bindings(
        root, manifest_path, manifest, workspace, selected_receipts
    )
    review = {
        "schema_id": "teaching-demo-content-review",
        "case_id": CASE_ID,
        "reviewer_role": "INDEPENDENT_HUMAN",
        "implementation_and_review_separate": True,
        "decision": "PASS",
        "hard_fail_triggered": [],
        "scores": scores,
        "total_score": sum(scores.values()),
        "bindings": review_bindings,
    }
    dump(workspace / "INDEPENDENT_CONTENT_REVIEW.yaml", review)

    human = {
        "schema_id": "teaching-demo-human-acceptance-v1",
        "case_id": CASE_ID,
        "from_state": "SUBMISSION_FROZEN",
        "to_state": "HUMAN_ACCEPTED",
        "source_commit": SOURCE_COMMIT,
        "bindings": {
            "submission_freeze": {
                "path": "SUBMISSION_FREEZE.yaml",
                "sha256": file_sha256(workspace / "SUBMISSION_FREEZE.yaml"),
            },
            "independent_content_review": {
                "path": "INDEPENDENT_CONTENT_REVIEW.yaml",
                "sha256": file_sha256(
                    workspace / "INDEPENDENT_CONTENT_REVIEW.yaml"
                ),
            },
        },
    }
    human["transition_digest"] = stable(human)
    dump(workspace / "HUMAN_ACCEPTANCE_RECEIPT.yaml", human)

    return manifest_path


def expect_reject(root: Path, manifest_rel: str, needle: str) -> None:
    errors = content_gate.validate(
        manifest_rel, root=root, require_independent=True
    )
    if not any(needle in item for item in errors):
        raise AssertionError(
            f"expected rejection containing {needle!r}; got {errors!r}"
        )


def run_fixture(workspace: Path) -> dict[str, Any]:
    root = workspace / "positive"
    manifest_path = prepare_fixture(root)
    manifest_rel = manifest_path.relative_to(root).as_posix()

    errors = content_gate.validate(
        manifest_rel, root=root, require_independent=True
    )
    if errors:
        raise AssertionError(
            "canonical accepted fixture rejected: " + " | ".join(errors)
        )

    readiness = content_gate.validate(
        manifest_rel, root=root, require_independent=False
    )
    if readiness:
        raise AssertionError(
            "canonical readiness fixture rejected: " + " | ".join(readiness)
        )

    case_errors = case_gate.validate(manifest_rel, root=root)
    if case_errors:
        raise AssertionError(
            "case gate rejected accepted synthetic fixture: "
            + " | ".join(case_errors)
        )

    # Missing HUMAN receipt must still block product Delivery Acceptance.
    human = root / WORKSPACE_REL / "HUMAN_ACCEPTANCE_RECEIPT.yaml"
    human_saved = human.read_bytes()
    human.unlink()
    expect_reject(root, manifest_rel, "CONTENT_HUMAN_ACCEPTANCE_RECEIPT_MISSING")
    human.write_bytes(human_saved)

    # Independent HUMAN rejection must still block.
    review_path = root / WORKSPACE_REL / "INDEPENDENT_CONTENT_REVIEW.yaml"
    review_saved = review_path.read_bytes()
    review = yaml.safe_load(review_saved.decode("utf-8"))
    review["decision"] = "REJECT"
    dump(review_path, review)
    expect_reject(root, manifest_rel, "CONTENT_INDEPENDENT_REVIEW_NOT_PASS")
    review_path.write_bytes(review_saved)

    # Source drift must still block before semantic/finalization stages.
    source_path = root / SOURCE_REL
    source_saved = source_path.read_bytes()
    source_path.write_bytes(source_saved + b"drift")
    expect_reject(root, manifest_rel, "CONTENT_SOURCE_REPOSITORY_SIZE_DRIFT")
    source_path.write_bytes(source_saved)

    # Semantic FAIL must still block.
    judge_path = root / WORKSPACE_REL / "SCIENCE_EVIDENCE_JUDGE.yaml"
    judge_saved = judge_path.read_bytes()
    judge = yaml.safe_load(judge_saved.decode("utf-8"))
    judge["verdicts"][0]["verdict"] = "FAIL"
    dump(judge_path, judge)
    semantic_errors = content_gate.validate(
        manifest_rel, root=root, require_independent=True
    )
    if not any(
        "CONTENT_ARCH_JUDGE_BLOCKING_FAIL" in item
        for item in semantic_errors
    ):
        raise AssertionError(
            "semantic FAIL did not block canonical accepted path: "
            + repr(semantic_errors)
        )
    judge_path.write_bytes(judge_saved)

    # A forged repository-local Gate-B activation file cannot create
    # qualification authority, and Delivery Acceptance itself does not require it.
    gate_b = (
        root
        / "production/process/teaching-demo-content/validation/phase-b/"
        "GATE_B_ACTIVATION.yaml"
    )
    gate_b.parent.mkdir(parents=True, exist_ok=True)
    dump(gate_b, {"gate_b_activation": True, "authority": "repository-local"})
    if content_gate._validate_phase_b_activation(root) != [
        "CONTENT_PHASE_B_REPOSITORY_SELF_ACTIVATION_FORBIDDEN:"
        "production/process/teaching-demo-content/validation/phase-b/"
        "GATE_B_ACTIVATION.yaml"
    ]:
        raise AssertionError("forged Gate-B activation was not rejected")
    accepted_with_forged_gate = content_gate.validate(
        manifest_rel, root=root, require_independent=True
    )
    if accepted_with_forged_gate:
        raise AssertionError(
            "Delivery Acceptance unexpectedly coupled to forged Gate-B file: "
            + repr(accepted_with_forged_gate)
        )

    return {
        "root": str(root),
        "manifest": manifest_rel,
        "delivery_acceptance": "PASS",
        "readiness": "PASS",
        "case_gate": "PASS",
        "qualification": "BLOCKED_REPOSITORY_SELF_ACTIVATION_FORBIDDEN",
        "negatives": {
            "missing_human_receipt": "REJECTED",
            "independent_human_reject": "REJECTED",
            "source_drift": "REJECTED",
            "semantic_fail": "REJECTED",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    result = run_fixture(args.workspace.resolve())
    print("P3_CANONICAL_ACCEPTED_FIXTURE_PASS")
    print(yaml.safe_dump(result, allow_unicode=True, sort_keys=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
