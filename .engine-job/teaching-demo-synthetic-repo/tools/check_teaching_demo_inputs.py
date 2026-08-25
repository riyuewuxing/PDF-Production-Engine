#!/usr/bin/env python3
"""Cheap prebuild gate for Teaching Demo business inputs.

Runs before PDF composition. It validates manifest/product bindings, Teaching Boundary
/ Point Chain / Board / Trial lineage, scans rendered source-backed content with reusable
physics rules, then compiles one small canonical-font/codepoint probe. Known defects
therefore fail before the expensive two-PDF build and full-page render cycle.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any
import yaml

import publisher_core as core
from physics_notation import lint_text, selftest as notation_selftest

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = Path("production/current-run.yaml")
TEXT_SUFFIXES = {".md", ".txt", ".yaml", ".yml"}


def safe_repo_file(raw: str | Path, *, root: Path = ROOT) -> Path:
    p = Path(raw)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError(f"repository-relative path required: {raw}")
    resolved = (root / p).resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"path escapes repository root: {raw}") from exc
    if not resolved.is_file():
        raise ValueError(f"file missing: {raw}")
    return resolved


def contract_source_roles(contract: dict) -> set[str]:
    roles: set[str] = set()
    for doc in (contract.get("documents") or {}).values():
        if not isinstance(doc, dict):
            continue
        role = doc.get("source_role")
        if isinstance(role, str) and role:
            roles.add(role)
        for section in doc.get("sections") or []:
            if isinstance(section, dict):
                role = section.get("source_role")
                if isinstance(role, str) and role:
                    roles.add(role)
    return roles


def load_manifest(raw: str | None, *, root: Path = ROOT) -> tuple[Path, dict]:
    rel = Path(raw) if raw else DEFAULT_MANIFEST
    path = safe_repo_file(rel, root=root)
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError("manifest top level must be a mapping")
    return path, data


def _safe_workspace_file(workspace: Path, raw: Any, label: str) -> tuple[Path | None, list[str]]:
    if not isinstance(raw, str) or not raw:
        return None, [f"PREBUILD_{label}_PATH_MISSING"]
    path = (workspace / raw).resolve()
    try:
        path.relative_to(workspace)
    except ValueError:
        return None, [f"PREBUILD_{label}_ESCAPES_WORKSPACE: {raw}"]
    if not path.is_file():
        return None, [f"PREBUILD_{label}_FILE_MISSING: {raw}"]
    return path, []


def _point_id(item: Any) -> str | None:
    if isinstance(item, str):
        match = re.match(r"^\s*(P\d+)\b", item)
        return match.group(1) if match else None
    if isinstance(item, dict):
        value = item.get("id")
        return str(value) if isinstance(value, str) and re.fullmatch(r"P\d+", value) else None
    return None


def _closure_value_ok(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return value.get("status") == "not-applicable" and isinstance(value.get("reason"), str) and bool(value["reason"].strip())
    return False


def _content_policy_errors(policy: Any) -> list[str]:
    if not isinstance(policy, dict):
        return ["PREBUILD_CONTENT_PREFLIGHT_POLICY_NOT_MAPPING"]
    errors: list[str] = []
    required_lists = ("teaching_boundary_required_fields", "lesson_closure_required_fields")
    for key in required_lists:
        value = policy.get(key)
        if not isinstance(value, list) or not value or not all(isinstance(x, str) and x for x in value):
            errors.append(f"PREBUILD_CONTENT_POLICY_INVALID: {key}")
    for lo_key, hi_key in (("point_chain_min", "point_chain_max"), ("route_anchor_min_when_present", "route_anchor_max_when_present")):
        lo, hi = policy.get(lo_key), policy.get(hi_key)
        if not isinstance(lo, int) or not isinstance(hi, int) or lo < 1 or hi < lo:
            errors.append(f"PREBUILD_CONTENT_POLICY_RANGE_INVALID: {lo_key}/{hi_key}")
    for key in ("require_point_ids_match_board_increments", "require_trial_board_marker_sequence_match_point_chain"):
        if policy.get(key) is not True:
            errors.append(f"PREBUILD_CONTENT_POLICY_BOOL_INVALID: {key}")
    return errors


def validate_content_lineage(cfg: dict, contract: dict, workspace: Path, sources: dict) -> list[str]:
    """Machine-check the structural floor that a weaker operator must not silently omit."""
    errors: list[str] = []
    policy = (core.qa_policy(contract).get("content_preflight") or {})
    errors.extend(_content_policy_errors(policy))
    if errors:
        return errors

    evidence_path, found = _safe_workspace_file(workspace, sources.get("evidence"), "EVIDENCE")
    errors.extend(found)
    board_path, found = _safe_workspace_file(workspace, sources.get("board"), "BOARD")
    errors.extend(found)
    trial_path, found = _safe_workspace_file(workspace, sources.get("trial"), "TRIAL")
    errors.extend(found)
    if errors or evidence_path is None or board_path is None or trial_path is None:
        return errors

    try:
        evidence = yaml.safe_load(evidence_path.read_text(encoding="utf-8")) or {}
        board_data = yaml.safe_load(board_path.read_text(encoding="utf-8")) or {}
        trial_text = trial_path.read_text(encoding="utf-8")
    except Exception as exc:
        return [f"PREBUILD_CONTENT_STRUCTURE_READ_FAILED: {exc}"]
    if not isinstance(evidence, dict) or not isinstance(board_data, dict):
        return ["PREBUILD_CONTENT_STRUCTURE_TOP_LEVEL_NOT_MAPPING"]

    case_id = cfg.get("case_id")
    if evidence.get("case_id") != case_id:
        errors.append(f"PREBUILD_EVIDENCE_CASE_ID_DRIFT: {evidence.get('case_id')!r} != {case_id!r}")

    boundary = evidence.get("teaching_boundary")
    if not isinstance(boundary, dict):
        errors.append("PREBUILD_TEACHING_BOUNDARY_MISSING")
    else:
        for field in policy["teaching_boundary_required_fields"]:
            value = boundary.get(field)
            if not isinstance(value, list):
                errors.append(f"PREBUILD_TEACHING_BOUNDARY_FIELD_MISSING: {field}")
            elif field == "must_teach" and not value:
                errors.append("PREBUILD_TEACHING_BOUNDARY_MUST_TEACH_EMPTY")

    chain = evidence.get("point_chain")
    if not isinstance(chain, list):
        errors.append("PREBUILD_POINT_CHAIN_MISSING")
        point_ids: list[str] = []
    else:
        lo, hi = int(policy["point_chain_min"]), int(policy["point_chain_max"])
        if not lo <= len(chain) <= hi:
            errors.append(f"PREBUILD_POINT_CHAIN_COUNT: {len(chain)} not in [{lo},{hi}]")
        point_ids = []
        for idx, item in enumerate(chain):
            pid = _point_id(item)
            if pid is None:
                errors.append(f"PREBUILD_POINT_CHAIN_ID_INVALID: index={idx}: {item!r}")
            else:
                point_ids.append(pid)
        if len(point_ids) != len(set(point_ids)):
            errors.append("PREBUILD_POINT_CHAIN_DUPLICATE_ID")

    closure = evidence.get("lesson_closure")
    if not isinstance(closure, dict):
        errors.append("PREBUILD_LESSON_CLOSURE_MISSING")
    else:
        for field in policy["lesson_closure_required_fields"]:
            if not _closure_value_ok(closure.get(field)):
                errors.append(f"PREBUILD_LESSON_CLOSURE_FIELD_MISSING: {field}")

    cases = [x for x in (board_data.get("cases") or []) if isinstance(x, dict) and x.get("id") == case_id]
    if len(cases) != 1:
        errors.append(f"PREBUILD_BOARD_CASE_RESOLUTION: expected=1 got={len(cases)}")
        board_case = {}
    else:
        board_case = cases[0]

    if board_case:
        increments = board_case.get("increments") or {}
        if not isinstance(increments, dict):
            errors.append("PREBUILD_BOARD_INCREMENTS_NOT_MAPPING")
        elif policy["require_point_ids_match_board_increments"] and point_ids and set(increments) != set(point_ids):
            errors.append(f"PREBUILD_POINT_BOARD_LINEAGE_DRIFT: points={point_ids} increments={list(increments)}")
        route = board_case.get("route")
        if route is not None:
            lo, hi = int(policy["route_anchor_min_when_present"]), int(policy["route_anchor_max_when_present"])
            if not isinstance(route, list) or not lo <= len(route) <= hi or not all(isinstance(x, str) and x.strip() for x in route):
                count = len(route) if isinstance(route, list) else "invalid"
                errors.append(f"PREBUILD_BOARD_ROUTE_ANCHOR_COUNT: {count} not valid in [{lo},{hi}]")

    if policy["require_trial_board_marker_sequence_match_point_chain"] and point_ids:
        markers = re.findall(r"\[\[BOARD:(P\d+)\]\]", trial_text)
        if markers != point_ids:
            errors.append(f"PREBUILD_TRIAL_POINT_SEQUENCE_DRIFT: trial={markers} point_chain={point_ids}")
    return errors


def _font_probe_source(texts: list[str]) -> str:
    """Build one small document using the exact canonical publisher preamble/fonts."""
    codepoints = sorted({c for text in texts for c in text if ord(c) >= 128 and c.isprintable()})
    chunks = ["".join(codepoints[i:i + 80]) for i in range(0, len(codepoints), 80)] or ["字体预检"]
    body = "\n\n".join(core.latex_plain(chunk) + r"\par" for chunk in chunks)
    return core.preamble("FONT-PREFLIGHT", "字体与字符覆盖预检") + body + "\n\\end{document}\n"


def font_and_codepoint_preflight(texts: list[str]) -> list[str]:
    """Fail before composition when canonical XeLaTeX/font/codepoint readiness is broken."""
    errors: list[str] = []
    with tempfile.TemporaryDirectory(prefix="qz-font-preflight-") as tmp:
        work = Path(tmp)
        tex = work / "font-preflight.tex"
        tex.write_text(_font_probe_source(texts), encoding="utf-8")
        try:
            proc = subprocess.run(
                ["xelatex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", tex.name],
                cwd=work,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=90,
            )
        except FileNotFoundError:
            return ["PREBUILD_XELATEX_NOT_AVAILABLE"]
        except subprocess.TimeoutExpired:
            return ["PREBUILD_FONT_PROBE_TIMEOUT"]
        log_path = work / "font-preflight.log"
        log = (log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else "") + "\n" + proc.stdout
        if proc.returncode:
            tail = " | ".join(x.strip() for x in proc.stdout.splitlines()[-8:] if x.strip())
            errors.append(f"PREBUILD_CANONICAL_FONT_COMPILE_FAILED: {tail}")
        missing = []
        for line in log.splitlines():
            if "Missing character:" in line and line.strip() not in missing:
                missing.append(line.strip())
        for line in missing[:20]:
            errors.append("PREBUILD_FONT_CODEPOINT_MISSING: " + line)
        if len(missing) > 20:
            errors.append(f"PREBUILD_FONT_CODEPOINT_MISSING_MORE: {len(missing) - 20}")
    return errors


def validate(manifest: str | None = None, *, root: Path = ROOT, run_font_probe: bool = True) -> list[str]:
    errors: list[str] = []
    try:
        _, cfg = load_manifest(manifest, root=root)
        contract = core.load_product_contract(cfg, root)
    except Exception as exc:
        return [f"PREBUILD_MANIFEST_OR_CONTRACT_INVALID: {exc}"]

    errors.extend(f"PREBUILD_{x}" for x in core.validate_manifest_binding(cfg, contract))
    workspace_raw = cfg.get("workspace")
    if not isinstance(workspace_raw, str) or not workspace_raw:
        return errors + ["PREBUILD_WORKSPACE_MISSING"]
    try:
        workspace = (root / workspace_raw).resolve()
        workspace.relative_to(root.resolve())
    except Exception:
        return errors + [f"PREBUILD_WORKSPACE_ESCAPES_REPOSITORY: {workspace_raw}"]
    if not workspace.is_dir():
        return errors + [f"PREBUILD_WORKSPACE_MISSING: {workspace_raw}"]

    sources = cfg.get("source") or {}
    if not isinstance(sources, dict):
        return errors + ["PREBUILD_SOURCE_MAP_INVALID"]

    errors.extend(validate_content_lineage(cfg, contract, workspace, sources))

    targets: list[tuple[str, Path]] = []
    for role in sorted(contract_source_roles(contract)):
        rel = sources.get(role)
        path, found = _safe_workspace_file(workspace, rel, f"SOURCE_{role.upper()}")
        errors.extend(found)
        if path is not None and path.suffix.lower() in TEXT_SUFFIXES:
            targets.append((role, path))

    board_path, found = _safe_workspace_file(workspace, sources.get("board"), "BOARD")
    errors.extend(found)
    if board_path is not None:
        targets.append(("board", board_path))

    seen: set[Path] = set()
    source_texts: list[str] = []
    for role, path in targets:
        if path in seen:
            continue
        seen.add(path)
        try:
            text = path.read_text(encoding="utf-8")
        except Exception as exc:
            errors.append(f"PREBUILD_SOURCE_READ_FAILED: {role}: {path.name}: {exc}")
            continue
        source_texts.append(text)
        for issue in lint_text(text, require_math_mode=True):
            fragment = issue.fragment.replace("\n", " ")
            errors.append(f"PREBUILD_{issue.code}: {role}:{path.name}: {fragment}")

    # Avoid spending even the small XeLaTeX probe when cheaper semantic/contract checks already failed.
    if run_font_probe and not errors:
        errors.extend(font_and_codepoint_preflight(source_texts))
    return errors


def selftest() -> None:
    notation_selftest()
    synthetic = {
        "documents": {
            "a": {
                "source_role": "analysis",
                "sections": [
                    {"source_role": "trial"},
                    {"source_role": "trial"},
                    {"renderer": "source_pages"},
                ],
            }
        }
    }
    assert contract_source_roles(synthetic) == {"analysis", "trial"}
    probe = _font_probe_source(["中文 a→b"])
    if "\\begin{document}" not in probe or "中文" not in probe:
        raise AssertionError("font probe does not use canonical preamble/body")
    assert _point_id("P3 定义") == "P3" and _point_id({"id": "P4"}) == "P4"
    assert _closure_value_ok("present") and _closure_value_ok({"status": "not-applicable", "reason": "synthetic"})
    with tempfile.TemporaryDirectory(prefix="qz-input-gate-") as tmp:
        root = Path(tmp)
        (root / "ok.txt").write_text("ok", encoding="utf-8")
        assert safe_repo_file("ok.txt", root=root).name == "ok.txt"
        try:
            safe_repo_file("../escape.txt", root=root)
        except ValueError:
            pass
        else:
            raise AssertionError("path traversal escaped prebuild gate")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=None)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--skip-font-probe", action="store_true", help="debug-only; canonical formal Golden Path does not use this")
    args = parser.parse_args()
    selftest()
    if args.selftest:
        print("PASS: Teaching Demo prebuild input gate selftest")
        return 0
    errors = validate(args.manifest, run_font_probe=not args.skip_font_probe)
    if errors:
        print("FAIL: Teaching Demo prebuild input gate")
        for error in errors:
            print("- " + error)
        return 1
    print("PASS: Teaching Demo prebuild input gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
