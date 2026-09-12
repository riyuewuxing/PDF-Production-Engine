#!/usr/bin/env python3
"""Deterministic stage-scoped build packager for Artifact Jobs.

This is a materializer, not a planner. It consumes an already-valid Artifact Job
and its hash-bound dependency closure. The resulting ZIP may contain private
business/textbook bytes and therefore is for the repository-approved private
handoff transport only; it must never be uploaded as a public Engine artifact.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import string
import tempfile
import zipfile

import yaml
from typing import Any

from artifact_foundation import ROOT, load_yaml, safe_repo_path, sha256_file
import check_artifact_job

PACKAGE_SCHEMA = "qiuzhidaren-stage-build-package-v1"
HANDOFF_CONTRACT = Path("contracts/engine-handoff.yaml")
ARTIFACT_CONTRACT = Path("production/contracts/artifact-job-v1.yaml")
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)
STAGES = {"resource", "composition", "final"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")


def _repo_rel(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _safe_relative(raw: Any, label: str) -> str:
    if not isinstance(raw, str) or not raw or raw.startswith("/") or "\\" in raw:
        raise ValueError(f"{label} must be a safe relative path")
    pure = PurePosixPath(raw)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError(f"{label} must be a safe relative path")
    return pure.as_posix()


def _stage_policy(root: Path) -> dict[str, Any]:
    policy = load_yaml(root / ARTIFACT_CONTRACT).get("engine_stage_spec") or {}
    if not isinstance(policy, dict):
        raise ValueError("artifact contract engine_stage_spec mapping missing")
    return policy


def _locked_binding(job: dict[str, Any], raw: str, kind: str | None = None) -> dict[str, Any]:
    matches = [
        item
        for item in (job.get("input_bindings") or [])
        if isinstance(item, dict)
        and item.get("path") == raw
        and (kind is None or item.get("kind") == kind)
    ]
    if len(matches) != 1:
        raise ValueError(f"locked input must resolve exactly once: {raw!r}: {len(matches)}")
    return matches[0]


def _load_stage_spec(
    root: Path,
    job: dict[str, Any],
    raw: str,
    *,
    stage: str,
    block_id: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    policy = _stage_policy(root)
    binding_kind = policy.get("binding_kind")
    schema_id = policy.get("schema_id")
    if not isinstance(binding_kind, str) or not binding_kind:
        raise ValueError("engine_stage_spec.binding_kind missing")
    binding = _locked_binding(job, raw, binding_kind)
    path = safe_repo_path(root, raw, must_exist=True)
    actual = sha256_file(path)
    if actual != binding.get("sha256"):
        raise ValueError(f"engine stage spec hash mismatch: {raw}")
    spec = load_yaml(path)
    if spec.get("version") != 1 or spec.get("schema_id") != schema_id:
        raise ValueError("engine stage spec schema/version mismatch")
    if spec.get("stage") != stage or stage not in set(policy.get("stages") or []):
        raise ValueError(f"engine stage spec stage mismatch: requested={stage!r} declared={spec.get('stage')!r}")
    if spec.get("privacy") not in set(policy.get("privacy_values") or []):
        raise ValueError("engine stage spec privacy invalid")

    expected_mode = policy.get({
        "resource": "resource_input_mode",
        "composition": "composition_input_mode",
        "final": "final_input_mode",
    }[stage])
    if spec.get("input_mode") != expected_mode:
        raise ValueError(
            f"engine stage spec input_mode mismatch: expected={expected_mode!r} actual={spec.get('input_mode')!r}"
        )

    paths = spec.get("input_paths") or []
    if not isinstance(paths, list) or not all(isinstance(x, str) and x for x in paths):
        raise ValueError("engine stage spec input_paths must be a string list")
    if len(paths) != len(set(paths)):
        raise ValueError("engine stage spec input_paths contains duplicates")
    for item in paths:
        _safe_relative(item, "engine stage spec input path")
        _locked_binding(job, item)

    block = spec.get("block")
    if not isinstance(block, dict):
        raise ValueError("engine stage spec block mapping missing")
    declared_block = block.get("block_id")
    if not isinstance(declared_block, str) or not SAFE_ID.fullmatch(declared_block):
        raise ValueError("engine stage spec block_id invalid")
    if block_id is not None and declared_block != block_id:
        raise ValueError(f"resource block id drift: requested={block_id!r} declared={declared_block!r}")
    if block.get("kind") not in set(policy.get("engine_block_kinds") or []):
        raise ValueError("engine stage spec block kind invalid")
    if block.get("required") is not True:
        raise ValueError("engine stage spec target block must be required=true")
    command = block.get("command")
    if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
        raise ValueError("engine stage spec block.command must be a non-empty argv list")
    allowed = set(policy.get("command_placeholders") or [])
    fields: set[str] = set()
    for token in command:
        for _literal, field, _format_spec, _conversion in string.Formatter().parse(token):
            if field is not None:
                fields.add(field)
    unknown = sorted(fields - allowed)
    if unknown:
        raise ValueError("engine stage spec command placeholders invalid: " + ", ".join(unknown))
    outputs = block.get("expected_outputs")
    if not isinstance(outputs, list) or not outputs:
        raise ValueError("engine stage spec expected_outputs must be non-empty")
    for index, output in enumerate(outputs):
        _safe_relative(output, f"expected_outputs[{index}]")
    if len(outputs) != len(set(outputs)):
        raise ValueError("engine stage spec expected_outputs contains duplicates")
    return spec, binding


def _engine_job(root: Path, job: dict[str, Any], stage: str, spec: dict[str, Any]) -> dict[str, Any]:
    policy = _stage_policy(root)
    target = dict(spec["block"])
    target["state"] = policy.get("engine_pending_state", "PENDING_BUILD")
    value: dict[str, Any] = {
        "version": 1,
        "job_id": str(job.get("job_id") or ""),
        "stage": stage,
        "privacy": spec.get("privacy"),
        "blocks": [],
    }
    if not SAFE_ID.fullmatch(value["job_id"]):
        raise ValueError("Artifact job_id is not compatible with Engine safe-id rules")

    if stage == "composition":
        kinds = spec.get("prerequisite_kinds") or {}
        blocks = job.get("blocks") or []
        expected_ids = [str(item.get("block_id")) for item in blocks if isinstance(item, dict)]
        if not isinstance(kinds, dict) or set(kinds) != set(expected_ids):
            raise ValueError("composition prerequisite_kinds must exactly cover accepted block ids")
        for index, item in enumerate(blocks):
            if not isinstance(item, dict) or item.get("state") != "REVIEW_PASS":
                raise ValueError(f"composition requires every block REVIEW_PASS: blocks[{index}]")
            artifact = item.get("artifact_binding") or {}
            digest = artifact.get("sha256")
            if not isinstance(digest, str) or not SHA256.fullmatch(digest):
                raise ValueError(f"accepted block artifact hash invalid: {item.get('block_id')}")
            kind = kinds.get(item.get("block_id"))
            if kind not in set(policy.get("engine_block_kinds") or []):
                raise ValueError(f"composition prerequisite kind invalid: {item.get('block_id')}")
            value["blocks"].append({
                "block_id": item.get("block_id"),
                "kind": kind,
                "required": True,
                "state": "REVIEW_PASS",
                "accepted_sha256": digest,
            })
        value["composition_requires"] = expected_ids
    elif stage == "final":
        value["final_requires"] = []
    elif spec.get("prerequisite_kinds"):
        raise ValueError("resource stage must not declare prerequisite_kinds")

    if any(item.get("block_id") == target.get("block_id") for item in value["blocks"]):
        raise ValueError("target Engine block duplicates prerequisite block id")
    value["blocks"].append(target)
    return value


def _handoff_layout(root: Path, job_id: str) -> dict[str, str]:
    contract = load_yaml(root / HANDOFF_CONTRACT)
    engine = contract.get("engine")
    handoff = contract.get("handoff")
    if not isinstance(engine, dict) or not isinstance(handoff, dict):
        raise ValueError("engine handoff contract must contain engine and handoff mappings")
    package_template = handoff.get("package")
    manifest_name = handoff.get("manifest")
    transport = engine.get("transport")
    if not isinstance(package_template, str) or package_template.count("<job_id>") != 1:
        raise ValueError("handoff.package must contain exactly one <job_id> placeholder")
    if not isinstance(manifest_name, str) or not manifest_name or "/" in manifest_name or "\\" in manifest_name:
        raise ValueError("handoff.manifest must be a leaf filename")
    if not isinstance(transport, str) or not transport:
        raise ValueError("engine.transport must be a non-empty string")
    package_rel = package_template.replace("<job_id>", job_id)
    package_path = safe_repo_path(root, package_rel)
    return {
        "package_rel": package_rel,
        "package_name": package_path.name,
        "package_dir_rel": package_path.parent.relative_to(root.resolve()).as_posix(),
        "manifest_name": manifest_name,
        "transport": transport,
    }


def _job_path(root: Path, spec: str) -> Path:
    candidate = safe_repo_path(root, spec)
    if candidate.is_file():
        return candidate
    matches: list[Path] = []
    base = root / "production/artifact-jobs"
    for path in sorted(base.rglob("*.yaml")):
        try:
            data = load_yaml(path)
        except Exception:
            continue
        if data.get("job_id") == spec:
            matches.append(path)
    if len(matches) != 1:
        raise ValueError(f"job selector must resolve exactly once: {spec!r}: {len(matches)}")
    return matches[0]


def _require_stage_eligible(root: Path, job: dict[str, Any], stage: str) -> None:
    errors = check_artifact_job.validate(job, root)
    if errors:
        raise ValueError("artifact job is not valid:\n- " + "\n- ".join(errors))
    states = list(load_yaml(root / ARTIFACT_CONTRACT).get("states") or [])
    state = job.get("state")
    if state not in states:
        raise ValueError(f"unknown artifact state: {state!r}")
    required = {
        "resource": "INPUTS_LOCKED",
        "composition": "BLOCKS_ACCEPTED",
        "final": "BUILT",
    }[stage]
    if states.index(state) < states.index(required):
        raise ValueError(f"{stage} package requires {required}+ job, got {state}")


def _repo_local_imports(root: Path, raw: str) -> set[str]:
    path = safe_repo_path(root, raw, must_exist=True)
    if path.suffix.lower() != ".py":
        return set()
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=raw)
    except SyntaxError as exc:
        raise ValueError(f"selected Python dependency has invalid syntax: {raw}: {exc}") from exc

    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            modules.add(node.module)

    found: set[str] = set()
    for module in sorted(modules):
        parts = module.split(".")
        candidates = [
            root / Path(*parts).with_suffix(".py"),
            root / Path(*parts) / "__init__.py",
            root / "tools" / Path(*parts).with_suffix(".py"),
            root / "tools" / Path(*parts) / "__init__.py",
        ]
        for candidate in candidates:
            if candidate.is_file():
                found.add(_repo_rel(root, candidate))
                break
    return found


def _enforce_python_import_closure(root: Path, selected: set[str]) -> None:
    missing: list[str] = []
    for raw in sorted(selected):
        for dependency in sorted(_repo_local_imports(root, raw)):
            if dependency not in selected:
                missing.append(f"{raw} -> {dependency}")
    if missing:
        raise ValueError(
            "stage dependency closure missing repo-local Python imports: "
            + "; ".join(missing)
        )


def _binding_paths(
    root: Path,
    job_path: Path,
    job: dict[str, Any],
    stage: str,
    spec: dict[str, Any],
    spec_binding: dict[str, Any],
) -> list[tuple[str, str]]:
    """Materialize only the exact dependency closure selected by the locked stage spec."""
    entries: dict[str, str] = {}

    def add_binding(binding: Any, label: str) -> None:
        if not isinstance(binding, dict):
            raise ValueError(f"{label} must be a mapping")
        raw = binding.get("path")
        expected = binding.get("sha256")
        kind = binding.get("kind")
        path = safe_repo_path(root, raw, must_exist=True)
        if not path.is_file():
            raise ValueError(f"{label} is not a file: {raw}")
        actual = sha256_file(path)
        if actual != expected:
            raise ValueError(f"{label} hash mismatch: {raw}: declared={expected} actual={actual}")
        previous = entries.get(str(raw))
        if previous is not None and previous != str(kind):
            raise ValueError(f"dependency role conflict for {raw}: {previous} vs {kind}")
        entries[str(raw)] = str(kind)

    def add_locked_path(raw: str, label: str) -> None:
        add_binding(_locked_binding(job, raw), label)

    def add_block_artifact(block: Any, label: str) -> None:
        if not isinstance(block, dict):
            raise ValueError(f"{label} must be a mapping")
        artifact = block.get("artifact_binding")
        add_binding(artifact, f"{label}.artifact_binding")
        artifact_path = safe_repo_path(root, artifact.get("path"), must_exist=True)
        artifact_manifest = load_yaml(artifact_path)
        bindings = artifact_manifest.get("bindings")
        if not isinstance(bindings, list) or not bindings:
            raise ValueError(f"{label} artifact manifest must contain non-empty bindings")
        for index, binding in enumerate(bindings):
            add_binding(binding, f"{label}.artifact.bindings[{index}]")
        evidence = block.get("evidence_binding")
        if evidence is not None:
            add_binding(evidence, f"{label}.evidence_binding")

    blocks = job.get("blocks") or []
    if not isinstance(blocks, list):
        raise ValueError("job.blocks must be a list")

    input_paths = list(spec.get("input_paths") or [])
    if stage == "resource":
        if not input_paths:
            raise ValueError("resource stage requires locked input_paths")
        for raw in input_paths:
            add_locked_path(raw, f"resource.input_paths[{raw}]")
    elif stage == "composition":
        if not blocks:
            raise ValueError("composition stage requires accepted job.blocks")
        for index, block in enumerate(blocks):
            if not isinstance(block, dict) or block.get("state") != "REVIEW_PASS":
                raise ValueError(f"composition requires every block REVIEW_PASS: blocks[{index}]")
            add_block_artifact(block, f"blocks[{index}]")
        provenance = job.get("build_provenance")
        if not isinstance(provenance, dict):
            raise ValueError("build_provenance must be a mapping")
        for key in ("module_contract_binding", "builder_binding"):
            add_binding(provenance.get(key), f"build_provenance.{key}")
        for raw in input_paths:
            add_locked_path(raw, f"composition.input_paths[{raw}]")
    elif stage == "final":
        outputs = job.get("outputs")
        if not isinstance(outputs, list) or not outputs:
            raise ValueError("final stage requires non-empty job.outputs")
        for index, binding in enumerate(outputs):
            add_binding(binding, f"outputs[{index}]")
        for raw in input_paths:
            add_locked_path(raw, f"final.input_paths[{raw}]")
    else:
        raise ValueError(f"unsupported stage: {stage}")

    add_binding(spec_binding, "engine_stage_spec")

    # Audit records travel with the handoff, but cannot replace locked execution inputs.
    entries[_repo_rel(root, job_path)] = "artifact_job"
    ledger_raw = job.get("execution_ledger")
    ledger_path = safe_repo_path(root, ledger_raw, must_exist=True)
    if not ledger_path.is_file():
        raise ValueError(f"execution ledger is not a file: {ledger_raw}")
    entries[str(ledger_raw)] = "execution_ledger"

    _enforce_python_import_closure(root, set(entries))
    return sorted(entries.items())


def _manifest(
    root: Path,
    job_path: Path,
    job: dict[str, Any],
    stage: str,
    spec: dict[str, Any],
    spec_binding: dict[str, Any],
    transport: str,
    engine_job_name: str,
    engine_job_bytes: bytes,
) -> dict[str, Any]:
    files = []
    for raw, kind in _binding_paths(root, job_path, job, stage, spec, spec_binding):
        path = safe_repo_path(root, raw, must_exist=True)
        files.append(
            {
                "path": raw,
                "archive_path": _safe_relative(f"repo/{raw}", "archive_path"),
                "kind": kind,
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
            }
        )
    return {
        "version": 1,
        "schema": PACKAGE_SCHEMA,
        "job_id": job.get("job_id"),
        "module_id": job.get("module_id"),
        "source_state": job.get("state"),
        "stage_scope": stage,
        "block_id": spec["block"]["block_id"],
        "stage_spec": {
            "path": spec_binding.get("path"),
            "sha256": spec_binding.get("sha256"),
        },
        "engine_job": {
            "path": engine_job_name,
            "sha256": hashlib.sha256(engine_job_bytes).hexdigest(),
            "size": len(engine_job_bytes),
        },
        "transport": {
            "mode": transport,
            "engine_privacy": spec.get("privacy"),
            "public_artifact_forbidden": spec.get("privacy") != "public",
            "public_repository_commit_forbidden": spec.get("privacy") != "public",
        },
        "files": files,
    }


def _yaml_bytes(value: Any) -> bytes:
    return yaml.safe_dump(
        value,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).encode("utf-8")


def _manifest_bytes(manifest: dict[str, Any]) -> bytes:
    # JSON is the handoff-contract authority format. Compact canonical encoding
    # keeps the sidecar and embedded manifest byte-identical and deterministic.
    text = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ) + "\n"
    return text.encode("utf-8")


def _zipinfo(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    return info


def build_package(
    root: Path,
    job_spec: str,
    out_dir: Path | None,
    stage: str,
    block_id: str | None,
    stage_spec: str,
) -> tuple[Path, Path]:
    root = root.resolve()
    job_path = _job_path(root, job_spec)
    job = load_yaml(job_path)
    _require_stage_eligible(root, job, stage)
    spec, spec_binding = _load_stage_spec(
        root,
        job,
        stage_spec,
        stage=stage,
        block_id=block_id,
    )

    job_id = str(job.get("job_id") or "")
    if not SAFE_ID.fullmatch(job_id):
        raise ValueError("job_id must satisfy public Engine safe-id rules")
    layout = _handoff_layout(root, job_id)
    policy = _stage_policy(root)
    engine_job_name = _safe_relative(
        policy.get("engine_job_filename"),
        "engine_stage_spec.engine_job_filename",
    )
    if "/" in engine_job_name:
        raise ValueError("Engine job filename must be a package-root leaf")

    engine_job = _engine_job(root, job, stage, spec)
    engine_job_bytes = _yaml_bytes(engine_job)
    manifest = _manifest(
        root,
        job_path,
        job,
        stage,
        spec,
        spec_binding,
        layout["transport"],
        engine_job_name,
        engine_job_bytes,
    )

    output_dir = (
        out_dir.resolve()
        if out_dir is not None
        else safe_repo_path(root, layout["package_dir_rel"])
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    zip_path = output_dir / layout["package_name"]
    manifest_path = output_dir / layout["manifest_name"]

    mbytes = _manifest_bytes(manifest)
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr(_zipinfo(layout["manifest_name"]), mbytes)
        zf.writestr(_zipinfo(engine_job_name), engine_job_bytes)
        for item in manifest["files"]:
            source = safe_repo_path(root, item["path"], must_exist=True)
            zf.writestr(_zipinfo(item["archive_path"]), source.read_bytes())

    manifest_path.write_bytes(mbytes)
    verify_package(zip_path, manifest_name=layout["manifest_name"])
    return zip_path, manifest_path


def verify_package(zip_path: Path, *, manifest_name: str = "manifest.json") -> dict[str, Any]:
    manifest_name = _safe_relative(manifest_name, "manifest_name")
    with zipfile.ZipFile(zip_path, "r") as zf:
        infos = zf.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            duplicates = sorted({name for name in names if names.count(name) > 1})
            raise ValueError(
                "package contains duplicate archive members: " + ", ".join(duplicates)
            )
        for name in names:
            _safe_relative(name, "archive member")

        if names.count(manifest_name) != 1:
            raise ValueError("package must contain exactly one embedded manifest")
        manifest = json.loads(zf.read(manifest_name).decode("utf-8"))
        if not isinstance(manifest, dict) or manifest.get("schema") != PACKAGE_SCHEMA:
            raise ValueError("package manifest schema mismatch")
        stage = manifest.get("stage_scope")
        if stage not in STAGES:
            raise ValueError(f"package manifest stage_scope invalid: {stage!r}")
        block_id = manifest.get("block_id")
        if not isinstance(block_id, str) or not SAFE_ID.fullmatch(block_id):
            raise ValueError("package manifest block_id invalid")

        engine_item = manifest.get("engine_job")
        if not isinstance(engine_item, dict):
            raise ValueError("package manifest engine_job mapping missing")
        engine_name = _safe_relative(engine_item.get("path"), "engine_job.path")
        if "/" in engine_name:
            raise ValueError("engine_job.path must be a package-root leaf")
        try:
            engine_bytes = zf.read(engine_name)
        except KeyError as exc:
            raise ValueError(f"package missing Engine job: {engine_name}") from exc
        engine_digest = hashlib.sha256(engine_bytes).hexdigest()
        if engine_digest != engine_item.get("sha256"):
            raise ValueError(
                f"Engine job hash mismatch: declared={engine_item.get('sha256')} actual={engine_digest}"
            )
        if len(engine_bytes) != engine_item.get("size"):
            raise ValueError("Engine job size mismatch")
        engine_job = yaml.safe_load(engine_bytes.decode("utf-8")) or {}
        if not isinstance(engine_job, dict):
            raise ValueError("Engine job is not a mapping")
        if engine_job.get("job_id") != manifest.get("job_id"):
            raise ValueError("Engine job job_id drift")
        if engine_job.get("stage") != stage:
            raise ValueError("Engine job stage drift")
        engine_blocks = engine_job.get("blocks") or []
        if not isinstance(engine_blocks, list) or not any(
            isinstance(item, dict) and item.get("block_id") == block_id
            for item in engine_blocks
        ):
            raise ValueError("Engine job target block missing")

        files = manifest.get("files")
        if not isinstance(files, list) or not files:
            raise ValueError("package manifest files must be a non-empty list")
        expected_names = {manifest_name, engine_name}
        seen_paths: set[str] = set()
        for index, item in enumerate(files):
            if not isinstance(item, dict):
                raise ValueError(f"manifest files[{index}] must be a mapping")
            archive_path = _safe_relative(
                item.get("archive_path"),
                f"manifest files[{index}].archive_path",
            )
            if not archive_path.startswith("repo/"):
                raise ValueError(
                    f"manifest dependency must live under repo/: {archive_path}"
                )
            digest = item.get("sha256")
            size = item.get("size")
            if archive_path in seen_paths:
                raise ValueError(f"duplicate manifest archive path: {archive_path}")
            seen_paths.add(archive_path)
            expected_names.add(archive_path)
            try:
                payload = zf.read(archive_path)
            except KeyError as exc:
                raise ValueError(
                    f"package missing manifest item: {archive_path}"
                ) from exc
            actual = hashlib.sha256(payload).hexdigest()
            if actual != digest:
                raise ValueError(
                    f"package hash mismatch: {archive_path}: declared={digest} actual={actual}"
                )
            if len(payload) != size:
                raise ValueError(
                    f"package size mismatch: {archive_path}: declared={size} actual={len(payload)}"
                )

        if set(names) != expected_names or len(names) != len(expected_names):
            extra = sorted(set(names) - expected_names)
            missing = sorted(expected_names - set(names))
            raise ValueError(
                f"package entry set mismatch: missing={missing} extra={extra}"
            )
        return manifest


def selftest() -> None:
    """Verifier-only tests: determinism plus archive/hash fail-closed cases."""
    payload = b"synthetic-stage-input\n"
    engine_job = {
        "version": 1,
        "job_id": "synthetic",
        "stage": "resource",
        "privacy": "public",
        "blocks": [
            {
                "block_id": "synthetic-block",
                "kind": "asset",
                "required": True,
                "state": "PENDING_BUILD",
                "command": ["python", "repo/build.py", "{output_dir}/out.txt"],
                "expected_outputs": ["out.txt"],
            }
        ],
    }
    engine_bytes = _yaml_bytes(engine_job)
    manifest = {
        "version": 1,
        "schema": PACKAGE_SCHEMA,
        "job_id": "synthetic",
        "module_id": "synthetic",
        "source_state": "INPUTS_LOCKED",
        "stage_scope": "resource",
        "block_id": "synthetic-block",
        "stage_spec": {"path": "stage.yaml", "sha256": "a" * 64},
        "engine_job": {
            "path": "resource-job.yaml",
            "sha256": hashlib.sha256(engine_bytes).hexdigest(),
            "size": len(engine_bytes),
        },
        "transport": {
            "mode": "chatgpt-session-mediated",
            "engine_privacy": "public",
            "public_artifact_forbidden": False,
            "public_repository_commit_forbidden": False,
        },
        "files": [
            {
                "path": "input.txt",
                "archive_path": "repo/input.txt",
                "kind": "source",
                "sha256": hashlib.sha256(payload).hexdigest(),
                "size": len(payload),
            }
        ],
    }

    def write_zip(
        path: Path,
        *,
        include_payload: bool = True,
        payload_bytes: bytes = payload,
        extra_name: str | None = None,
        duplicate_payload: bool = False,
        engine_bytes_override: bytes | None = None,
    ) -> None:
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr(_zipinfo("manifest.json"), _manifest_bytes(manifest))
            zf.writestr(
                _zipinfo("resource-job.yaml"),
                engine_bytes if engine_bytes_override is None else engine_bytes_override,
            )
            if include_payload:
                zf.writestr(_zipinfo("repo/input.txt"), payload_bytes)
            if duplicate_payload:
                zf.writestr(_zipinfo("repo/input.txt"), payload)
            if extra_name is not None:
                info = zipfile.ZipInfo(extra_name, FIXED_ZIP_TIME)
                zf.writestr(info, b"undeclared\n")

    def expect_fail(path: Path, needle: str) -> None:
        try:
            verify_package(path, manifest_name="manifest.json")
        except ValueError as exc:
            if needle not in str(exc):
                raise AssertionError(
                    f"{path.name}: expected {needle!r}, got {exc!r}"
                ) from exc
        else:
            raise AssertionError(f"negative package escaped verification: {path.name}")

    with tempfile.TemporaryDirectory(prefix="qz-build-packager-") as tmp:
        tmp_path = Path(tmp)
        good_a = tmp_path / "good-a.zip"
        good_b = tmp_path / "good-b.zip"
        write_zip(good_a)
        write_zip(good_b)
        verify_package(good_a, manifest_name="manifest.json")
        verify_package(good_b, manifest_name="manifest.json")
        if good_a.read_bytes() != good_b.read_bytes():
            raise AssertionError(
                "deterministic package bytes differ for identical inputs"
            )

        missing = tmp_path / "missing.zip"
        write_zip(missing, include_payload=False)
        expect_fail(missing, "missing manifest item")

        tampered = tmp_path / "tampered.zip"
        write_zip(tampered, payload_bytes=b"tampered\n")
        expect_fail(tampered, "package hash mismatch")

        bad_engine = tmp_path / "bad-engine.zip"
        write_zip(bad_engine, engine_bytes_override=b"version: 1\n")
        expect_fail(bad_engine, "Engine job hash mismatch")

        duplicate = tmp_path / "duplicate.zip"
        write_zip(duplicate, duplicate_payload=True)
        expect_fail(duplicate, "duplicate archive members")

        traversal = tmp_path / "traversal.zip"
        write_zip(traversal, extra_name="../escape.txt")
        expect_fail(traversal, "safe relative path")

        absolute = tmp_path / "absolute.zip"
        write_zip(absolute, extra_name="/absolute.txt")
        expect_fail(absolute, "safe relative path")

        extra = tmp_path / "extra.zip"
        write_zip(extra, extra_name="repo/undeclared.txt")
        expect_fail(extra, "package entry set mismatch")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_package = sub.add_parser("package")
    p_package.add_argument("job")
    p_package.add_argument("--root", type=Path, default=ROOT)
    p_package.add_argument("--out-dir", type=Path)
    p_package.add_argument("--stage", choices=["resource", "composition", "final"], required=True)
    p_package.add_argument("--block-id")
    p_package.add_argument("--stage-spec", required=True)

    p_verify = sub.add_parser("verify")
    p_verify.add_argument("zip_path", type=Path)
    p_verify.add_argument("--root", type=Path, default=ROOT)

    sub.add_parser("self-test")
    args = parser.parse_args()

    if args.command == "package":
        zpath, mpath = build_package(
            args.root,
            args.job,
            args.out_dir,
            args.stage,
            args.block_id,
            args.stage_spec,
        )
        print(f"BUILD_PACKAGE={zpath}")
        print(f"BUILD_PACKAGE_MANIFEST={mpath}")
        print("PUBLIC_ARTIFACT_FORBIDDEN")
        return 0
    if args.command == "verify":
        verify_contract = load_yaml(args.root.resolve() / HANDOFF_CONTRACT)
        verify_handoff = verify_contract.get("handoff") or {}
        manifest_name = verify_handoff.get("manifest")
        if not isinstance(manifest_name, str) or not manifest_name:
            raise ValueError("handoff.manifest missing from authority contract")
        manifest = verify_package(args.zip_path, manifest_name=manifest_name)
        print(f"PASS: package verified job_id={manifest.get('job_id')} files={len(manifest.get('files') or [])}")
        return 0
    selftest()
    print("SELFTEST OK: build packager")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
