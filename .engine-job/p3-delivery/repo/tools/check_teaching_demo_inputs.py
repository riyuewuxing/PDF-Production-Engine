#!/usr/bin/env python3
"""Canonical Teaching Demo prebuild input gate.

One route only: portable case/source checks + ACCEPTED canonical content gate + publication,
physics-notation and font/codepoint preflight. There is no legacy/version dispatch.
Content authors use check_teaching_demo_content.py --mode readiness before independent review;
this downstream prebuild entry requires an exact-byte independent content PASS.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any
import yaml

import check_teaching_demo_case as case_gate
import check_teaching_demo_content as content_gate
import publisher_core as core
from physics_notation import lint_text, selftest as notation_selftest

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = Path("production/current-run.yaml")
TEXT_SUFFIXES = {".md", ".txt", ".yaml", ".yml"}
CONTROL_MARKER_RE = re.compile(r"\[\[(?:BOARD:B\d+|FIGURE:[a-z0-9-]+)\]\]")


def _yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"top-level YAML must be mapping: {path}")
    return data


def _repo_file(root: Path, raw: str | Path) -> Path:
    rel = Path(raw)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"repository-relative path required: {raw}")
    path = (root / rel).resolve()
    path.relative_to(root.resolve())
    if not path.is_file():
        raise ValueError(f"file missing: {raw}")
    return path


def load_manifest(raw: str | None, *, root: Path = ROOT) -> tuple[Path, dict[str, Any]]:
    path = _repo_file(root, raw or DEFAULT_MANIFEST)
    return path, _yaml(path)


def _workspace_file(workspace: Path, raw: Any, label: str) -> tuple[Path | None, list[str]]:
    if not isinstance(raw, str) or not raw:
        return None, [f"PREBUILD_{label}_PATH_MISSING"]
    path = (workspace / raw).resolve()
    try:
        path.relative_to(workspace.resolve())
    except ValueError:
        return None, [f"PREBUILD_{label}_ESCAPES_WORKSPACE:{raw}"]
    if not path.is_file():
        return None, [f"PREBUILD_{label}_FILE_MISSING:{raw}"]
    return path, []


def contract_source_roles(contract: dict[str, Any]) -> set[str]:
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


def publication_forbidden_regex_errors(contract: dict[str, Any], role: str, path: Path, text: str) -> list[str]:
    patterns = (contract.get("publication") or {}).get("forbidden_engineering_regexes") or []
    if not isinstance(patterns, list):
        return ["PREBUILD_PUBLICATION_FORBIDDEN_REGEXES_INVALID"]
    visible = CONTROL_MARKER_RE.sub("", text)
    errors: list[str] = []
    for raw in patterns:
        if not isinstance(raw, str) or not raw:
            errors.append("PREBUILD_PUBLICATION_FORBIDDEN_REGEX_INVALID")
            continue
        try:
            match = re.search(raw, visible)
        except re.error as exc:
            errors.append(f"PREBUILD_PUBLICATION_FORBIDDEN_REGEX_INVALID:{raw!r}:{exc}")
            continue
        if match:
            fragment = match.group(0).replace("\n", " ")
            errors.append(f"PREBUILD_ENGINEERING_LABEL_LEAK:{role}:{path.name}:{raw}:{fragment}")
    return errors


def _font_probe_source(texts: list[str]) -> str:
    codepoints = sorted({c for text in texts for c in text if ord(c) >= 128 and c.isprintable()})
    chunks = ["".join(codepoints[i:i + 80]) for i in range(0, len(codepoints), 80)] or ["字体预检"]
    body = "\n\n".join(core.latex_plain(chunk) + r"\par" for chunk in chunks)
    return core.preamble("FONT-PREFLIGHT", "字体与字符覆盖预检") + body + "\n\\end{document}\n"


def font_and_codepoint_preflight(texts: list[str]) -> list[str]:
    with tempfile.TemporaryDirectory(prefix="qz-font-preflight-") as tmp:
        work = Path(tmp)
        tex = work / "font-preflight.tex"
        tex.write_text(_font_probe_source(texts), encoding="utf-8")
        try:
            proc = subprocess.run(
                ["xelatex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", tex.name],
                cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=90,
            )
        except FileNotFoundError:
            return ["PREBUILD_XELATEX_NOT_AVAILABLE"]
        except subprocess.TimeoutExpired:
            return ["PREBUILD_FONT_PROBE_TIMEOUT"]
        log_path = work / "font-preflight.log"
        log = (log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else "") + "\n" + proc.stdout
        errors: list[str] = []
        if proc.returncode:
            tail = " | ".join(x.strip() for x in proc.stdout.splitlines()[-8:] if x.strip())
            errors.append(f"PREBUILD_CANONICAL_FONT_COMPILE_FAILED:{tail}")
        missing = []
        for line in log.splitlines():
            if "Missing character:" in line and line.strip() not in missing:
                missing.append(line.strip())
        errors.extend("PREBUILD_FONT_CODEPOINT_MISSING:" + line for line in missing[:20])
        if len(missing) > 20:
            errors.append(f"PREBUILD_FONT_CODEPOINT_MISSING_MORE:{len(missing) - 20}")
        return errors


def validate(manifest: str | None = None, *, root: Path = ROOT, run_font_probe: bool = True) -> list[str]:
    raw_manifest = str(manifest or DEFAULT_MANIFEST)
    errors: list[str] = []

    errors.extend("PREBUILD_" + e for e in case_gate.validate(raw_manifest, root=root))
    if errors:
        return errors

    try:
        _, cfg = load_manifest(raw_manifest, root=root)
        contract = core.load_product_contract(cfg, root)
        workspace_raw = cfg.get("workspace")
        if not isinstance(workspace_raw, str) or not workspace_raw:
            return ["PREBUILD_WORKSPACE_MISSING"]
        workspace = (root / workspace_raw).resolve()
        workspace.relative_to(root.resolve())
        if not workspace.is_dir():
            return [f"PREBUILD_WORKSPACE_MISSING:{workspace_raw}"]
        sources = cfg.get("source") or {}
        if not isinstance(sources, dict):
            return ["PREBUILD_SOURCE_MAP_INVALID"]
    except Exception as exc:
        return [f"PREBUILD_MANIFEST_OR_CONTRACT_INVALID:{exc}"]

    # The sole content route must already have independent exact-byte acceptance.
    errors.extend(
        "PREBUILD_" + e
        for e in content_gate.validate(raw_manifest, root=root, require_independent=True)
    )

    targets: list[tuple[str, Path]] = []
    rendered_roles = contract_source_roles(contract)
    for role in sorted(rendered_roles):
        path, found = _workspace_file(workspace, sources.get(role), f"SOURCE_{role.upper()}")
        errors.extend(found)
        if path is not None and path.suffix.lower() in TEXT_SUFFIXES:
            targets.append((role, path))
    board_path, found = _workspace_file(workspace, sources.get("board"), "BOARD")
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
            errors.append(f"PREBUILD_SOURCE_READ_FAILED:{role}:{path.name}:{exc}")
            continue
        source_texts.append(text)
        if role in rendered_roles:
            errors.extend(publication_forbidden_regex_errors(contract, role, path, text))
        for issue in lint_text(text, require_math_mode=True):
            fragment = issue.fragment.replace("\n", " ")
            errors.append(f"PREBUILD_{issue.code}:{role}:{path.name}:{fragment}")

    if run_font_probe and not errors:
        errors.extend(font_and_codepoint_preflight(source_texts))
    return errors


def selftest() -> None:
    notation_selftest()
    synthetic = {"documents": {"a": {"source_role": "analysis", "sections": [{"source_role": "trial"}]}}}
    assert contract_source_roles(synthetic) == {"analysis", "trial"}
    probe = _font_probe_source(["中文 a→b"])
    assert "\\begin{document}" in probe and "中文" in probe
    synthetic_contract = {"publication": {"forbidden_engineering_regexes": [r"\bP\d+\b"]}}
    assert publication_forbidden_regex_errors(synthetic_contract, "trial", Path("trial.md"), "[[BOARD:B1]] 教学") == []
    assert publication_forbidden_regex_errors(synthetic_contract, "trial", Path("trial.md"), "对外 P2")
    content_gate.selftest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=None)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--skip-font-probe", action="store_true", help="debug only")
    args = parser.parse_args()
    selftest()
    if args.selftest:
        print("PASS: canonical Teaching Demo prebuild input gate selftest")
        return 0
    errors = validate(args.manifest, run_font_probe=not args.skip_font_probe)
    if errors:
        print("FAIL: canonical Teaching Demo prebuild input gate")
        for error in errors:
            print("- " + error)
        return 1
    print("PASS: canonical Teaching Demo prebuild input gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
