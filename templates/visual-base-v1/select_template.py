#!/usr/bin/env python3
"""Select one user-accepted visual base template.

The pool intentionally stays disabled until acceptance.yaml explicitly enables it.
Future templates may be appended and join only after their own user_acceptance=ACCEPTED.
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent


def load_yaml(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise SystemExit(f"Invalid mapping: {path}")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int)
    parser.add_argument("--id-only", action="store_true")
    args = parser.parse_args()

    manifest = load_yaml(ROOT / "manifest.yaml")
    acceptance = load_yaml(ROOT / "acceptance.yaml")

    if acceptance.get("random_pool_enabled") is not True:
        raise SystemExit("visual template random pool is disabled pending user acceptance")

    registry = {item["id"]: item for item in manifest.get("templates", [])}
    accepted = [
        tid
        for tid, state in (acceptance.get("templates") or {}).items()
        if isinstance(state, dict) and state.get("user_acceptance") == "ACCEPTED" and tid in registry
    ]
    if not accepted:
        raise SystemExit("no user-accepted visual templates are available")

    rng = random.Random(args.seed)
    tid = rng.choice(sorted(accepted))
    if args.id_only:
        print(tid)
    else:
        print(ROOT / registry[tid]["file"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
