# Stateless handoff protocol

The engine and every consumer repository are intentionally decoupled. The engine has no consumer-repository credential and stores no consumer business state.

## Roles

### Consumer repository

Owns:
- content and data;
- business/domain rules;
- project-specific publishers/adapters;
- resource-operation checklist;
- acceptance receipts and final deliverables.

### ChatGPT

Owns orchestration:
1. read the consumer repository checklist;
2. review non-resource content directly when possible;
3. prepare the smallest build package required for one resource stage;
4. submit the stage to the engine;
5. retrieve machine evidence/output;
6. inspect the rendered result;
7. record `REVIEW_PASS`/`REVIEW_FAIL` in the consumer repository;
8. only after all prerequisite receipts pass, submit the composition stage;
9. inspect the final rendered deliverable and write the accepted output back to the consumer repository.

### Engine

Owns only deterministic execution. It may report `MACHINE_PASS` and `REVIEW_REQUIRED`; it never declares final acceptance.

## Build-package rule

A build package is stage-scoped. It contains only files needed for the current mechanical build stage plus a `resource-job.yaml`.

Do not send an entire private repository when a figure, page range, or document fragment is sufficient.

Plain private build packages must never be committed to this public repository. For private material, use a sealed/encrypted transport or a session-mediated transfer that leaves no plaintext public repository history. Public fixtures may use plain packages.

## Block-first acceptance

Every composite deliverable declares blocks. Example:

- `content-main`
- `figure-ray-diagram`
- `figure-vt-graph`
- `source-pages`
- `composition`
- `final-pdf`

The sequence is:

1. review source/content block;
2. build each visual/resource block independently;
3. render each resource block;
4. ChatGPT reviews each block and records a receipt bound to its SHA-256;
5. validate composition prerequisites;
6. build the composed PDF;
7. preflight and render every final page;
8. ChatGPT performs final visual acceptance.

No composition job may proceed while a required upstream block lacks `REVIEW_PASS` with a matching evidence hash.

## Acceptance receipt

A receipt is consumer-project state, not engine state. Minimum fields:

```yaml
block_id: figure-example
state: REVIEW_PASS
reviewer: ChatGPT
accepted_sha256: <64-hex>
evidence_ref: <consumer-controlled reference>
reviewed_at: <timestamp>
```

If the block changes, the hash changes and the previous receipt is invalid.

## Privacy-preserving return path

Preferred order:

1. ChatGPT/session retrieves the engine result and writes it to the target private repository;
2. if a private binary cannot safely transit as plaintext through a public artifact, use sealed/encrypted result transport;
3. direct engine-to-private-repository PAT checkout/write-back is forbidden by repository rules.

## Engine job states

- `PENDING_BUILD`
- `MACHINE_PASS`
- `MACHINE_FAIL`
- `REVIEW_REQUIRED`
- `REVIEW_PASS` (consumer receipt only)
- `REVIEW_FAIL` (consumer receipt only)
- `BLOCKED`
