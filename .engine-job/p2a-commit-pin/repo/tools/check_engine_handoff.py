#!/usr/bin/env python3
"""Fail-closed validator for the single public Engine handoff anchor."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any, Callable

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = Path("contracts/engine-handoff.yaml")
TEXT_SUFFIXES = {".yaml", ".yml", ".json", ".toml", ".md"}
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
PIN_MODES = {"commit"}


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected mapping")
    return value


def _get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "qiuzhidaren-engine-handoff-checker/2",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"GitHub response is not a mapping: {url}")
    return value


def _get_bytes(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "qiuzhidaren-engine-handoff-checker/2"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def _quoted_repo(repository: str) -> str:
    return "/".join(urllib.parse.quote(part, safe="") for part in repository.split("/", 1))


def resolve_commit_pin(repository: str, ref: str) -> str:
    """Resolve an immutable full commit SHA through GitHub's commit endpoint."""
    if not SHA40.fullmatch(ref):
        raise ValueError("engine.ref must be a full 40-hex commit SHA in pin_mode=commit")
    value = _get_json(f"https://api.github.com/repos/{_quoted_repo(repository)}/commits/{ref}")
    resolved = value.get("sha")
    if not isinstance(resolved, str) or not SHA40.fullmatch(resolved):
        raise ValueError("GitHub commit response is missing a full commit SHA")
    return resolved


def _safe_remote_path(relative_path: str) -> str:
    if not isinstance(relative_path, str) or not relative_path:
        raise ValueError("engine contract path must be a non-empty relative path")
    if relative_path.startswith("/") or "\\" in relative_path:
        raise ValueError(f"unsafe engine contract path: {relative_path!r}")
    pure = PurePosixPath(relative_path)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError(f"unsafe engine contract path: {relative_path!r}")
    return "/".join(urllib.parse.quote(part, safe="") for part in pure.parts)


def remote_file_bytes(repository: str, commit: str, relative_path: str) -> bytes:
    if not SHA40.fullmatch(commit):
        raise ValueError("remote file fetch requires a full 40-hex commit SHA")
    owner, name = repository.split("/", 1)
    path = _safe_remote_path(relative_path)
    return _get_bytes(
        "https://raw.githubusercontent.com/"
        + urllib.parse.quote(owner, safe="")
        + "/"
        + urllib.parse.quote(name, safe="")
        + "/"
        + commit
        + "/"
        + path
    )


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _yaml_anchor_values(value: Any, found: dict[str, set[str]]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in found and isinstance(child, (str, int, float, bool)):
                found[key].add(str(child))
            _yaml_anchor_values(child, found)
    elif isinstance(value, list):
        for child in value:
            _yaml_anchor_values(child, found)


def duplicate_anchor_files(
    root: Path,
    *,
    contract: dict[str, Any],
    repository: str,
    ref: str,
    commit: str,
    contract_hash: str,
) -> list[str]:
    single = contract.get("single_declaration") or {}
    allow_only = set(single.get("allow_only") or [])
    allowed_reference_files = set(single.get("allowed_reference_files") or [])
    allowed = allow_only | allowed_reference_files
    duplicates: list[str] = []

    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            continue
        if rel.startswith(".git/") or rel in allowed:
            continue
        if rel in {"RECORDS.md", "MEMORY.md"} or rel.startswith("outputs/"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        found = {
            "repository": set(),
            "pin_mode": set(),
            "ref": set(),
            "commit": set(),
            "cli_contract_sha256": set(),
        }
        if path.suffix.lower() in {".yaml", ".yml"}:
            try:
                value = yaml.safe_load(text)
            except yaml.YAMLError:
                value = None
            _yaml_anchor_values(value, found)
        elif path.suffix.lower() == ".json":
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                value = None
            _yaml_anchor_values(value, found)
        else:
            assignment = re.compile(
                r"^\s*(repository|pin_mode|ref|commit|cli_contract_sha256)\s*[:=]\s*[\"']?([^\s\"'#]+)",
                re.MULTILINE,
            )
            for key, raw in assignment.findall(text):
                found[key].add(raw)

        exact_identity = repository in found["repository"]
        exact_anchor = (
            ref in found["ref"]
            or commit in found["commit"]
            or contract_hash in found["cli_contract_sha256"]
        )
        if exact_identity and exact_anchor:
            duplicates.append(rel)
    return duplicates


ResolveCommit = Callable[[str, str], str]
ReadRemote = Callable[[str, str, str], bytes]


def validate(
    root: Path,
    *,
    strict: bool,
    resolve_commit: ResolveCommit = resolve_commit_pin,
    read_remote: ReadRemote = remote_file_bytes,
) -> list[str]:
    root = root.resolve()
    errors: list[str] = []
    path = root / CONTRACT
    try:
        contract = load_yaml(path)
    except Exception as exc:
        return [f"cannot load {CONTRACT}: {exc}"]

    engine = contract.get("engine")
    if not isinstance(engine, dict):
        return ["engine mapping missing"]

    pin_mode = engine.get("pin_mode")
    repository = engine.get("repository")
    ref = engine.get("ref")
    commit = engine.get("commit")
    cli_contract = engine.get("cli_contract")
    cli_hash = engine.get("cli_contract_sha256")

    if pin_mode not in PIN_MODES:
        errors.append("engine.pin_mode must be commit")
    if not isinstance(repository, str) or not REPO.fullmatch(repository):
        errors.append("engine.repository must be owner/repo")
    if not isinstance(ref, str) or not SHA40.fullmatch(ref):
        errors.append("engine.ref must be a full 40-hex commit SHA; branches/tags/short SHAs are forbidden")
    if not isinstance(commit, str) or not SHA40.fullmatch(commit):
        errors.append("engine.commit must be a full 40-hex commit SHA; placeholders are forbidden")
    if isinstance(ref, str) and isinstance(commit, str) and SHA40.fullmatch(ref) and SHA40.fullmatch(commit) and ref != commit:
        errors.append("engine.ref and engine.commit must be identical in pin_mode=commit")
    try:
        _safe_remote_path(cli_contract)
    except (TypeError, ValueError) as exc:
        errors.append(f"engine.cli_contract invalid: {exc}")
    if not isinstance(cli_hash, str) or not SHA256.fullmatch(cli_hash):
        errors.append("engine.cli_contract_sha256 must be 64 lowercase hex; placeholders are forbidden")

    additional = engine.get("additional_contracts")
    if additional is None:
        additional = []
    if not isinstance(additional, list):
        errors.append("engine.additional_contracts must be a list")
        additional = []
    for index, item in enumerate(additional):
        if not isinstance(item, dict):
            errors.append(f"engine.additional_contracts[{index}] must be mapping")
            continue
        item_path = item.get("path")
        item_hash = item.get("sha256")
        try:
            _safe_remote_path(item_path)
        except (TypeError, ValueError) as exc:
            errors.append(f"engine.additional_contracts[{index}].path invalid: {exc}")
        if not isinstance(item_hash, str) or not SHA256.fullmatch(item_hash):
            errors.append(f"engine.additional_contracts[{index}].sha256 invalid")

    if errors:
        return errors

    duplicates = duplicate_anchor_files(
        root,
        contract=contract,
        repository=repository,
        ref=ref,
        commit=commit,
        contract_hash=cli_hash,
    )
    if duplicates:
        errors.append("duplicate cross-repo anchor: " + ", ".join(duplicates))

    if not strict:
        return errors

    try:
        resolved = resolve_commit(repository, ref)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        errors.append(f"engine commit pin unverifiable: {exc}")
        return errors
    if resolved != commit:
        errors.append(f"engine commit pin drift: resolved {resolved}, contract {commit}")

    try:
        data = read_remote(repository, commit, cli_contract)
        actual = sha256_bytes(data)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        errors.append(f"engine cli contract unavailable: {exc}")
    else:
        if actual != cli_hash:
            errors.append(f"engine cli contract drift: expected {cli_hash}, actual {actual}")

    for index, item in enumerate(additional):
        try:
            data = read_remote(repository, commit, item["path"])
            actual = sha256_bytes(data)
        except (OSError, ValueError, urllib.error.URLError) as exc:
            errors.append(f"additional contract[{index}] unavailable: {exc}")
            continue
        if actual != item["sha256"]:
            errors.append(
                f"additional contract[{index}] drift: expected {item['sha256']}, actual {actual}"
            )

    return errors


def _selftest_contract(commit: str, payload: bytes) -> dict[str, Any]:
    return {
        "version": 2,
        "engine": {
            "repository": "example/public-engine",
            "pin_mode": "commit",
            "ref": commit,
            "commit": commit,
            "cli_contract": "schemas/resource-job-v1.yaml",
            "cli_contract_sha256": sha256_bytes(payload),
            "transport": "chatgpt-session-mediated",
            "additional_contracts": [],
        },
        "handoff": {
            "package": "build-package/<job_id>.zip",
            "manifest": "manifest.json",
            "receipt": "provenance-receipt.json",
        },
        "unlock_policy": {
            "formal_pdf": "bounded_release",
            "phase_b": "independent_evidence_line",
        },
        "single_declaration": {
            "allow_only": ["contracts/engine-handoff.yaml"],
            "allowed_reference_files": [],
        },
    }


def selftest() -> None:
    commit = "a" * 40
    payload = b"synthetic-contract\n"

    def resolver(_repository: str, ref: str) -> str:
        if ref == "f" * 40:
            raise ValueError("synthetic missing commit")
        return ref

    def reader(_repository: str, _commit: str, path: str) -> bytes:
        if path == "schemas/missing.yaml":
            raise ValueError("synthetic missing contract")
        return payload

    def write_contract(root: Path, value: dict[str, Any]) -> None:
        path = root / CONTRACT
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="engine-handoff-selftest-") as tmp:
        root = Path(tmp)

        good = _selftest_contract(commit, payload)
        write_contract(root, good)
        if validate(root, strict=True, resolve_commit=resolver, read_remote=reader):
            raise AssertionError("valid immutable commit pin rejected")

        branch = _selftest_contract(commit, payload)
        branch["engine"]["ref"] = "main"
        write_contract(root, branch)
        if not any("40-hex" in e for e in validate(root, strict=False)):
            raise AssertionError("branch ref escaped commit-pin validation")

        mismatch = _selftest_contract(commit, payload)
        mismatch["engine"]["ref"] = "b" * 40
        write_contract(root, mismatch)
        if not any("must be identical" in e for e in validate(root, strict=False)):
            raise AssertionError("ref/commit mismatch escaped validation")

        missing = _selftest_contract("f" * 40, payload)
        write_contract(root, missing)
        if not any("unverifiable" in e for e in validate(root, strict=True, resolve_commit=resolver, read_remote=reader)):
            raise AssertionError("missing commit escaped strict validation")

        wrong_hash = _selftest_contract(commit, payload)
        wrong_hash["engine"]["cli_contract_sha256"] = "0" * 64
        write_contract(root, wrong_hash)
        if not any("cli contract drift" in e for e in validate(root, strict=True, resolve_commit=resolver, read_remote=reader)):
            raise AssertionError("wrong contract hash escaped strict validation")

        traversal = _selftest_contract(commit, payload)
        traversal["engine"]["cli_contract"] = "../secret"
        write_contract(root, traversal)
        if not any("cli_contract invalid" in e for e in validate(root, strict=False)):
            raise AssertionError("path traversal escaped validation")

        duplicate = _selftest_contract(commit, payload)
        write_contract(root, duplicate)
        extra = root / "duplicate.yaml"
        extra.write_text(
            yaml.safe_dump(
                {
                    "engine": {
                        "repository": duplicate["engine"]["repository"],
                        "commit": duplicate["engine"]["commit"],
                    }
                }
            ),
            encoding="utf-8",
        )
        if not any("duplicate cross-repo anchor" in e for e in validate(root, strict=False)):
            raise AssertionError("duplicate active anchor escaped validation")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        selftest()
        print("SELFTEST OK: engine handoff commit pin")
        return 0
    errors = validate(args.root, strict=args.strict)
    if errors:
        print("FAIL: engine handoff")
        for error in errors:
            print("- " + error)
        return 1
    print("PASS: engine handoff commit pin is unique and verifiable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
