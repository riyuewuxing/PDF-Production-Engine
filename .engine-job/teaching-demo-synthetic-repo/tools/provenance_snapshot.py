#!/usr/bin/env python3
"""Durable repository provenance snapshots for Artifact Jobs.

A snapshot carries two identities on purpose:
- dependency_identity_sha256: only relevant repository dependency bytes; stable across
  commits when those bytes are unchanged, so cache/reuse stays content-addressed.
- snapshot_identity_sha256: the full audit record including exact source_commit.

Live execution verifies materialized bytes. Historical verification may resolve the
recorded source commit through a Git checkout. The public stateless Engine never needs
private repository credentials or history.
"""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any
import yaml

from artifact_foundation import ROOT, canonical_sha256, is_sha256, safe_repo_path, sha256_file

CONTRACT = Path("production/contracts/repository-provenance-snapshot-v1.yaml")
SNAPSHOT_SCHEMA = "qiuzhidaren-repository-snapshot-v1"
HEX40 = re.compile(r"^[0-9a-f]{40}$")


def git_blob_sha1_bytes(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def git_blob_sha1_file(path: Path) -> str:
    return git_blob_sha1_bytes(path.read_bytes())


def repository_binding(root: Path, raw: str, kind: str) -> dict[str, str]:
    if not isinstance(kind, str) or not kind.strip():
        raise ValueError("repository binding kind is required")
    path = safe_repo_path(root, raw, must_exist=True)
    if not path.is_file():
        raise ValueError(f"repository binding is not a file: {raw}")
    return {
        "path": raw,
        "sha256": sha256_file(path),
        "git_blob_sha1": git_blob_sha1_file(path),
        "kind": kind,
    }


def _normalized_dependency_bindings(bindings: Any) -> list[dict[str, str]]:
    if not isinstance(bindings, list) or not bindings:
        raise ValueError("repository snapshot requires at least one binding")
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for idx, item in enumerate(bindings):
        if not isinstance(item, dict):
            raise ValueError(f"binding[{idx}] must be a mapping")
        required = {"path", "sha256", "git_blob_sha1", "kind"}
        if not required <= set(item):
            raise ValueError(f"binding[{idx}] missing one of {sorted(required)}")
        raw = str(item["path"])
        if raw in seen:
            raise ValueError(f"duplicate repository snapshot path: {raw}")
        seen.add(raw)
        normalized.append({
            "path": raw,
            "sha256": str(item["sha256"]),
            "git_blob_sha1": str(item["git_blob_sha1"]),
            "kind": str(item["kind"]),
        })
    normalized.sort(key=lambda x: (x["path"], x["kind"], x["sha256"], x["git_blob_sha1"]))
    return normalized


def dependency_identity(snapshot: dict[str, Any]) -> str:
    """Content identity; deliberately excludes source_commit and snapshot record path."""
    basis = {
        "version": snapshot.get("version"),
        "schema_id": snapshot.get("schema_id"),
        "repository": snapshot.get("repository"),
        "canonical_branch": snapshot.get("canonical_branch"),
        "bindings": snapshot.get("bindings"),
    }
    return canonical_sha256(basis)


def _record_identity_payload(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in snapshot.items() if k != "snapshot_identity_sha256"}


def snapshot_identity(snapshot: dict[str, Any]) -> str:
    return canonical_sha256(_record_identity_payload(snapshot))


def snapshot_bytes(snapshot: dict[str, Any]) -> bytes:
    return yaml.safe_dump(snapshot, allow_unicode=True, sort_keys=False).encode("utf-8")


def build_snapshot(
    bindings: list[dict[str, Any]],
    source_commit: str,
    *,
    repository: str = "riyuewuxing/qiuzhidaren",
    canonical_branch: str = "main",
) -> dict[str, Any]:
    if not HEX40.fullmatch(source_commit):
        raise ValueError("source_commit must be lowercase 40-hex")
    if repository != "riyuewuxing/qiuzhidaren":
        raise ValueError("repository snapshot must identify riyuewuxing/qiuzhidaren")
    if canonical_branch != "main":
        raise ValueError("repository snapshot canonical_branch must be main")
    normalized = _normalized_dependency_bindings(bindings)
    snapshot: dict[str, Any] = {
        "version": 1,
        "schema_id": SNAPSHOT_SCHEMA,
        "repository": repository,
        "canonical_branch": canonical_branch,
        "source_commit": source_commit,
        "bindings": normalized,
    }
    snapshot["dependency_identity_sha256"] = dependency_identity(snapshot)
    snapshot["snapshot_identity_sha256"] = snapshot_identity(snapshot)
    return snapshot


def snapshot_target(snapshot: dict[str, Any], *, root: Path = ROOT) -> Path:
    identity = snapshot.get("snapshot_identity_sha256")
    if not is_sha256(identity):
        raise ValueError("snapshot record identity must be lowercase SHA-256")
    contract = yaml.safe_load((root / CONTRACT).read_text(encoding="utf-8")) or {}
    storage_root = ((contract.get("snapshot") or {}).get("storage_root"))
    if not isinstance(storage_root, str) or not storage_root:
        raise ValueError("provenance snapshot storage_root missing")
    base = safe_repo_path(root, storage_root)
    base.mkdir(parents=True, exist_ok=True)
    target = (base / f"{identity}.yaml").resolve()
    target.relative_to(base.resolve())
    return target


def snapshot_binding(snapshot: dict[str, Any], path: Path, *, root: Path = ROOT) -> dict[str, str]:
    dep = snapshot.get("dependency_identity_sha256")
    if not is_sha256(dep):
        raise ValueError("snapshot dependency identity invalid")
    return {
        "path": path.resolve().relative_to(root.resolve()).as_posix(),
        "sha256": sha256_file(path),
        "kind": "repository_snapshot",
        "dependency_identity_sha256": str(dep),
    }


def write_snapshot(snapshot: dict[str, Any], *, root: Path = ROOT) -> Path:
    errors = validate_snapshot(snapshot, root=root, mode="structure")
    if errors:
        raise ValueError(" | ".join(errors))
    target = snapshot_target(snapshot, root=root)
    payload = snapshot_bytes(snapshot)
    if target.exists():
        if target.read_bytes() != payload:
            raise ValueError("content-addressed repository snapshot path contains different bytes")
    else:
        target.write_bytes(payload)
    return target


def _validate_binding_structure(root: Path, binding: Any, label: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(binding, dict):
        return [f"{label}: must be a mapping"]
    raw = binding.get("path")
    try:
        safe_repo_path(root, raw)
    except Exception as exc:
        errors.append(f"{label}: {exc}")
    if not is_sha256(binding.get("sha256")):
        errors.append(f"{label}: sha256 invalid")
    git_blob = binding.get("git_blob_sha1")
    if not isinstance(git_blob, str) or not HEX40.fullmatch(git_blob):
        errors.append(f"{label}: git_blob_sha1 invalid")
    if not isinstance(binding.get("kind"), str) or not binding.get("kind"):
        errors.append(f"{label}: kind required")
    return errors


def _verify_live_binding(root: Path, binding: dict[str, Any], label: str) -> list[str]:
    errors = _validate_binding_structure(root, binding, label)
    if errors:
        return errors
    try:
        path = safe_repo_path(root, binding["path"], must_exist=True)
    except Exception as exc:
        return [f"{label}: {exc}"]
    if not path.is_file():
        return [f"{label}: current path is not a file"]
    if sha256_file(path) != binding["sha256"]:
        errors.append(f"{label}: live SHA-256 mismatch")
    if git_blob_sha1_file(path) != binding["git_blob_sha1"]:
        errors.append(f"{label}: live Git blob identity mismatch")
    return errors


def _git_bytes(root: Path, source_commit: str, raw: str) -> bytes:
    proc = subprocess.run(
        ["git", "cat-file", "blob", f"{source_commit}:{raw}"],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode:
        message = proc.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"git history cannot resolve {source_commit}:{raw}: {message}")
    return proc.stdout


def validate_snapshot(snapshot: dict[str, Any], *, root: Path = ROOT, mode: str = "structure") -> list[str]:
    errors: list[str] = []
    if mode not in {"structure", "live", "git-history"}:
        return [f"snapshot: unsupported verification mode {mode!r}"]
    if not isinstance(snapshot, dict):
        return ["snapshot: top level must be a mapping"]
    if snapshot.get("version") != 1:
        errors.append("snapshot: version must be 1")
    if snapshot.get("schema_id") != SNAPSHOT_SCHEMA:
        errors.append(f"snapshot: schema_id must be {SNAPSHOT_SCHEMA}")
    if snapshot.get("repository") != "riyuewuxing/qiuzhidaren":
        errors.append("snapshot: repository identity drift")
    if snapshot.get("canonical_branch") != "main":
        errors.append("snapshot: canonical_branch must be main")
    source_commit = snapshot.get("source_commit")
    if not isinstance(source_commit, str) or not HEX40.fullmatch(source_commit):
        errors.append("snapshot: source_commit must be lowercase 40-hex")
    bindings = snapshot.get("bindings")
    if not isinstance(bindings, list) or not bindings:
        errors.append("snapshot: bindings must be a non-empty list"); bindings = []
    seen: set[str] = set()
    for idx, binding in enumerate(bindings):
        label = f"snapshot.bindings[{idx}]"; errors.extend(_validate_binding_structure(root, binding, label))
        if isinstance(binding, dict):
            raw = binding.get("path")
            if isinstance(raw, str):
                if raw in seen: errors.append(f"{label}: duplicate path {raw}")
                seen.add(raw)
    dep = snapshot.get("dependency_identity_sha256")
    if not is_sha256(dep):
        errors.append("snapshot: dependency_identity_sha256 invalid")
    else:
        expected_dep = dependency_identity(snapshot)
        if dep != expected_dep:
            errors.append(f"snapshot: dependency identity mismatch declared={dep} expected={expected_dep}")
    declared_record = snapshot.get("snapshot_identity_sha256")
    if not is_sha256(declared_record):
        errors.append("snapshot: snapshot_identity_sha256 invalid")
    else:
        expected_record = snapshot_identity(snapshot)
        if declared_record != expected_record:
            errors.append(f"snapshot: record identity mismatch declared={declared_record} expected={expected_record}")
    if errors or mode == "structure":
        return errors
    if mode == "live":
        for idx, binding in enumerate(bindings):
            errors.extend(_verify_live_binding(root, binding, f"snapshot.bindings[{idx}]"))
        return errors
    try:
        probe = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if probe.returncode or probe.stdout.strip() != b"true":
            return ["snapshot: git-history mode requires a Git-aware checkout"]
    except FileNotFoundError:
        return ["snapshot: git-history mode requires git executable"]
    for idx, binding in enumerate(bindings):
        if not isinstance(binding, dict): continue
        label = f"snapshot.bindings[{idx}]"
        try:
            data = _git_bytes(root, str(source_commit), str(binding["path"]))
        except Exception as exc:
            errors.append(f"{label}: {exc}"); continue
        if hashlib.sha256(data).hexdigest() != binding["sha256"]:
            errors.append(f"{label}: source_commit SHA-256 mismatch")
        if git_blob_sha1_bytes(data) != binding["git_blob_sha1"]:
            errors.append(f"{label}: source_commit Git blob mismatch")
    return errors


def validate_snapshot_binding(root: Path, binding: Any, *, mode: str = "structure") -> tuple[dict[str, Any] | None, list[str]]:
    """Validate a snapshot binding and hydrate its stable dependency identity.

    The dependency identity is derivable only after the snapshot file itself has passed
    exact path/hash and internal-identity checks. Callers that constructed the compact
    `path + sha256 + kind` binding therefore receive the canonical derived field in the
    same in-memory mapping before persisting an Artifact Job. A conflicting declared
    value remains a hard failure.
    """
    errors: list[str] = []
    if not isinstance(binding, dict):
        return None, ["source_snapshot_binding: must be a mapping"]
    if binding.get("kind") != "repository_snapshot":
        errors.append("source_snapshot_binding.kind must be repository_snapshot")
    if not is_sha256(binding.get("sha256")):
        errors.append("source_snapshot_binding.sha256 invalid")
    try:
        path = safe_repo_path(root, binding.get("path"), must_exist=True)
    except Exception as exc:
        return None, errors + [f"source_snapshot_binding: {exc}"]
    if not path.is_file():
        return None, errors + ["source_snapshot_binding: target is not a file"]
    if sha256_file(path) != binding.get("sha256"):
        errors.append("source_snapshot_binding: snapshot file SHA-256 mismatch")
    try:
        snapshot = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        return None, errors + [f"source_snapshot_binding: unreadable YAML: {exc}"]
    errors.extend(validate_snapshot(snapshot, root=root, mode=mode))
    snapshot_dep = snapshot.get("dependency_identity_sha256")
    declared_dep = binding.get("dependency_identity_sha256")
    if declared_dep is None and is_sha256(snapshot_dep) and not errors:
        binding["dependency_identity_sha256"] = str(snapshot_dep)
        declared_dep = snapshot_dep
    elif not is_sha256(declared_dep):
        errors.append("source_snapshot_binding.dependency_identity_sha256 invalid")
    if declared_dep != snapshot_dep:
        errors.append("source_snapshot_binding: dependency identity differs from snapshot")
    try:
        expected_path = snapshot_target(snapshot, root=root)
        if expected_path.resolve() != path.resolve():
            errors.append("source_snapshot_binding: snapshot path is not content-addressed by record identity")
    except Exception as exc:
        errors.append(f"source_snapshot_binding: cannot resolve content-addressed path: {exc}")
    return snapshot, errors


def _pair(raw: str) -> tuple[str, str]:
    if "=" not in raw:
        raise argparse.ArgumentTypeError("expected PATH=KIND")
    path, kind = raw.rsplit("=", 1)
    if not path or not kind:
        raise argparse.ArgumentTypeError("expected non-empty PATH=KIND")
    return path, kind


def selftest() -> int:
    assert git_blob_sha1_bytes(b"test content\n") == "d670460b4b4aece5915caf5c68d12f560a9fe3e4"
    with tempfile.TemporaryDirectory(prefix="qz-provenance-") as tmp:
        root = Path(tmp)
        (root / "production/contracts").mkdir(parents=True)
        (root / "production/provenance/repository-snapshots").mkdir(parents=True)
        (root / CONTRACT).write_text("snapshot:\n  storage_root: production/provenance/repository-snapshots\n", encoding="utf-8")
        (root / "a.txt").write_text("alpha\n", encoding="utf-8")
        binding = repository_binding(root, "a.txt", "source")
        one = build_snapshot([binding], "a" * 40)
        two = build_snapshot([binding], "b" * 40)
        if one["dependency_identity_sha256"] != two["dependency_identity_sha256"]:
            print("FAIL: byte-identical dependencies changed cache identity across source commits"); return 1
        if one["snapshot_identity_sha256"] == two["snapshot_identity_sha256"]:
            print("FAIL: source commit disappeared from audit record identity"); return 1
        if validate_snapshot(one, root=root, mode="structure"):
            print("FAIL: valid snapshot structure rejected"); return 1
        target = write_snapshot(one, root=root)
        compact = {"path": target.relative_to(root).as_posix(), "sha256": sha256_file(target), "kind": "repository_snapshot"}
        _, found = validate_snapshot_binding(root, compact, mode="live")
        if found:
            print("FAIL: valid live snapshot rejected", found); return 1
        if compact.get("dependency_identity_sha256") != one.get("dependency_identity_sha256"):
            print("FAIL: verified compact binding was not hydrated with dependency identity"); return 1
        (root / "a.txt").write_text("changed\n", encoding="utf-8")
        _, found = validate_snapshot_binding(root, compact, mode="live")
        if not found:
            print("FAIL: changed live bytes escaped snapshot verification"); return 1
        _, historical_structure = validate_snapshot_binding(root, compact, mode="structure")
        if historical_structure:
            print("FAIL: historical structure should not depend on current path bytes", historical_structure); return 1
    print("PASS: provenance snapshot selftest")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--source-commit")
    parser.add_argument("--binding", action="append", type=_pair, default=[])
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--snapshot")
    parser.add_argument("--mode", choices=["structure", "live", "git-history"], default="structure")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if args.snapshot:
        path = safe_repo_path(ROOT, args.snapshot, must_exist=True)
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        errors = validate_snapshot(data, root=ROOT, mode=args.mode)
        if errors:
            print("FAIL: repository provenance snapshot")
            for error in errors: print("- " + error)
            return 1
        print(f"PASS: repository provenance snapshot [{args.mode}]")
        return 0
    if not args.source_commit or not args.binding:
        parser.error("--source-commit and at least one --binding PATH=KIND are required")
    try:
        bindings = [repository_binding(ROOT, path, kind) for path, kind in args.binding]
        snapshot = build_snapshot(bindings, args.source_commit)
        if args.write:
            target = write_snapshot(snapshot)
            print(f"SNAPSHOT_WRITTEN: {target.relative_to(ROOT)}")
            print(f"DEPENDENCY_IDENTITY_SHA256: {snapshot['dependency_identity_sha256']}")
            print(f"SNAPSHOT_IDENTITY_SHA256: {snapshot['snapshot_identity_sha256']}")
        else:
            print(yaml.safe_dump(snapshot, allow_unicode=True, sort_keys=False).rstrip())
    except Exception as exc:
        print(f"FAIL: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
