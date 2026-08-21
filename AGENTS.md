# AGENTS.md — PDF Production Engine

## Purpose

This public repository is a **generic, stateless resource-build engine**. It owns deterministic build tooling, runtime setup, public fixtures, generic schemas, renderers, machine QA, and build evidence. It does **not** own consumer-project business content or private data.

## Hard boundaries

1. Never commit project-specific private content, candidate data, resumes, unreleased documents, account data, credentials, cookies, tokens, or private PDFs to this public repository.
2. Never require a token that grants this repository direct read/write access to a private consumer repository.
3. Never checkout a private consumer repository from a public workflow.
4. Never treat this repository as a free-compute shell for unrelated work. Every workflow must exercise a real generic build capability owned by this engine.
5. Public fixtures must be synthetic or intentionally public.
6. Private job inputs/outputs may enter runtime only through an approved privacy-preserving handoff. Plain private material must never be committed or uploaded as a public artifact.
7. Consumer-project rules/content remain authoritative in the consumer repository. This engine must not invent, rewrite, or interpret business content.

## Orchestration model

ChatGPT is the orchestrator and final reviewer:

`consumer project -> resource-operation checklist -> ChatGPT -> Engine job -> machine evidence/output -> ChatGPT review -> accepted output written back to consumer project`

The Engine does not discover what to build and does not make project-level decisions. The two repositories have no direct repository credential relationship.

## Block-first acceptance

Complex deliverables must be decomposed into independent blocks before composition.

A common PDF route is:

1. content/source review in the consumer project;
2. figure/chart/source-page resource build;
3. per-resource machine QA;
4. ChatGPT visual/content acceptance of each block;
5. composition only after all required block receipts are PASS;
6. final PDF build/preflight/full-page render;
7. ChatGPT final visual acceptance.

A command exit code of 0 is never enough. Every visually meaningful resource block must produce renderable evidence, and every `REVIEW_PASS` receipt must bind to the accepted output/evidence SHA-256.

## Engine-owned capabilities

Generic mechanical execution belongs here, including:

- ReportLab/XeLaTeX document builds;
- CJK font runtime checks;
- TikZ/PGFPlots/CircuiTikZ/tkz-euclide/tikz-3dplot compilation;
- PDF preflight and full-page rendering;
- PDF page extraction and text extraction;
- contact-sheet generation;
- generic binary fetch/retry/signature/hash verification;
- hashes, manifests, environment reports, build logs;
- public synthetic regression fixtures.

## Consumer-owned capabilities

Do not migrate project semantics into this repository. Examples that remain consumer-owned:

- teacher lesson content and BOARD_PLAN;
- recruitment authority/current-opening rules;
- candidate facts and eligibility logic;
- document wording and private source selection;
- domain-specific figure semantics;
- project-specific acceptance policy.

## Acceptance states

Use explicit states only:

- `PENDING_BUILD`
- `MACHINE_PASS`
- `MACHINE_FAIL`
- `REVIEW_REQUIRED`
- `REVIEW_PASS`
- `REVIEW_FAIL`
- `BLOCKED`

The engine may emit at most `MACHINE_PASS` + `REVIEW_REQUIRED`. Only ChatGPT may authorize/record `REVIEW_PASS` for a consumer deliverable.

## Canonical CLI

```bash
pdf-production build --root <build-package-root> --manifest <manifest-relative-to-root> --out <output-root>
```

## Branch discipline

Develop on feature branches. Do not merge to `main` or create PRs unless explicitly authorized. Keep runtime outputs out of source control except synthetic fixtures and intentionally versioned generic evidence.
