#!/usr/bin/env python3
"""Limited session-mediated Engine handoff orchestrator.

P2c deliberately does not implement a generic binary uploader or remote dispatch.
It composes existing authorities:

- contracts/engine-handoff.yaml: single immutable Engine anchor
- tools/build_packager.py: deterministic stage-scoped package
- public Engine block-evidence.json: MACHINE result
- tools/manage_artifact_job.py: the only Artifact lifecycle mutation operator

This bridge may prepare an execution request and verify an actual returned result.
It never invents REVIEW_PASS, HUMAN acceptance, or publication.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tempfile
from typing import Any

import yaml

from artifact_foundation import ROOT, load_yaml, safe_repo_path, sha256_file
import build_packager
import check_artifact_job
import check_engine_handoff

REQUEST_SCHEMA = "qiuzhidaren-engine-handoff-request-v1"
RECEIPT_SCHEMA = "qiuzhidaren-engine-execution-receipt-v1"
VERIFIED_SCHEMA = "qiuzhidaren-engine-result-verification-v1"
REVIEW_SCHEMA = "qiuzhidaren-engine-review-pack-v1"
HANDOFF_CONTRACT = Path("contracts/engine-handoff.yaml")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")


def _json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_json_bytes(value))


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected JSON object")
    return value


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_leaf(raw: Any, label: str) -> str:
    if not isinstance(raw, str) or not raw or "\\" in raw or raw.startswith("/"):
        raise ValueError(f"{label} must be a safe leaf filename")
    pure = PurePosixPath(raw)
    if pure.is_absolute() or len(pure.parts) != 1 or pure.parts[0] in {"", ".", ".."}:
        raise ValueError(f"{label} must be a safe leaf filename")
    return pure.as_posix()


def _safe_relative(raw: Any, label: str) -> str:
    if not isinstance(raw, str) or not raw or "\\" in raw or raw.startswith("/"):
        raise ValueError(f"{label} must be a safe relative path")
    pure = PurePosixPath(raw)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError(f"{label} must be a safe relative path")
    return pure.as_posix()


def _engine_contract(root: Path, *, strict: bool) -> dict[str, Any]:
    errors = check_engine_handoff.validate(root, strict=strict)
    if errors:
        raise ValueError("engine handoff contract rejected: " + " | ".join(errors))
    contract = load_yaml(root / HANDOFF_CONTRACT)
    engine = contract.get("engine")
    handoff = contract.get("handoff")
    if not isinstance(engine, dict) or not isinstance(handoff, dict):
        raise ValueError("engine handoff contract must contain engine and handoff mappings")
    repository = engine.get("repository")
    commit = engine.get("commit")
    ref = engine.get("ref")
    if (
        not isinstance(repository, str)
        or not isinstance(commit, str)
        or not SHA40.fullmatch(commit)
        or ref != commit
    ):
        raise ValueError("engine handoff contract immutable commit pin is invalid")
    return contract


def _explicit_job(root: Path, raw: str) -> tuple[Path, dict[str, Any]]:
    path = safe_repo_path(root, raw, must_exist=True)
    if not path.is_file():
        raise ValueError(f"explicit Artifact Job is not a file: {raw}")
    job = load_yaml(path)
    errors = check_artifact_job.validate(job, root)
    if errors:
        raise ValueError("Artifact Job rejected: " + " | ".join(errors))
    return path, job


def _request_path(zip_path: Path, handoff: dict[str, Any]) -> Path:
    name = handoff.get("request") or "handoff-request.json"
    return zip_path.parent / _safe_leaf(name, "handoff.request")


def prepare(
    root: Path,
    *,
    job_raw: str,
    stage: str,
    stage_spec: str,
    block_id: str | None,
    out_dir: Path | None,
    strict_engine: bool,
) -> tuple[Path, Path, Path]:
    root = root.resolve()
    _job_path, job = _explicit_job(root, job_raw)
    contract = _engine_contract(root, strict=strict_engine)
    engine = contract["engine"]
    handoff = contract["handoff"]

    zip_path, manifest_path = build_packager.build_package(
        root,
        job_raw,
        out_dir,
        stage,
        block_id,
        stage_spec,
    )
    manifest = build_packager.verify_package(
        zip_path,
        manifest_name=str(handoff.get("manifest") or "manifest.json"),
    )
    package_hash = sha256_file(zip_path)
    manifest_hash = sha256_file(manifest_path)
    engine_job = manifest.get("engine_job") or {}

    request = {
        "version": 1,
        "schema": REQUEST_SCHEMA,
        "status": "PENDING_ENGINE_EXECUTION",
        "job_id": manifest.get("job_id"),
        "module_id": manifest.get("module_id"),
        "artifact_state": job.get("state"),
        "stage": manifest.get("stage_scope"),
        "block_id": manifest.get("block_id"),
        "stage_spec": manifest.get("stage_spec"),
        "engine": {
            "repository": engine.get("repository"),
            "commit": engine.get("commit"),
            "cli_contract": engine.get("cli_contract"),
            "cli_contract_sha256": engine.get("cli_contract_sha256"),
        },
        "transport": manifest.get("transport"),
        "package": {
            "file": zip_path.name,
            "sha256": package_hash,
            "size": zip_path.stat().st_size,
            "manifest_file": manifest_path.name,
            "manifest_sha256": manifest_hash,
            "engine_job_sha256": engine_job.get("sha256"),
        },
        "dispatch": {
            "performed": False,
            "generic_binary_dispatch_assumed": False,
            "reason": "APPROVED_SESSION_TRANSPORT_REQUIRED",
        },
        "authority": {
            "artifact_operator": "tools/manage_artifact_job.py",
            "engine_anchor": HANDOFF_CONTRACT.as_posix(),
        },
        "automatic_review_pass": False,
        "automatic_human_acceptance": False,
        "automatic_publication": False,
    }
    request_path = _request_path(zip_path, handoff)
    _write_json(request_path, request)
    return zip_path, manifest_path, request_path


def _validate_request(request: dict[str, Any]) -> None:
    if request.get("version") != 1 or request.get("schema") != REQUEST_SCHEMA:
        raise ValueError("handoff request schema/version mismatch")
    if request.get("status") != "PENDING_ENGINE_EXECUTION":
        raise ValueError("handoff request must be PENDING_ENGINE_EXECUTION")
    for key in ("job_id", "stage", "block_id"):
        value = request.get(key)
        if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
            raise ValueError(f"handoff request {key} invalid")
    engine = request.get("engine")
    if not isinstance(engine, dict):
        raise ValueError("handoff request engine mapping missing")
    if not isinstance(engine.get("repository"), str):
        raise ValueError("handoff request engine.repository missing")
    if not isinstance(engine.get("commit"), str) or not SHA40.fullmatch(engine["commit"]):
        raise ValueError("handoff request engine.commit invalid")
    package = request.get("package")
    if not isinstance(package, dict):
        raise ValueError("handoff request package mapping missing")
    _safe_leaf(package.get("file"), "request.package.file")
    _safe_leaf(package.get("manifest_file"), "request.package.manifest_file")
    for key in ("sha256", "manifest_sha256", "engine_job_sha256"):
        if not isinstance(package.get(key), str) or not SHA256.fullmatch(package[key]):
            raise ValueError(f"handoff request package.{key} invalid")
    if not isinstance(package.get("size"), int) or package["size"] <= 0:
        raise ValueError("handoff request package.size invalid")
    dispatch = request.get("dispatch")
    if not isinstance(dispatch, dict) or dispatch.get("performed") is not False:
        raise ValueError("handoff request may not claim dispatch before execution")


def _output_records(evidence: dict[str, Any], result_dir: Path) -> list[dict[str, Any]]:
    outputs = evidence.get("outputs")
    if not isinstance(outputs, list) or not outputs:
        raise ValueError("Engine block evidence outputs must be a non-empty list")
    records: list[dict[str, Any]] = []
    names: set[str] = set()
    for index, item in enumerate(outputs):
        if not isinstance(item, dict):
            raise ValueError(f"Engine output[{index}] must be a mapping")
        filename = _safe_leaf(item.get("filename"), f"Engine output[{index}].filename")
        if filename in names:
            raise ValueError(f"duplicate Engine output filename: {filename}")
        names.add(filename)
        declared_hash = item.get("sha256")
        declared_size = item.get("size_bytes")
        if not isinstance(declared_hash, str) or not SHA256.fullmatch(declared_hash):
            raise ValueError(f"Engine output[{index}].sha256 invalid")
        if not isinstance(declared_size, int) or declared_size <= 0:
            raise ValueError(f"Engine output[{index}].size_bytes invalid")
        path = (result_dir / filename).resolve()
        if result_dir.resolve() != path.parent:
            raise ValueError(f"Engine output path escaped result dir: {filename}")
        if not path.is_file():
            raise ValueError(f"Engine output missing: {filename}")
        actual_hash = sha256_file(path)
        actual_size = path.stat().st_size
        if actual_hash != declared_hash:
            raise ValueError(
                f"Engine output hash mismatch: {filename}: declared={declared_hash} actual={actual_hash}"
            )
        if actual_size != declared_size:
            raise ValueError(
                f"Engine output size mismatch: {filename}: declared={declared_size} actual={actual_size}"
            )
        record = {
            "filename": filename,
            "sha256": actual_hash,
            "size_bytes": actual_size,
            "media_type": item.get("media_type"),
        }
        if item.get("media_type") == "application/pdf":
            if not isinstance(item.get("pdf_qa"), dict):
                raise ValueError(f"PDF Engine output lacks pdf_qa: {filename}")
            record["pdf_qa"] = item["pdf_qa"]
        records.append(record)
    return records


def _validate_engine_evidence(
    request: dict[str, Any],
    evidence: dict[str, Any],
    result_dir: Path,
) -> list[dict[str, Any]]:
    if evidence.get("engine") != "PDF-Production-Engine":
        raise ValueError("Engine block evidence engine identity mismatch")
    for key in ("job_id", "stage", "block_id"):
        if evidence.get(key) != request.get(key):
            raise ValueError(
                f"Engine block evidence {key} mismatch: request={request.get(key)!r} "
                f"evidence={evidence.get(key)!r}"
            )
    if evidence.get("status") != "MACHINE_PASS":
        raise ValueError("Engine block evidence must be MACHINE_PASS")
    if evidence.get("review_status") != "REVIEW_REQUIRED":
        raise ValueError("Engine block evidence must remain REVIEW_REQUIRED")
    return _output_records(evidence, result_dir)


def make_receipt(
    *,
    request_path: Path,
    package_path: Path,
    evidence_path: Path,
    result_dir: Path,
    engine_repository: str,
    engine_commit: str,
    out_path: Path,
) -> Path:
    request = _read_json(request_path)
    _validate_request(request)
    evidence = _read_json(evidence_path)
    outputs = _validate_engine_evidence(request, evidence, result_dir.resolve())

    expected_engine = request["engine"]
    if engine_repository != expected_engine["repository"]:
        raise ValueError("execution Engine repository does not match request")
    if engine_commit != expected_engine["commit"]:
        raise ValueError("execution Engine commit does not match pinned request commit")
    if not SHA40.fullmatch(engine_commit):
        raise ValueError("execution Engine commit must be full 40-hex")

    package = request["package"]
    if package_path.name != package["file"]:
        raise ValueError("executed package filename does not match request")
    actual_package_hash = sha256_file(package_path)
    if actual_package_hash != package["sha256"]:
        raise ValueError("executed package hash does not match request")
    if package_path.stat().st_size != package["size"]:
        raise ValueError("executed package size does not match request")

    receipt = {
        "version": 1,
        "schema": RECEIPT_SCHEMA,
        "status": "ENGINE_MACHINE_RESULT_RECORDED",
        "engine": {
            "repository": engine_repository,
            "commit": engine_commit,
        },
        "job_id": request["job_id"],
        "stage": request["stage"],
        "block_id": request["block_id"],
        "request_sha256": sha256_file(request_path),
        "package_sha256": actual_package_hash,
        "package_manifest_sha256": package["manifest_sha256"],
        "engine_job_sha256": package["engine_job_sha256"],
        "block_evidence_sha256": sha256_file(evidence_path),
        "outputs": outputs,
        "machine_status": "MACHINE_PASS",
        "review_status": "REVIEW_REQUIRED",
        "human_acceptance": "NOT_CLAIMED",
        "publication": "NOT_CLAIMED",
    }
    _write_json(out_path, receipt)
    return out_path


def _validate_receipt(
    request_path: Path,
    request: dict[str, Any],
    receipt: dict[str, Any],
    evidence_path: Path,
    evidence: dict[str, Any],
    result_dir: Path,
) -> list[dict[str, Any]]:
    if receipt.get("version") != 1 or receipt.get("schema") != RECEIPT_SCHEMA:
        raise ValueError("execution receipt schema/version mismatch")
    if receipt.get("status") != "ENGINE_MACHINE_RESULT_RECORDED":
        raise ValueError("execution receipt status invalid")
    if receipt.get("request_sha256") != sha256_file(request_path):
        raise ValueError("execution receipt request hash mismatch")
    engine = receipt.get("engine")
    if not isinstance(engine, dict) or engine != {
        "repository": request["engine"]["repository"],
        "commit": request["engine"]["commit"],
    }:
        raise ValueError("execution receipt Engine anchor mismatch")
    for key in ("job_id", "stage", "block_id"):
        if receipt.get(key) != request.get(key):
            raise ValueError(f"execution receipt {key} mismatch")
    package = request["package"]
    if receipt.get("package_sha256") != package["sha256"]:
        raise ValueError("execution receipt package hash mismatch")
    if receipt.get("package_manifest_sha256") != package["manifest_sha256"]:
        raise ValueError("execution receipt manifest hash mismatch")
    if receipt.get("engine_job_sha256") != package["engine_job_sha256"]:
        raise ValueError("execution receipt Engine job hash mismatch")
    if receipt.get("block_evidence_sha256") != sha256_file(evidence_path):
        raise ValueError("execution receipt block evidence hash mismatch")
    if receipt.get("machine_status") != "MACHINE_PASS":
        raise ValueError("execution receipt machine_status must be MACHINE_PASS")
    if receipt.get("review_status") != "REVIEW_REQUIRED":
        raise ValueError("execution receipt review_status must be REVIEW_REQUIRED")
    if receipt.get("human_acceptance") != "NOT_CLAIMED":
        raise ValueError("execution receipt may not claim HUMAN acceptance")
    if receipt.get("publication") != "NOT_CLAIMED":
        raise ValueError("execution receipt may not claim publication")

    outputs = _validate_engine_evidence(request, evidence, result_dir.resolve())
    if receipt.get("outputs") != outputs:
        raise ValueError("execution receipt output identity mismatch")
    return outputs


def verify_result(
    root: Path,
    *,
    request_raw: str,
    receipt_raw: str,
    evidence_raw: str,
    result_dir_raw: str,
    out_dir_raw: str,
) -> tuple[Path, Path]:
    root = root.resolve()
    request_path = safe_repo_path(root, request_raw, must_exist=True)
    receipt_path = safe_repo_path(root, receipt_raw, must_exist=True)
    evidence_path = safe_repo_path(root, evidence_raw, must_exist=True)
    result_dir = safe_repo_path(root, result_dir_raw, must_exist=True)
    if not result_dir.is_dir():
        raise ValueError("result-dir must be a repository directory")
    out_dir = safe_repo_path(root, out_dir_raw)
    out_dir.mkdir(parents=True, exist_ok=True)

    request = _read_json(request_path)
    _validate_request(request)
    receipt = _read_json(receipt_path)
    evidence = _read_json(evidence_path)
    outputs = _validate_receipt(
        request_path,
        request,
        receipt,
        evidence_path,
        evidence,
        result_dir,
    )

    package_path = request_path.parent / request["package"]["file"]
    if not package_path.is_file():
        raise ValueError("original handoff package is missing beside request")
    if sha256_file(package_path) != request["package"]["sha256"]:
        raise ValueError("original handoff package hash drift")
    if package_path.stat().st_size != request["package"]["size"]:
        raise ValueError("original handoff package size drift")

    verified = {
        "version": 1,
        "schema": VERIFIED_SCHEMA,
        "status": "VERIFIED_MACHINE_RESULT",
        "job_id": request["job_id"],
        "stage": request["stage"],
        "block_id": request["block_id"],
        "engine": request["engine"],
        "request_sha256": sha256_file(request_path),
        "receipt_sha256": sha256_file(receipt_path),
        "package_sha256": request["package"]["sha256"],
        "block_evidence_sha256": sha256_file(evidence_path),
        "outputs": outputs,
        "machine_status": "MACHINE_PASS",
        "review_status": "REVIEW_REQUIRED",
        "automatic_review_pass": False,
        "automatic_human_acceptance": False,
        "automatic_publication": False,
    }
    verified_path = out_dir / "verified-result.json"
    _write_json(verified_path, verified)

    final_stage = request["stage"] == "final"
    review = {
        "version": 1,
        "schema": REVIEW_SCHEMA,
        "status": "WAITING_FOR_HUMAN" if final_stage else "WAITING_FOR_BLOCK_REVIEW",
        "job_id": request["job_id"],
        "stage": request["stage"],
        "block_id": request["block_id"],
        "verified_result_sha256": sha256_file(verified_path),
        "outputs": outputs,
        "review_required": (
            "HUMAN_FULL_PAGE_REVIEW_REQUIRED"
            if final_stage
            else "BLOCK_REVIEW_REQUIRED"
        ),
        "artifact_operator": "tools/manage_artifact_job.py",
        "operator_boundary": {
            "review_pass_must_be_explicit": True,
            "human_accept_must_be_explicit": True,
            "publish_requires_existing_HUMAN_ACCEPTED_state": True,
        },
        "automatic_state_mutation": False,
        "automatic_publication": False,
    }
    review_path = out_dir / "review-pack.json"
    _write_json(review_path, review)
    return verified_path, review_path


def selftest() -> None:
    with tempfile.TemporaryDirectory(prefix="qz-handoff-") as tmp:
        root = Path(tmp)
        result_dir = root / "result"
        result_dir.mkdir()
        payload = b"synthetic engine output\n"
        output = result_dir / "result.txt"
        output.write_bytes(payload)

        package = root / "job.zip"
        package.write_bytes(b"synthetic deterministic package\n")
        manifest = root / "manifest.json"
        manifest.write_bytes(b'{"synthetic":true}\n')

        request = {
            "version": 1,
            "schema": REQUEST_SCHEMA,
            "status": "PENDING_ENGINE_EXECUTION",
            "job_id": "job-1",
            "module_id": "synthetic",
            "artifact_state": "INPUTS_LOCKED",
            "stage": "resource",
            "block_id": "block-1",
            "stage_spec": {"path": "stage.yaml", "sha256": "a" * 64},
            "engine": {
                "repository": "example/public-engine",
                "commit": "b" * 40,
                "cli_contract": "schemas/resource-job-v1.yaml",
                "cli_contract_sha256": "c" * 64,
            },
            "transport": {
                "mode": "chatgpt-session-mediated",
                "engine_privacy": "public",
                "public_artifact_forbidden": False,
                "public_repository_commit_forbidden": False,
            },
            "package": {
                "file": package.name,
                "sha256": sha256_file(package),
                "size": package.stat().st_size,
                "manifest_file": manifest.name,
                "manifest_sha256": sha256_file(manifest),
                "engine_job_sha256": "d" * 64,
            },
            "dispatch": {
                "performed": False,
                "generic_binary_dispatch_assumed": False,
                "reason": "APPROVED_SESSION_TRANSPORT_REQUIRED",
            },
            "authority": {
                "artifact_operator": "tools/manage_artifact_job.py",
                "engine_anchor": HANDOFF_CONTRACT.as_posix(),
            },
            "automatic_review_pass": False,
            "automatic_human_acceptance": False,
            "automatic_publication": False,
        }
        request_path = root / "handoff-request.json"
        _write_json(request_path, request)

        evidence = {
            "engine": "PDF-Production-Engine",
            "job_id": "job-1",
            "stage": "resource",
            "block_id": "block-1",
            "kind": "asset",
            "status": "MACHINE_PASS",
            "review_status": "REVIEW_REQUIRED",
            "outputs": [
                {
                    "filename": "result.txt",
                    "size_bytes": len(payload),
                    "sha256": _sha256_bytes(payload),
                    "media_type": "application/octet-stream",
                }
            ],
        }
        evidence_path = result_dir / "block-evidence.json"
        _write_json(evidence_path, evidence)
        receipt_path = root / "provenance-receipt.json"
        make_receipt(
            request_path=request_path,
            package_path=package,
            evidence_path=evidence_path,
            result_dir=result_dir,
            engine_repository="example/public-engine",
            engine_commit="b" * 40,
            out_path=receipt_path,
        )

        verified_dir = root / "verified"
        verified, review = verify_result(
            root,
            request_raw=request_path.name,
            receipt_raw=receipt_path.name,
            evidence_raw="result/block-evidence.json",
            result_dir_raw="result",
            out_dir_raw="verified",
        )
        if _read_json(verified).get("status") != "VERIFIED_MACHINE_RESULT":
            raise AssertionError("verified result status drift")
        review_doc = _read_json(review)
        if review_doc.get("status") != "WAITING_FOR_BLOCK_REVIEW":
            raise AssertionError("resource result did not pause for block review")
        if review_doc.get("automatic_state_mutation") is not False:
            raise AssertionError("handoff may not mutate Artifact state automatically")
        if review_doc.get("automatic_publication") is not False:
            raise AssertionError("handoff may not publish automatically")

        saved = output.read_bytes()
        output.write_bytes(b"tampered\n")
        try:
            verify_result(
                root,
                request_raw=request_path.name,
                receipt_raw=receipt_path.name,
                evidence_raw="result/block-evidence.json",
                result_dir_raw="result",
                out_dir_raw="tampered-check",
            )
        except ValueError as exc:
            if "hash mismatch" not in str(exc):
                raise
        else:
            raise AssertionError("tampered Engine output escaped verification")
        output.write_bytes(saved)

        try:
            make_receipt(
                request_path=request_path,
                package_path=package,
                evidence_path=evidence_path,
                result_dir=result_dir,
                engine_repository="example/public-engine",
                engine_commit="e" * 40,
                out_path=root / "bad-receipt.json",
            )
        except ValueError as exc:
            if "does not match pinned" not in str(exc):
                raise
        else:
            raise AssertionError("wrong Engine commit escaped receipt gate")

        bad = dict(evidence)
        bad["status"] = "MACHINE_FAIL"
        bad_path = result_dir / "bad-evidence.json"
        _write_json(bad_path, bad)
        try:
            make_receipt(
                request_path=request_path,
                package_path=package,
                evidence_path=bad_path,
                result_dir=result_dir,
                engine_repository="example/public-engine",
                engine_commit="b" * 40,
                out_path=root / "bad-status-receipt.json",
            )
        except ValueError as exc:
            if "MACHINE_PASS" not in str(exc):
                raise
        else:
            raise AssertionError("MACHINE_FAIL escaped handoff receipt gate")

        unsafe = dict(evidence)
        unsafe["outputs"] = [dict(evidence["outputs"][0], filename="../escape.txt")]
        unsafe_path = result_dir / "unsafe-evidence.json"
        _write_json(unsafe_path, unsafe)
        try:
            make_receipt(
                request_path=request_path,
                package_path=package,
                evidence_path=unsafe_path,
                result_dir=result_dir,
                engine_repository="example/public-engine",
                engine_commit="b" * 40,
                out_path=root / "unsafe-receipt.json",
            )
        except ValueError as exc:
            if "safe leaf" not in str(exc):
                raise
        else:
            raise AssertionError("unsafe Engine output path escaped handoff gate")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("prepare")
    p.add_argument("--job", required=True)
    p.add_argument("--stage", choices=["resource", "composition", "final"], required=True)
    p.add_argument("--stage-spec", required=True)
    p.add_argument("--block-id")
    p.add_argument("--out-dir", type=Path)
    p.add_argument("--strict-engine", action="store_true")

    p = sub.add_parser("make-receipt")
    p.add_argument("--request", type=Path, required=True)
    p.add_argument("--package", type=Path, required=True)
    p.add_argument("--evidence", type=Path, required=True)
    p.add_argument("--result-dir", type=Path, required=True)
    p.add_argument("--engine-repository", required=True)
    p.add_argument("--engine-commit", required=True)
    p.add_argument("--out", type=Path, required=True)

    p = sub.add_parser("verify-result")
    p.add_argument("--request", required=True)
    p.add_argument("--receipt", required=True)
    p.add_argument("--evidence", required=True)
    p.add_argument("--result-dir", required=True)
    p.add_argument("--out-dir", required=True)

    sub.add_parser("self-test")
    args = parser.parse_args()
    root = args.root.resolve()

    try:
        if args.command == "prepare":
            out_dir = args.out_dir.resolve() if args.out_dir is not None else None
            zpath, mpath, rpath = prepare(
                root,
                job_raw=args.job,
                stage=args.stage,
                stage_spec=args.stage_spec,
                block_id=args.block_id,
                out_dir=out_dir,
                strict_engine=args.strict_engine,
            )
            print(f"HANDOFF_PACKAGE={zpath}")
            print(f"HANDOFF_MANIFEST={mpath}")
            print(f"HANDOFF_REQUEST={rpath}")
            print("HANDOFF_STATUS=PENDING_ENGINE_EXECUTION")
            print("DISPATCH_PERFORMED=false")
            return 0
        if args.command == "make-receipt":
            path = make_receipt(
                request_path=args.request.resolve(),
                package_path=args.package.resolve(),
                evidence_path=args.evidence.resolve(),
                result_dir=args.result_dir.resolve(),
                engine_repository=args.engine_repository,
                engine_commit=args.engine_commit,
                out_path=args.out.resolve(),
            )
            print(f"ENGINE_RECEIPT={path}")
            print("ENGINE_MACHINE_RESULT_RECORDED")
            print("REVIEW_PASS_NOT_CLAIMED")
            return 0
        if args.command == "verify-result":
            verified, review = verify_result(
                root,
                request_raw=args.request,
                receipt_raw=args.receipt,
                evidence_raw=args.evidence,
                result_dir_raw=args.result_dir,
                out_dir_raw=args.out_dir,
            )
            print(f"VERIFIED_RESULT={verified}")
            print(f"REVIEW_PACK={review}")
            print("AUTOMATIC_STATE_MUTATION=false")
            print("AUTOMATIC_PUBLICATION=false")
            return 0

        selftest()
        print("SELFTEST OK: limited Engine handoff orchestrator")
        return 0
    except Exception as exc:
        print(f"FAIL: handoff orchestrator: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
