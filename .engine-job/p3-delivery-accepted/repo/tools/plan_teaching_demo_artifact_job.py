#!/usr/bin/env python3
"""Canonical Teaching Demo Artifact planner and plan-writer.

This module is the only complete repository capability allowed to form or write a
Teaching Demo Artifact input plan. Accepted Teaching Demo content is validated
inside the complete operation itself before any protected write. Lower-level
planning helpers live in ``teaching_demo_artifact_plan_primitives`` and cannot
independently build or write a complete plan.

RRA5 consumer closure additionally binds the complete accepted-content evidence
capsule (submission freeze, independent review and post-freeze HUMAN receipt),
requires that capsule to carry the same case/source_commit as the Artifact plan,
and fail-closes unless every repository-local Python control dependency is covered
by the plan/snapshot dependency inventory.

Foundation invariant: NO_PRODUCT_PDF_COMPOSITION_PERFORMED.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
from pathlib import Path
import re
import tempfile

import yaml

import check_teaching_demo_content as _content
from check_teaching_demo_case import validate as validate_case
from provenance_snapshot import write_snapshot
import teaching_demo_artifact_plan_primitives as _p

ROOT = _p.ROOT
CONTRACT_PATH = _p.CONTRACT_PATH
REGISTRY_PATH = _p.REGISTRY_PATH
LOCKER_PATH = _p.LOCKER_PATH


def _local_module_path(root: Path, module: str) -> str | None:
    if not module:
        return None
    parts = module.split(".")
    if parts and parts[0] == "tools":
        parts = parts[1:]
    if not parts:
        return None
    base = root / "tools" / Path(*parts)
    for candidate in (base.with_suffix(".py"), base / "__init__.py"):
        if candidate.is_file():
            return candidate.resolve().relative_to(root.resolve()).as_posix()
    return None


def _repo_local_imports(root: Path, raw: str) -> set[str]:
    path = _p.safe_repo_path(root, raw, must_exist=True)
    if path.suffix != ".py" or "tools" not in path.relative_to(root.resolve()).parts:
        return set()
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=raw)
    except SyntaxError as exc:
        raise ValueError(f"Python dependency syntax invalid before planning: {raw}: {exc}") from exc
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            modules.add(node.module)
    out: set[str] = set()
    for module in modules:
        local = _local_module_path(root, module)
        if local:
            out.add(local)
    return out


def _missing_repo_local_imports(root: Path, declared: set[str]) -> list[str]:
    missing: list[str] = []
    for raw in sorted(declared):
        if not raw.startswith("tools/") or not raw.endswith(".py"):
            continue
        for local in sorted(_repo_local_imports(root, raw)):
            if local not in declared:
                missing.append(f"{raw} -> {local}")
    return missing


def _builder_path(root: Path, profile: dict) -> str:
    registry = _p.load_yaml(root / REGISTRY_PATH)
    module = (registry.get("modules") or {}).get(str(profile.get("module_id")))
    adapter = module.get("artifact_adapter") if isinstance(module, dict) else None
    builder = adapter.get("build") if isinstance(adapter, dict) else None
    if not isinstance(builder, str) or not builder:
        raise ValueError("Teaching Demo build adapter missing")
    return builder


def _validate_repository_python_import_closure(root: Path) -> None:
    _contract, profile = _p.load_profile(root)
    dependencies = profile.get("repository_dependencies") or []
    if not isinstance(dependencies, list):
        raise ValueError("repository_dependencies must be a list")

    policy = profile.get("repository_python_import_closure") or {}
    if not isinstance(policy, dict) or policy.get("enabled") is not True:
        raise ValueError("repository_python_import_closure.enabled must be true")
    excluded = policy.get("excluded_dependency_kinds") or []
    if not isinstance(excluded, list) or not all(isinstance(x, str) and x for x in excluded):
        raise ValueError("repository_python_import_closure.excluded_dependency_kinds invalid")
    excluded_kinds = set(excluded)

    runtime_declared: set[str] = set()
    for item in dependencies:
        if not isinstance(item, dict):
            raise ValueError("repository dependency path/kind invalid")
        raw, kind = item.get("path"), item.get("kind")
        if not isinstance(raw, str) or not isinstance(kind, str):
            raise ValueError("repository dependency path/kind invalid")
        if kind not in excluded_kinds:
            runtime_declared.add(raw)

    if policy.get("include_builder") is not True:
        raise ValueError("repository_python_import_closure.include_builder must be true")
    runtime_declared.add(_builder_path(root, profile))

    missing = _missing_repo_local_imports(root, runtime_declared)
    if missing:
        raise ValueError("repository-local Python runtime dependency closure incomplete: " + " | ".join(missing))


def _validate_repository_control_import_closure(root: Path) -> None:
    """Require exact provenance coverage for all repository-local control imports."""
    _contract, profile = _p.load_profile(root)
    dependencies = profile.get("repository_dependencies") or []
    if not isinstance(dependencies, list):
        raise ValueError("repository_dependencies must be a list")
    policy = profile.get("repository_control_import_closure") or {}
    if not isinstance(policy, dict) or policy.get("enabled") is not True:
        raise ValueError("repository_control_import_closure.enabled must be true")
    if policy.get("all_declared_python_dependencies_must_close") is not True:
        raise ValueError("repository_control_import_closure.all_declared_python_dependencies_must_close must be true")
    if policy.get("dynamic_non_python_dependencies_must_be_explicit") is not True:
        raise ValueError("repository_control_import_closure.dynamic_non_python_dependencies_must_be_explicit must be true")
    if policy.get("include_builder") is not True:
        raise ValueError("repository_control_import_closure.include_builder must be true")

    declared: set[str] = set()
    for item in dependencies:
        if not isinstance(item, dict):
            raise ValueError("repository dependency path/kind invalid")
        raw, kind = item.get("path"), item.get("kind")
        if not isinstance(raw, str) or not isinstance(kind, str):
            raise ValueError("repository dependency path/kind invalid")
        declared.add(raw)
    declared.add(_builder_path(root, profile))

    missing = _missing_repo_local_imports(root, declared)
    if missing:
        raise ValueError("repository-local Python control dependency closure incomplete: " + " | ".join(missing))


def dependency_closure_selftest() -> None:
    with tempfile.TemporaryDirectory(prefix="qz-import-closure-") as tmp:
        root = Path(tmp)
        tools = root / "tools"
        tools.mkdir(parents=True)
        (tools / "a.py").write_text("from b import value\nimport yaml\n", encoding="utf-8")
        (tools / "b.py").write_text("value = 1\n", encoding="utf-8")
        if _repo_local_imports(root, "tools/a.py") != {"tools/b.py"}:
            raise AssertionError("repo-local import resolver missed local module")
        missing = _missing_repo_local_imports(root, {"tools/a.py"})
        if missing != ["tools/a.py -> tools/b.py"]:
            raise AssertionError(f"missing dependency regression did not fail closed: {missing}")
        if _missing_repo_local_imports(root, {"tools/a.py", "tools/b.py"}):
            raise AssertionError("closed synthetic runtime dependency graph rejected")

        # The canonical builder is a separately bound closure root. It must be scanned
        # even when it is intentionally absent from repository_dependencies, otherwise
        # its own repo-local imports could execute outside the snapshot provenance set.
        (tools / "builder.py").write_text("from b import value\n", encoding="utf-8")
        (root / "production/contracts").mkdir(parents=True)
        contract_path = root / CONTRACT_PATH
        registry_path = root / REGISTRY_PATH
        profile = {
            "plan_schema_id": "teaching-demo-artifact-input-plan-v1",
            "module_id": "teacher_teaching_demo",
            "planner": "tools/plan_teaching_demo_artifact_job.py",
            "repository_dependencies": [],
            "repository_control_import_closure": {
                "enabled": True,
                "all_declared_python_dependencies_must_close": True,
                "dynamic_non_python_dependencies_must_be_explicit": True,
                "include_builder": True,
            },
        }
        contract_path.write_text(
            yaml.safe_dump({"id": "teacher-trial-two-pdf-v1", "artifact_job_profile": profile}, sort_keys=False),
            encoding="utf-8",
        )
        registry_path.write_text(
            yaml.safe_dump({"modules": {"teacher_teaching_demo": {"artifact_adapter": {"build": "tools/builder.py"}}}}, sort_keys=False),
            encoding="utf-8",
        )
        try:
            _validate_repository_control_import_closure(root)
        except ValueError as exc:
            if "tools/builder.py -> tools/b.py" not in str(exc):
                raise AssertionError(f"builder control closure failed for wrong reason: {exc}") from exc
        else:
            raise AssertionError("separately bound builder repo-local import escaped control closure")
        profile["repository_dependencies"].append({"path": "tools/b.py", "kind": "builder_dependency"})
        contract_path.write_text(
            yaml.safe_dump({"id": "teacher-trial-two-pdf-v1", "artifact_job_profile": profile}, sort_keys=False),
            encoding="utf-8",
        )
        _validate_repository_control_import_closure(root)


def _require_accepted_content(manifest_raw: str, *, root: Path) -> None:
    errors = _content.validate(manifest_raw, root=root, require_independent=True)
    if errors:
        raise ValueError("canonical content is not independently accepted: " + " | ".join(errors))


def _acceptance_capsule(
    root: Path,
    profile: dict,
    workspace: Path,
    manifest: dict,
    source_commit: str,
) -> tuple[list[dict[str, str]], dict[str, dict[str, str]]]:
    """Bind and cross-check the minimal complete post-freeze acceptance chain."""
    policy = profile.get("content_acceptance_capsule")
    if not isinstance(policy, dict) or policy.get("required") is not True:
        raise ValueError("artifact_job_profile.content_acceptance_capsule must be required")
    specs = policy.get("bindings")
    expected_keys = {
        "submission_freeze",
        "independent_content_review",
        "human_acceptance_receipt",
    }
    if not isinstance(specs, dict) or set(specs) != expected_keys:
        raise ValueError("content_acceptance_capsule.bindings must declare exactly freeze/review/human receipt")

    bound: dict[str, dict[str, str]] = {}
    for key in sorted(expected_keys):
        spec = specs.get(key)
        if not isinstance(spec, dict):
            raise ValueError(f"content_acceptance_capsule binding spec invalid: {key}")
        filename, kind = spec.get("filename"), spec.get("kind")
        if not isinstance(filename, str) or not filename or Path(filename).name != filename:
            raise ValueError(f"content_acceptance_capsule filename invalid: {key}:{filename!r}")
        if not isinstance(kind, str) or not kind:
            raise ValueError(f"content_acceptance_capsule kind invalid: {key}")
        path = (workspace / filename).resolve()
        path.relative_to(workspace.resolve())
        path.relative_to(root.resolve())
        if not path.is_file():
            raise ValueError(f"content acceptance evidence missing: {key}:{filename}")
        bound[key] = _p.binding(root, _p.repo_rel(root, path), kind)

    freeze_doc = _p.load_yaml(_p.safe_repo_path(root, bound["submission_freeze"]["path"], must_exist=True))
    human_doc = _p.load_yaml(_p.safe_repo_path(root, bound["human_acceptance_receipt"]["path"], must_exist=True))
    case_id = manifest.get("case_id")
    if policy.get("human_receipt_case_id_must_equal_manifest_case_id") is not True:
        raise ValueError("content acceptance capsule case binding policy disabled")
    if human_doc.get("case_id") != case_id or freeze_doc.get("case_id") != case_id:
        raise ValueError("content acceptance capsule case_id drift")
    if policy.get("human_receipt_source_commit_must_equal_plan_source_commit") is not True:
        raise ValueError("content acceptance capsule source_commit binding policy disabled")
    if human_doc.get("source_commit") != source_commit or freeze_doc.get("source_commit") != source_commit:
        raise ValueError("content acceptance capsule source_commit drift")
    if policy.get("human_receipt_must_bind_current_freeze_and_review") is not True:
        raise ValueError("content acceptance capsule receipt binding policy disabled")
    expected_human_bindings = {
        "submission_freeze": {
            "path": Path(bound["submission_freeze"]["path"]).name,
            "sha256": bound["submission_freeze"]["sha256"],
        },
        "independent_content_review": {
            "path": Path(bound["independent_content_review"]["path"]).name,
            "sha256": bound["independent_content_review"]["sha256"],
        },
    }
    if human_doc.get("bindings") != expected_human_bindings:
        raise ValueError("content acceptance HUMAN receipt does not bind current freeze/review bytes")

    ordered = [
        bound["submission_freeze"],
        bound["independent_content_review"],
        bound["human_acceptance_receipt"],
    ]
    return ordered, bound


def build_plan(manifest_raw: str, source_commit: str, *, root: Path = ROOT) -> dict:
    """Build the complete canonical plan after the accepted-content precondition.

    This function intentionally contains the full plan composition. There is no
    ungated complete plan builder hidden in a helper module or closure.
    """
    if not isinstance(source_commit, str) or not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("source_commit must be a full 40-hex Git commit")
    _require_accepted_content(manifest_raw, root=root)

    case_errors = validate_case(manifest_raw, root=root)
    if case_errors:
        raise ValueError("case is not READY for Artifact planning: " + " | ".join(case_errors))

    manifest_path = _p.safe_repo_path(root, manifest_raw, must_exist=True)
    manifest = _p.load_yaml(manifest_path)
    contract, profile = _p.load_profile(root)
    registry = _p.load_yaml(root / REGISTRY_PATH)
    module_id = str(profile["module_id"])
    module = (registry.get("modules") or {}).get(module_id)
    if not isinstance(module, dict) or module.get("lifecycle") != "ACTIVE":
        raise ValueError("Teaching Demo must be ACTIVE in module registry for a new plan")
    if module.get("module_contract") != CONTRACT_PATH.as_posix():
        raise ValueError("module registry Teaching Demo contract drift")
    adapter = module.get("artifact_adapter") or {}
    builder_raw = adapter.get("build") if isinstance(adapter, dict) else None
    if not isinstance(builder_raw, str) or not builder_raw:
        raise ValueError("Teaching Demo build adapter missing")

    workspace = _p.safe_repo_path(root, manifest.get("workspace"), must_exist=True)
    if not workspace.is_dir():
        raise ValueError("manifest workspace is not a directory")
    sources = manifest.get("source") or {}
    if not isinstance(sources, dict):
        raise ValueError("manifest source must be a mapping")

    bindings: list[dict[str, str]] = []
    if profile.get("include_case_manifest") is True:
        bindings.append(_p.binding(root, _p.repo_rel(root, manifest_path), "case_manifest"))

    source_texts: list[str] = []
    planned_roles: list[dict[str, str]] = []
    roles = profile.get("workspace_source_roles") or []
    if not isinstance(roles, list) or not roles or not all(isinstance(x, str) and x for x in roles):
        raise ValueError("artifact_job_profile.workspace_source_roles invalid")
    for role in roles:
        rel = sources.get(role)
        if not isinstance(rel, str) or not rel:
            raise ValueError(f"manifest source role missing: {role}")
        path = (workspace / rel).resolve()
        path.relative_to(workspace.resolve())
        path.relative_to(root.resolve())
        if not path.is_file():
            raise ValueError(f"workspace source file missing: {role}: {rel}")
        repo_rel = _p.repo_rel(root, path)
        bindings.append(_p.binding(root, repo_rel, f"case_source_{role}"))
        planned_roles.append({"role": role, "path": repo_rel})
        source_texts.append(path.read_text(encoding="utf-8"))

    acceptance_bindings, acceptance_capsule = _acceptance_capsule(
        root, profile, workspace, manifest, source_commit
    )
    bindings.extend(acceptance_bindings)

    dependencies = profile.get("repository_dependencies") or []
    if not isinstance(dependencies, list):
        raise ValueError("repository_dependencies must be a list")
    for item in dependencies:
        if not isinstance(item, dict):
            raise ValueError("repository dependency must be a mapping")
        raw, kind = item.get("path"), item.get("kind")
        if not isinstance(raw, str) or not isinstance(kind, str):
            raise ValueError("repository dependency path/kind invalid")
        bindings.append(_p.binding(root, raw, kind))
    if not any(x.get("path") == LOCKER_PATH for x in dependencies if isinstance(x, dict)):
        raise ValueError("artifact_job_profile must bind the generic input-plan locker")

    constraints = manifest.get("constraints") or {}
    minimum_figures = int(constraints.get("figure_count_min") or 0)
    markers, figure_bindings = _p.figure_bindings(root, profile, source_texts, minimum_figures)
    bindings.extend(figure_bindings)

    repository_textbook = None
    source_pages = ((manifest.get("input") or {}).get("source_pages") or {})
    if source_pages.get("mode") == "repository-pdf":
        raw_textbook = source_pages.get("file")
        if not isinstance(raw_textbook, str) or not raw_textbook:
            raise ValueError("repository-pdf source requires file")
        textbook_binding = _p.binding(root, raw_textbook, "repository_textbook_pdf")
        bindings.append(textbook_binding)
        repository_textbook = {
            "path": raw_textbook,
            "sha256": textbook_binding["sha256"],
            "git_blob_sha1": source_pages.get("blob_sha"),
            "size_bytes": source_pages.get("size_bytes"),
        }

    bindings = _p.dedupe_bindings(bindings)
    _validate_repository_python_import_closure(root)
    _validate_repository_control_import_closure(root)

    module_contract_binding = _p.binding(root, CONTRACT_PATH.as_posix(), "module_contract")
    builder_binding = _p.binding(root, builder_raw, "builder")
    repository_snapshot, snapshot_binding = _p.snapshot_for_plan(
        root,
        source_commit,
        bindings,
        module_contract_binding,
        builder_binding,
    )

    case_id = str(manifest.get("case_id"))
    revision = int(manifest.get("instance_revision"))
    plan: dict = {
        "version": 1,
        "schema_id": profile["plan_schema_id"],
        "module_id": module_id,
        "case_id": case_id,
        "title": manifest.get("title"),
        "instance_revision": revision,
        "manifest": _p.repo_rel(root, manifest_path),
        "product_contract": contract["id"],
        "source_commit": source_commit,
        "bound_by_artifact_initializer": {
            "module_contract_binding": module_contract_binding,
            "builder_binding": builder_binding,
        },
        "repository_snapshot": repository_snapshot,
        "repository_snapshot_binding": snapshot_binding,
        "input_bindings": bindings,
        "case_source_roles": planned_roles,
        "figure_dependencies": {
            "used_marker_ids": markers,
            "count": len(markers),
            "minimum_required": minimum_figures,
        },
        "recommended_review_blocks": profile.get("recommended_review_blocks") or [],
        "execution": {
            "init_job_id_suggestion": f"teaching-demo-{case_id}-r{revision}",
            "lock_operator": LOCKER_PATH,
            "preflight": f"python tools/run_acceptance.py --scope preflight --manifest {_p.repo_rel(root, manifest_path)}",
            "formal_after_preflight_and_explicit_pdf_authorization": f"python tools/run_acceptance.py --scope formal --manifest {_p.repo_rel(root, manifest_path)}",
            "runtime_identity_required_at_lock": True,
        },
        "safety": {
            "planner_generates_product_pdf": False,
            "planner_accepts_human_review": False,
            "planner_mutates_artifact_lifecycle": False,
            "hidden_chat_memory_required": False,
            "engine_private_repository_access_required": False,
        },
        "content_acceptance_gate": {
            "contract": "production/contracts/teaching-demo-content.yaml",
            "case_id": case_id,
            "source_commit": source_commit,
            "decision": "INDEPENDENT_CONTENT_HUMAN_PASS",
            "evidence_capsule": acceptance_capsule,
        },
    }
    if repository_textbook is not None:
        plan["repository_textbook"] = repository_textbook
    plan["plan_identity_sha256"] = _p.canonical_sha256(plan)
    return plan


def write_content_addressed_plan(plan: dict, *, root: Path = ROOT) -> Path:
    """Write only a freshly rebuilt accepted canonical plan.

    A caller cannot bypass content acceptance by constructing a plan dictionary
    manually: before the first write, this function rebuilds the exact plan via
    ``build_plan`` and requires byte-equivalent canonical identity.
    """
    if not isinstance(plan, dict):
        raise ValueError("plan must be a mapping")
    manifest_raw = plan.get("manifest")
    source_commit = plan.get("source_commit")
    if not isinstance(manifest_raw, str) or not manifest_raw:
        raise ValueError("plan manifest missing")
    if not isinstance(source_commit, str):
        raise ValueError("plan source_commit missing")

    expected = build_plan(manifest_raw, source_commit, root=root)
    if _p.canonical_sha256(plan) != _p.canonical_sha256(expected) or plan != expected:
        raise ValueError("caller-supplied plan does not equal freshly rebuilt accepted canonical plan")
    plan = expected

    _contract, profile = _p.load_profile(root)
    snapshot = plan.get("repository_snapshot")
    snapshot_binding = plan.get("repository_snapshot_binding")
    if not isinstance(snapshot, dict) or not isinstance(snapshot_binding, dict):
        raise ValueError("plan missing repository snapshot")

    # First protected write occurs only after accepted-content revalidation and
    # canonical plan reconstruction above.
    snapshot_path = write_snapshot(snapshot, root=root)
    expected_snapshot_rel = _p.repo_rel(root, snapshot_path)
    if snapshot_binding.get("path") != expected_snapshot_rel:
        raise ValueError("plan repository_snapshot_binding path drift")
    if hashlib.sha256(snapshot_path.read_bytes()).hexdigest() != snapshot_binding.get("sha256"):
        raise ValueError("plan repository_snapshot_binding hash drift")

    output_root = _p.safe_repo_path(root, profile.get("output_root"))
    output_root.mkdir(parents=True, exist_ok=True)
    case_id = str(plan.get("case_id") or "unknown-case")
    identity = str(plan.get("plan_identity_sha256") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", identity):
        raise ValueError("plan_identity_sha256 invalid")
    target_dir = (output_root / case_id).resolve()
    target_dir.relative_to(output_root.resolve())
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{identity}.yaml"
    payload = yaml.safe_dump(plan, allow_unicode=True, sort_keys=False)
    if target.exists():
        if target.read_text(encoding="utf-8") != payload:
            raise ValueError("content-addressed plan path exists with different bytes")
    else:
        target.write_text(payload, encoding="utf-8")
    return target


def selftest() -> None:
    _p.selftest_primitives()
    dependency_closure_selftest()
    for forbidden in ("build_plan", "write_content_addressed_plan", "main"):
        if hasattr(_p, forbidden):
            raise AssertionError(f"planning primitive library regained protected aggregate: {forbidden}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--source-commit")
    parser.add_argument("--write", action="store_true", help="write immutable snapshot and content-addressed plan")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    selftest()
    if args.selftest:
        print("PASS: canonical Teaching Demo Artifact planner selftest")
        return 0
    if not args.manifest or not args.source_commit:
        parser.error("--manifest and --source-commit are required unless --selftest")
    try:
        plan = build_plan(args.manifest, args.source_commit)
        if args.write:
            path = write_content_addressed_plan(plan)
            print(f"PLAN_WRITTEN: {path.relative_to(ROOT)}")
            print(f"PLAN_IDENTITY_SHA256: {plan['plan_identity_sha256']}")
            print(f"SNAPSHOT: {plan['repository_snapshot_binding']['path']}")
            print(f"SOURCE_COMMIT: {plan['source_commit']}")
        else:
            print(yaml.safe_dump(plan, allow_unicode=True, sort_keys=False).rstrip())
    except Exception as exc:
        print(f"FAIL: {exc}")
        return 1
    print("NO_PRODUCT_PDF_COMPOSITION_PERFORMED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
