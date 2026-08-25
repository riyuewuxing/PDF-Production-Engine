#!/usr/bin/env python3
from artifact_foundation import artifact_input_fingerprint

module = {"path":"contract.yaml","sha256":"1"*64,"kind":"module_contract"}
builder = {"path":"build.py","sha256":"2"*64,"kind":"builder"}
runtime = {"name":"python","version":"3.12"}
source = {"path":"case.md","sha256":"3"*64,"kind":"case_source"}
plan_a = {"path":"plans/a.yaml","sha256":"4"*64,"kind":"input_plan"}
plan_b = {"path":"plans/b.yaml","sha256":"5"*64,"kind":"input_plan"}
snap_a = {"path":"snapshots/a.yaml","sha256":"6"*64,"kind":"repository_snapshot","dependency_identity_sha256":"7"*64}
snap_b = {"path":"snapshots/b.yaml","sha256":"8"*64,"kind":"repository_snapshot","dependency_identity_sha256":"7"*64}

fa = artifact_input_fingerprint("m", module, builder, runtime, [source, plan_a], snap_a, ["input_plan"])
fb = artifact_input_fingerprint("m", module, builder, runtime, [source, plan_b], snap_b, ["input_plan"])
assert fa == fb, "audit-plan/snapshot record drift invalidated reusable identity"
changed = dict(source); changed["sha256"] = "9"*64
fc = artifact_input_fingerprint("m", module, builder, runtime, [changed, plan_b], snap_b, ["input_plan"])
assert fc != fa, "real execution input change failed to invalidate reusable identity"
print("PASS: reuse fingerprint ignores audit-only drift and reacts to execution bytes")
