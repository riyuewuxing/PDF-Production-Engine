#!/usr/bin/env python3
"""Shared primitives for qiuzhidaren artifact governance."""
from __future__ import annotations
from datetime import datetime
import hashlib
import json
from pathlib import Path
from typing import Any
import yaml

ROOT = Path(__file__).resolve().parents[1]
HEX = set("0123456789abcdef")
MODULE_REGISTRY = Path("production/contracts/module-registry-v1.yaml")
ARTIFACT_CONTRACT = Path("production/contracts/artifact-job-v1.yaml")


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(value, dict):
        raise ValueError(f"{path}: top-level YAML must be a mapping")
    return value


def module_lifecycle_values(root: Path = ROOT) -> set[str]:
    values = load_yaml(root / MODULE_REGISTRY).get("allowed_lifecycle") or []
    if not isinstance(values, list) or not all(isinstance(x, str) and x for x in values):
        raise ValueError("module registry allowed_lifecycle must be a non-empty string list")
    return set(values)


def artifact_states(root: Path = ROOT) -> tuple[str, ...]:
    values = load_yaml(root / ARTIFACT_CONTRACT).get("states") or []
    if not isinstance(values, list) or not all(isinstance(x, str) and x for x in values):
        raise ValueError("artifact contract states must be a non-empty string list")
    return tuple(values)


def safe_repo_path(root: Path, raw: Any, *, must_exist: bool = False) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("path must be a non-empty repository-relative string")
    p = Path(raw)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError(f"absolute/traversal path forbidden: {raw!r}")
    resolved = (root / p).resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"path escapes repository root: {raw!r}") from exc
    if must_exist and not resolved.exists():
        raise ValueError(f"path does not exist: {raw}")
    return resolved


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def binding_key(binding: dict[str, Any]) -> tuple[str, str, str]:
    return (str(binding.get("path") or ""), str(binding.get("sha256") or ""), str(binding.get("kind") or ""))


def source_snapshot_fingerprint_projection(binding: Any) -> dict[str, str]:
    """Expose the stable snapshot dependency identity for comparison/indexing."""
    if not isinstance(binding, dict):
        raise ValueError("source_snapshot_binding must be a mapping")
    dep = binding.get("dependency_identity_sha256")
    if not is_sha256(dep):
        raise ValueError("source_snapshot_binding.dependency_identity_sha256 must be lowercase SHA-256")
    if binding.get("kind") != "repository_snapshot":
        raise ValueError("source_snapshot_binding.kind must be repository_snapshot")
    return {"kind": "repository_snapshot", "dependency_identity_sha256": str(dep)}


def fingerprint_input_bindings(input_bindings: Any, exempt_kinds: Any = None) -> list[dict[str, Any]]:
    """Return execution-relevant input bindings for the reusable content identity."""
    if not isinstance(input_bindings, list) or not all(isinstance(x, dict) for x in input_bindings):
        raise ValueError("input_bindings must be a list of mappings")
    exempt = set(exempt_kinds or [])
    if not all(isinstance(x, str) and x for x in exempt):
        raise ValueError("fingerprint exempt input kinds must be non-empty strings")
    projected = [dict(x) for x in input_bindings if x.get("kind") not in exempt]
    return sorted(projected, key=binding_key)


def artifact_input_fingerprint(
    module_id: Any,
    module_contract_binding: Any,
    builder_binding: Any,
    runtime_identity: Any,
    input_bindings: Any,
    source_snapshot_binding: Any = None,
    fingerprint_exempt_input_kinds: Any = None,
) -> str:
    """Canonical execution/reuse fingerprint.

    The reusable identity is derived directly from every explicit execution dependency:
    Module Contract bytes, builder bytes, runtime, and execution-relevant input bytes.
    A Repository Snapshot is a parallel durable audit record over exactly those repository
    bindings, so inserting the snapshot record identity again would be redundant and would
    couple reuse to source_commit. New snapshot-backed jobs therefore use the snapshot only
    to activate the contract-defined audit-record exemption (`input_plan` by default).

    With no Repository Snapshot this preserves the pre-ADR-010 basis exactly.
    """
    if not isinstance(module_contract_binding, dict) or not isinstance(builder_binding, dict):
        raise ValueError("module_contract_binding and builder_binding must be mappings")
    if not isinstance(runtime_identity, dict):
        raise ValueError("runtime_identity must be a mapping")
    if source_snapshot_binding is not None:
        if not isinstance(source_snapshot_binding, dict) or source_snapshot_binding.get("kind") != "repository_snapshot":
            raise ValueError("source_snapshot_binding must be a repository_snapshot binding")
        if fingerprint_exempt_input_kinds is None:
            fingerprint_exempt_input_kinds = {"input_plan"}
    basis: dict[str, Any] = {
        "module_id": module_id,
        "module_contract_binding": module_contract_binding,
        "builder_binding": builder_binding,
        "runtime_identity": runtime_identity,
        "input_bindings": fingerprint_input_bindings(input_bindings, fingerprint_exempt_input_kinds),
    }
    return canonical_sha256(basis)


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= HEX


def validate_binding(root: Path, binding: Any, label: str, *, require_file: bool = True) -> list[str]:
    errors: list[str] = []
    if not isinstance(binding, dict):
        return [f"{label}: binding must be a mapping"]
    raw = binding.get("path")
    digest = binding.get("sha256")
    kind = binding.get("kind")
    if not isinstance(kind, str) or not kind:
        errors.append(f"{label}: kind is required")
    try:
        path = safe_repo_path(root, raw)
    except ValueError as exc:
        errors.append(f"{label}: {exc}")
        return errors
    if not is_sha256(digest):
        errors.append(f"{label}: sha256 must be lowercase 64-char SHA-256")
        return errors
    if require_file:
        if not path.is_file():
            errors.append(f"{label}: bound file missing: {raw}")
        else:
            actual = sha256_file(path)
            if actual != digest:
                errors.append(f"{label}: hash mismatch for {raw}: declared={digest} actual={actual}")
    return errors


def parse_iso8601(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True
