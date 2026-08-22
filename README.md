# PDF Production Engine

Public, deterministic build runtime for PDF production and related resource artifacts.

This repository is **stateless with respect to consumer projects**. It stores no project-specific business content, private documents, candidate data, source repositories, or long-lived build inputs. It owns only generic build tools, schemas, public fixtures, machine QA, renderers, optional transport helpers, and delivery protocols.

## Canonical authored-PDF backend

**New authored PDFs are built with XeLaTeX.** This is now an architecture rule, not a per-template preference.

- XeLaTeX / TeX Live is the canonical document compositor.
- CTeX / xeCJK provides the Chinese typesetting layer.
- TikZ/PGF/PGFPlots/tcolorbox and ordinary LaTeX packages provide figures, diagrams and structured document elements.
- `templates/latex-base-v1/` contains the five Round-1 candidate page systems.
- The former `templates/visual-base-v1/` Typst pool has been user-rejected and is retained only as historical visual reference.
- ReportLab may remain in engine-side mechanical utilities and legacy fixtures, but it is not the authored-document layout authority.

The migration is governed by a three-round acceptance gate: Round 1 architecture/candidates, Round 2 stress/refinement, Round 3 real consumer PDF acceptance and freeze. No template is production-accepted before Round 3.

## Core responsibility

`validated stage package -> isolated resource block build -> block evidence -> reviewed prerequisite gate -> composition -> final PDF preflight -> full-page render -> evidence bundle`

The engine never decides what a project should say. Consumer projects own content, business rules, source identity, domain-specific figure semantics, and acceptance criteria. ChatGPT is the orchestrator/reviewer: it reads the consumer project's operation checklist, prepares the minimum stage package, invokes the engine's generic build capability, reviews every required block, and writes accepted outputs back to the consumer repository.

## No direct repository relationship

The engine must not require a PAT that can read or write a consumer repository. It must not checkout a private consumer repository and must not commit directly into one.

Private and public repositories are intentionally decoupled:

1. the consumer repository declares a resource-operation checklist;
2. ChatGPT reads that checklist and the required source inputs;
3. ChatGPT prepares only the build package required for one resource stage in the active session/runtime;
4. the engine code/runtime executes mechanically against that stage package;
5. ChatGPT reviews the result and writes accepted outputs/receipts into the target repository.

**Normal private-project execution is ChatGPT/session-mediated and ephemeral.** Private consumer plaintext is not committed to this public repository. The sealed-box GitHub Actions path in `docs/SEALED_PRIVATE_JOBS.md` is an optional fallback for environments that specifically need remote workflow transport; it is not a prerequisite for normal engine use.

## Block acceptance is mandatory

Complex deliverables may not be built as one opaque step.

Typical document flow:

`content review -> figure/chart/source-page build -> resource review -> XeLaTeX composition -> final PDF build -> final full-page visual review`

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

- canonical `pdf-latex-build` XeLaTeX builder for authored `.tex -> .pdf` documents;
- no-shell-escape default and bounded multi-pass compilation;
- deterministic source/output SHA-256 evidence and independent PDF open/page-count validation;
- legacy ReportLab/command fixtures retained only where still needed by mechanical tooling during migration;
- PyMuPDF independent PDF open/preflight;
- PDFium full-page pixel rendering;
- page/PDF SHA-256 evidence.

### Batched final review pack

`pdf-review-pack` turns one or more already-composed PDFs into one mechanical review bundle in a single invocation. It provides:

- independent PyMuPDF preflight and page geometry/text metadata;
- independent PDFium render of **every page** at the requested DPI;
- PDF SHA-256 and per-page render SHA-256;
- font usage/embedded-font evidence when extractable;
- chunked contact sheets for fast navigation;
- a page-by-page Markdown review index;
- generic page-occupancy / near-empty-page warnings to surface suspicious whitespace before human review.

The occupancy logic is deliberately a **warning heuristic, not a rejection oracle**. A sparse page may be intentional, and a dense page may still be visually wrong. The review pack therefore always reports `MACHINE_PASS / HUMAN_REVIEW_REQUIRED`; it exists to batch mechanical work and help ChatGPT spend review time on actual page judgement, not to remove the final human gate.

This capability uses the engine's existing `PyMuPDF + PDFium + Pillow` stack; no additional image-analysis dependency is required.

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

### Optional sealed fallback

The repository retains a sealed-box helper/workflow for a special case where an orchestrator explicitly chooses encrypted remote GitHub Actions transport. This is **not** the canonical path for `qiuzhidaren` or other session-mediated builds and does not create any project-level key requirement.

## CLI

```bash
python -m pip install -e .

# Build an authored PDF with the canonical XeLaTeX backend
pdf-latex-build --root . --source templates/latex-base-v1/L01_koma_report.tex --output dist/L01.pdf --passes 2

# Validate a resource job and its review prerequisites
pdf-resource-job resource-job.yaml

# Execute exactly one resource block and produce machine evidence
pdf-resource-run --root . --job resource-job.yaml --block figures --out dist --dpi 144

# Build/preflight/render a legacy/public fixture manifest
pdf-production build --root . --manifest examples/hello/build.yaml --out dist --dpi 144

# Build one batched final-review bundle for one or more PDFs
pdf-review-pack --out dist/review --dpi 200 first.pdf second.pdf

# Fetch/verify an immutable PDF and extract declared physical pages
pdf-locked-pages --spec locked-source.yaml --out dist/source-pages

# Verify the full generic document/figure runtime
pdf-runtime-smoke --out .runtime-smoke

# Optional sealed-box transport helper
pdf-sealed keygen
```

`pdf-typst-build` remains temporarily available only for reproducibility of rejected historical artifacts. It is not a valid backend for new production templates.

## Public CI

The engine has two distinct public validation routes:

- `PDF Engine CI`: Python/unit/job-gate/public PDF fixture, plus installed CLI smoke tests and `pdf-review-pack` evidence;
- `Resource Runtime CI`: real XeLaTeX/TeX/CJK/scientific-figure/Poppler/render runtime.

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

For the LaTeX template migration specifically, production acceptance additionally requires all three rounds in `templates/latex-base-v1/README.md` to pass.

## Development

Current migration workline: `feat/latex-migration-round1`, based on `feat/pdf-production-engine-v1`.

Do not merge to `main` until the stateless engine capability, block acceptance, canonical XeLaTeX path, standard PDF CI, full resource-runtime CI, and the three-round template acceptance are complete.
