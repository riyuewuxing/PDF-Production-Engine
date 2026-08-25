#!/usr/bin/env python3
"""Validate the portable Teaching Demo case manifest/workspace before composition."""
from __future__ import annotations
import argparse
from pathlib import Path
import re
from typing import Any
import yaml

from artifact_foundation import ROOT, safe_repo_path

DEFAULT_MANIFEST = Path("production/current-run.yaml")
CONTRACT_PATH = Path("production/contracts/teacher-trial-two-pdf-v1.yaml")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top-level YAML must be a mapping")
    return data


def _workspace_file(root: Path, workspace: Path, raw: Any) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("workspace file path must be non-empty")
    p = (workspace / raw).resolve()
    p.relative_to(root.resolve())
    p.relative_to(workspace.resolve())
    return p


def validate(manifest_raw: str | None = None, *, root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    try:
        manifest_path = safe_repo_path(root, str(manifest_raw or DEFAULT_MANIFEST), must_exist=True)
        cfg = load_yaml(manifest_path)
        contract = load_yaml(root / CONTRACT_PATH)
    except Exception as exc:
        return [f"CASE_GATE_LOAD_FAILED: {exc}"]

    spec = contract.get("case_manifest") or {}
    if cfg.get("version") != spec.get("schema_version"):
        errors.append(f"CASE_SCHEMA_VERSION: {cfg.get('version')!r} != {spec.get('schema_version')!r}")
    if cfg.get("schema_id") != spec.get("schema_id"):
        errors.append(f"CASE_SCHEMA_ID: {cfg.get('schema_id')!r} != {spec.get('schema_id')!r}")
    rev = cfg.get("instance_revision")
    if not isinstance(rev, int) or isinstance(rev, bool) or rev < 1:
        errors.append("CASE_INSTANCE_REVISION_INVALID")
    case_id = cfg.get("case_id")
    if not isinstance(case_id, str) or not CASE_ID.fullmatch(case_id):
        errors.append("CASE_ID_INVALID")
    title = cfg.get("title")
    if not isinstance(title, str) or not title.strip():
        errors.append("CASE_TITLE_MISSING")
    if cfg.get("product_contract") != contract.get("id"):
        errors.append("CASE_PRODUCT_CONTRACT_DRIFT")

    scaffold = spec.get("scaffold") or {}
    expected_sources = scaffold.get("source_files") or {}
    sources = cfg.get("source") or {}
    if sources != expected_sources:
        errors.append(f"CASE_SOURCE_SCAFFOLD_DRIFT: expected={expected_sources!r} actual={sources!r}")
    expected_deliverables = {
        role: str(template).format(title=title)
        for role, template in (scaffold.get("deliverable_templates") or {}).items()
    } if isinstance(title, str) else {}
    if cfg.get("deliverables") != expected_deliverables:
        errors.append(f"CASE_DELIVERABLE_SCAFFOLD_DRIFT: expected={expected_deliverables!r}")

    try:
        workspace = safe_repo_path(root, cfg.get("workspace"), must_exist=True)
        if not workspace.is_dir():
            errors.append("CASE_WORKSPACE_NOT_DIRECTORY")
    except Exception as exc:
        errors.append(f"CASE_WORKSPACE_INVALID: {exc}")
        workspace = None

    inp = cfg.get("input") or {}
    printed = inp.get("printed_pages")
    sp = inp.get("source_pages") or {}
    if not isinstance(printed, list) or len(printed) not in (1, 2) or not all(isinstance(x, int) and x > 0 for x in printed):
        errors.append("CASE_PRINTED_PAGES_MUST_BE_1_OR_2_POSITIVE_INTS")
    if sp.get("mode") != "remote-pdf":
        errors.append("CASE_FORMAL_SOURCE_MODE_MUST_BE_REMOTE_PDF")
    for key in ("repo", "path"):
        if not isinstance(sp.get(key), str) or not sp.get(key):
            errors.append(f"CASE_SOURCE_LOCK_MISSING: {key}")
    for key in ("ref", "blob_sha"):
        if not isinstance(sp.get(key), str) or not HEX40.fullmatch(sp.get(key)):
            errors.append(f"CASE_SOURCE_LOCK_INVALID: {key}")
    if not isinstance(sp.get("size_bytes"), int) or sp.get("size_bytes", 0) < 100_000:
        errors.append("CASE_SOURCE_LOCK_INVALID: size_bytes")
    physical = sp.get("pages")
    if not isinstance(physical, list) or not all(isinstance(x, int) and x > 0 for x in physical):
        errors.append("CASE_SOURCE_PDF_PAGES_INVALID")
    elif isinstance(printed, list) and len(physical) != len(printed):
        errors.append("CASE_SOURCE_PAGE_COUNT_DRIFT")

    if workspace is not None:
        for role, rel in expected_sources.items():
            try:
                p = _workspace_file(root, workspace, rel)
            except Exception as exc:
                errors.append(f"CASE_SOURCE_PATH_INVALID: {role}: {exc}")
                continue
            if not p.is_file():
                errors.append(f"CASE_SOURCE_FILE_MISSING: {role}: {rel}")
        ready = spec.get("ready_status") or {}
        evidence_rel = expected_sources.get(ready.get("source_role"))
        if evidence_rel:
            try:
                evidence = load_yaml(_workspace_file(root, workspace, evidence_rel))
                if evidence.get(ready.get("field")) != ready.get("value"):
                    errors.append(f"CASE_SCAFFOLD_NOT_READY: {ready.get('field')}={evidence.get(ready.get('field'))!r}")
                if evidence.get("case_id") != case_id:
                    errors.append("CASE_EVIDENCE_CASE_ID_DRIFT")
                if evidence.get("title") != title:
                    errors.append("CASE_EVIDENCE_TITLE_DRIFT")
                if isinstance(printed, list) and evidence.get("printed_pages") != printed:
                    errors.append("CASE_EVIDENCE_PRINTED_PAGES_DRIFT")
                locator = evidence.get("source_locator") or {}
                expected_locator = {
                    "repo": sp.get("repo"),
                    "ref": sp.get("ref"),
                    "path": sp.get("path"),
                    "blob_sha": sp.get("blob_sha"),
                    "pdf_pages": physical,
                }
                for key, expected in expected_locator.items():
                    if expected is not None and locator.get(key) != expected:
                        errors.append(f"CASE_EVIDENCE_SOURCE_LOCK_DRIFT: {key}")
                verification = evidence.get("verification") or {}
                for key in ("exact_pages_verified", "page_text_verified", "canonical_pdf_pixels_inspected"):
                    if verification.get(key) is not True:
                        errors.append(f"CASE_SOURCE_VERIFICATION_INCOMPLETE: {key}")
            except Exception as exc:
                errors.append(f"CASE_EVIDENCE_INVALID: {exc}")
    return errors


def selftest() -> None:
    assert CASE_ID.fullmatch("demo-01")
    assert not CASE_ID.fullmatch("../demo")
    assert HEX40.fullmatch("a" * 40)
    assert not HEX40.fullmatch("A" * 40)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=None)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    selftest()
    if args.selftest:
        print("PASS: Teaching Demo case schema selftest")
        return 0
    errors = validate(args.manifest)
    if errors:
        print("FAIL: Teaching Demo case schema/readiness gate")
        for error in errors:
            print("- " + error)
        return 1
    print("PASS: Teaching Demo case schema/readiness gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
