"""Canonical Teaching Demo Content architecture-helper facade.

Library only. The only effective content gate capability is
``tools/check_teaching_demo_content.py#validate``. Pure primitives live in
``_teaching_demo_content_architecture_impl.py``; executable MACHINE/HARD
metadata and the canonical MACHINE_GATE receipt generator live in
``teaching_demo_content_enforcement.py``.

Gate A RRA4 hardening removes the former caller/stack/path/name deny mechanism.
Python introspection metadata is neither authentication nor capability isolation,
even on the deny side: source can be recompiled under alternate metadata and
closures/code objects are inspectable. The architecture therefore relies on
composition locality and capability removal instead: internal/helper modules
contain only primitives and no complete readiness/accepted orchestration.
"""
from __future__ import annotations

from typing import Any

import _teaching_demo_content_architecture_impl as _impl
from _teaching_demo_content_architecture_impl import *  # noqa: F401,F403,E402
import teaching_demo_content_enforcement as _enforcement


def make_machine_gate_receipt(
    *,
    source_commit: str,
    bindings: dict[str, str],
    requirement_ids: set[str],
    state_trace_prefix: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return the one receipt shape accepted by the canonical Phase-A gate."""
    return _enforcement.make_machine_gate_receipt(
        source_commit=source_commit,
        bindings=bindings,
        requirement_ids=requirement_ids,
        state_trace_prefix=state_trace_prefix,
    )


def selftest() -> None:
    """Exercise pure primitives and executable enforcement contracts."""
    _impl.selftest()
    _enforcement.selftest()
