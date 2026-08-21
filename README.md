# PDF Production Engine

Public, deterministic build runtime for PDF production and related resource artifacts.

This repository is **stateless with respect to consumer projects**. It stores no project-specific business content, private documents, candidate data, source repositories, or long-lived build inputs. It owns only generic build tools, schemas, public fixtures, machine QA, renderers, secure handoff utilities, and delivery protocols.

## Core responsibility

`validated stage package -> isolated resource block build -> block evidence -> reviewed prerequisite gate -> composition -> final PDF preflight -> full-page render -> evidence bundle`

The engine never decides what a project should say. Consumer projects own content, business rules, source identity, domain-specific figure semantics, and acceptance criteria. ChatGPT is the orchestrator/reviewer: it reads the consumer project's operation checklist, prepares the minimum stage package, reviews every required block, and writes accepted outputs back to the consumer repository.

## No direct repository relationship

The engine must not require a PAT that can read or write a consumer repository. It must not checkout a private consumer repository and must not commit directly into one.

Private and public repositories are intentionally decoupled:

1. the consumer repository declares a resource-operation checklist;
2. ChatGPT reads that checklist and the required source inputs;
3. ChatGPT submits only the build package required for one resource stage;
4. the engine runs mechanically and returns evidence/output;
5. ChatGPT reviews the result and writes accepted outputs/receipts into the target repository.

For private material, use the sealed-box protocol in `docs/SEALED_PRIVATE_JOBS.md`. Plain private material must never be committed to this public repository or uploaded as a public artifact.

## Block acceptance is mandatory

Complex deliverables may not be built as one opaque step.

Typical document flow:

`content review -> figure/chart/source-page build -> resource review -> composition -> final PDF build -> final full-page visual review`

A block may be consumed by composition only when the consumer project contains a `REVIEW_PASS` receipt bound to the current accepted SHA-256. Changing that block invalidates the old receipt.

The engine may report only `MACHINE_PASS + REVIEW_REQUIRED`; ChatGPT records `REVIEW_PASS` or `REVIEW_FAIL` in the consumer project.

## Current v1 capabilities

### Job / acceptance protocol

- resource-job schema and validator;
- hash-bound prerequisite gates for composition/final stages;
- generic single-block resource runner;
- machine evidence for PDF/image/other file outputs;
- block backend logs kept inside the job output rather than echoed as consumer content.

### PDF production

- deterministic manifest validation;
- ReportLab PDF build;
- command backend for project-owned publishers/adapters;
- PyMuPDF independent PDF open/preflight;
- PDFium full-page pixel rendering;
- page/PDF SHA-256 evidence.

### Locked source-page extraction

`pdf-locked-pages` is the generic source-page primitive for stage packages that already know the immutable source identity and physical pages. It provides:

- ordered multi-URL fetch/retry;
- optional exact byte-size check;
- PDF magic check;
- Git blob SHA and/or SHA-256 identity check;
- 1-based physical-page extraction into a new PDF;
- exact extracted-page-count validation;
- source/output evidence with `REVIEW_REQUIRED`.

It does **not** decide which pages are pedagogically correct. Text ranking, page location or successful extraction never creates `REVIEW_PASS`; ChatGPT must inspect the selected page pixels.

### Document / figure runtime

The public resource-runtime workflow installs and smoke-tests:

- XeLaTeX / TeX Live;
- CJK/fontconfig runtime;
- TikZ;
- PGFPlots;
- CircuiTikZ;
- tkz-euclide;
- tikz-3dplot;
- Poppler `pdftotext` / `pdftoppm`;
- Pillow contact-sheet generation;
- PyMuPDF preflight;
- PDFium rendering.

### Private stateless handoff

- PyNaCl sealed-box encryption utility (`pdf-sealed`);
- owner-only `job/**` sealed resource workflow;
- encrypted input on public Git history;
- plaintext only in ephemeral runner storage;
- output encrypted to a one-time return public key before artifact upload;
- no consumer-repository PAT or checkout.

The engine sealed private key is a one-time repository setup prerequisite. Store it only as the Actions secret `ENGINE_SEALED_PRIVATE_KEY`. `.github/workflows/sealed-key-bootstrap.yml` derives only the matching shareable public key and publishes machine-readable status context `pdf-engine/sealed-key/<PUBLIC_KEY>`. If the secret is missing, it publishes `pdf-engine/sealed-key/missing-secret=error` and private sealed production must remain unverified.

## CLI

```bash
python -m pip install -e .

# Validate a resource job and its review prerequisites
pdf-resource-job resource-job.yaml

# Execute exactly one resource block and produce machine evidence
pdf-resource-run --root . --job resource-job.yaml --block figures --out dist --dpi 144

# Build/preflight/render one PDF manifest
pdf-production build --root . --manifest examples/hello/build.yaml --out dist --dpi 144

# Fetch/verify an immutable PDF and extract declared physical pages
pdf-locked-pages --spec locked-source.yaml --out dist/source-pages

# Verify the full generic document/figure runtime
pdf-runtime-smoke --out .runtime-smoke

# Sealed-box transport helpers
pdf-sealed keygen
pdf-sealed public --private-key "$ENGINE_SEALED_PRIVATE_KEY"
```

## Public CI

The engine has two distinct public validation routes:

- `PDF Engine CI`: Python/unit/job-gate/public PDF fixture, including locked-source identity/extraction tests;
- `Resource Runtime CI`: real TeX/CJK/scientific-figure/Poppler/render runtime.

A generic runtime change is not accepted unless its real resource smoke passes.

## Acceptance rule

Machine acceptance requires, at minimum:

- safe manifest/job validation;
- builder success;
- required output exists and is non-trivial;
- PDF/image outputs can be independently inspected;
- PDF page count is positive;
- every PDF page is rendered;
- render count equals PDF page count;
- output/evidence hashes are recorded.

Machine acceptance never equals final acceptance. Every visually meaningful resource block and every final composed PDF must be reviewed from real rendered output.

## Development

Current v1 implementation branch: `feat/pdf-production-engine-v1`.

Do not merge to `main` until the stateless handoff, block acceptance, standard PDF CI, and full resource-runtime CI all pass.
