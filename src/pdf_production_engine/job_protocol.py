from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

import yaml

SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
STAGES = {"resource", "composition", "final"}
PRIVACY = {"public", "session", "sealed"}
KINDS = {"content", "figure", "chart", "source-page", "asset", "composition", "final-pdf"}
STATES = {"PENDING_BUILD", "MACHINE_PASS", "MACHINE_FAIL", "REVIEW_REQUIRED", "REVIEW_PASS", "REVIEW_FAIL", "BLOCKED"}


class JobProtocolError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_job(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    errors = validate_job(data)
    if errors:
        raise JobProtocolError("\n".join(errors))
    return data


def validate_job(data: dict) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["JOB_NOT_MAPPING"]
    if data.get("version") != 1:
        errors.append("JOB_VERSION_INVALID")
    job_id = data.get("job_id")
    if not isinstance(job_id, str) or not SAFE_ID.fullmatch(job_id):
        errors.append("JOB_ID_INVALID")
    stage = data.get("stage")
    if stage not in STAGES:
        errors.append("JOB_STAGE_INVALID")
    privacy = data.get("privacy")
    if privacy not in PRIVACY:
        errors.append("JOB_PRIVACY_INVALID")
    blocks = data.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        errors.append("JOB_BLOCKS_MISSING")
        blocks = []

    by_id: dict[str, dict] = {}
    for index, block in enumerate(blocks):
        if not isinstance(block, dict):
            errors.append(f"BLOCK_NOT_MAPPING:{index}")
            continue
        block_id = block.get("block_id")
        if not isinstance(block_id, str) or not SAFE_ID.fullmatch(block_id):
            errors.append(f"BLOCK_ID_INVALID:{index}")
            continue
        if block_id in by_id:
            errors.append(f"BLOCK_ID_DUPLICATE:{block_id}")
        by_id[block_id] = block
        if block.get("kind") not in KINDS:
            errors.append(f"BLOCK_KIND_INVALID:{block_id}")
        if not isinstance(block.get("required"), bool):
            errors.append(f"BLOCK_REQUIRED_INVALID:{block_id}")
        state = block.get("state")
        if state not in STATES:
            errors.append(f"BLOCK_STATE_INVALID:{block_id}")
        if state == "REVIEW_PASS":
            accepted = block.get("accepted_sha256")
            if not isinstance(accepted, str) or not SHA256.fullmatch(accepted):
                errors.append(f"BLOCK_REVIEW_HASH_INVALID:{block_id}")

    def require_review_pass(field: str) -> None:
        required = data.get(field) or []
        if not isinstance(required, list) or not all(isinstance(x, str) for x in required):
            errors.append(f"{field.upper()}_INVALID")
            return
        for block_id in required:
            block = by_id.get(block_id)
            if block is None:
                errors.append(f"GATE_BLOCK_MISSING:{field}:{block_id}")
                continue
            if block.get("state") != "REVIEW_PASS":
                errors.append(f"GATE_REVIEW_PASS_REQUIRED:{field}:{block_id}:{block.get('state')}")
            accepted = block.get("accepted_sha256")
            if block.get("state") == "REVIEW_PASS" and (not isinstance(accepted, str) or not SHA256.fullmatch(accepted)):
                errors.append(f"GATE_REVIEW_HASH_REQUIRED:{field}:{block_id}")

    if stage == "composition":
        require_review_pass("composition_requires")
    elif stage == "final":
        require_review_pass("final_requires")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-resource-job")
    parser.add_argument("job", type=Path)
    args = parser.parse_args(argv)
    try:
        data = load_job(args.job)
    except (OSError, yaml.YAMLError, JobProtocolError) as exc:
        print(f"RESOURCE_JOB_FAIL: {exc}", file=sys.stderr)
        return 2
    print(f"RESOURCE_JOB_PASS job={data['job_id']} stage={data['stage']} privacy={data['privacy']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
