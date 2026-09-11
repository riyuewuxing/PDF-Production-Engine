#!/usr/bin/env python3
"""Render the generated Artifact-execution snapshot inside HANDOFF.md."""
from __future__ import annotations

import argparse
from pathlib import Path

from artifact_foundation import ROOT
from derive_state import project_repository

HANDOFF = Path("HANDOFF.md")
START = "<!-- GENERATED:ARTIFACT-EXECUTION START -->"
END = "<!-- GENERATED:ARTIFACT-EXECUTION END -->"


def render_block(root: Path = ROOT) -> str:
    projection = project_repository(root)["state_projection"]
    counts = projection.get("state_counts") or {}
    count_text = ", ".join(f"{key}={value}" for key, value in sorted(counts.items())) or "none"
    instrumentation = projection.get("instrumentation_counts") or {}
    instrumentation_text = ", ".join(
        f"{key}={value}" for key, value in sorted(instrumentation.items())
    ) or "none"
    lines = [
        START,
        "",
        "## Generated Artifact execution snapshot",
        "",
        f"- as_of (latest ledger fact): `{projection.get('as_of')}`",
        f"- discovered Artifact Jobs: **{projection.get('job_count', 0)}**",
        f"- lifecycle inventory: `{count_text}`",
        f"- execution instrumentation: `{instrumentation_text}`",
        "- canonical current Artifact Job: **none**",
        "- selection policy: `explicit-job-id-only`",
        "- anti-regression rule: historical/incomplete jobs are inventory only; never infer one as the current project task.",
        "",
        END,
    ]
    return "\n".join(lines)


def rendered_handoff(root: Path = ROOT) -> str:
    root = root.resolve()
    path = root / HANDOFF
    text = path.read_text(encoding="utf-8")
    block = render_block(root)
    if START in text or END in text:
        if text.count(START) != 1 or text.count(END) != 1:
            raise ValueError("HANDOFF generated markers are malformed or duplicated")
        before, remainder = text.split(START, 1)
        _, after = remainder.split(END, 1)
        return before.rstrip() + "\n\n" + block + after
    return text.rstrip() + "\n\n---\n\n" + block + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        rendered = rendered_handoff(args.root)
        if args.write:
            (args.root.resolve() / HANDOFF).write_text(rendered, encoding="utf-8")
            print("PASS: HANDOFF Artifact execution snapshot written")
        else:
            print(render_block(args.root))
    except Exception as exc:
        print(f"FAIL: handoff derivation: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
