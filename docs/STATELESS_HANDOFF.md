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

### Private canonical source bytes

Private canonical source identity and source transport are separate concerns.

For a private textbook/document, the consumer/session should first obtain the actual source bytes in an authorized private context, verify the canonical identity, and place the required original file inside the encrypted session package. Use `locked-source-v2` with `transport.kind: package-file`. The Engine recomputes size / Git blob SHA / SHA-256 before extracting pages.

Temporary GitHub `download_url` / signed URLs are not source identity and must not be persisted as the canonical private-source mechanism. URL transport remains suitable for public or otherwise stable sources only.

Unicode and spaces in package filenames are supported. Low-resolution review derivatives are for inspection only and must not replace original source pixels in final products.

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

1. ChatGPT/session retrieves the encrypted engine result into the current session;
2. decrypt and deliver the final binary to the user from the current session;
3. persist only hashes/receipts/source state when the consumer policy forbids long-term generated binaries;
4. any GitHub Artifact used as a transfer envelope is ephemeral only and must not be treated as storage;
5. direct engine-to-private-repository PAT checkout/write-back is forbidden by repository rules.

After the session has successfully downloaded and verified a `session-sealed-result`, it should write exactly one small marker at `.engine-session/<request_id>/retrieved.json` with schema `pdf-engine-session-retrieved-v1` and the workflow run id. The `Session Result Cleanup` workflow deletes that run's result artifact. This marker is a cleanup signal only; it is not product state.

If Artifact/egress quota prevents result retrieval, report an infrastructure failure. Consumers may use an explicitly approved session-native formal fallback, but that fallback must preserve the consumer's full quality/acceptance gates.

## Engine job states

- `PENDING_BUILD`
- `MACHINE_PASS`
- `MACHINE_FAIL`
- `REVIEW_REQUIRED`
- `REVIEW_PASS` (consumer receipt only)
- `REVIEW_FAIL` (consumer receipt only)
- `BLOCKED`
