# PDF Production Engine

Public, deterministic, stateless build runtime for PDF production and related resource artifacts.

This repository stores no consumer-project business content, private documents, candidate data, source repositories, or long-lived private build inputs. ChatGPT/session is the orchestrator between a consumer project and this public mechanical build engine.

## Canonical authored-PDF backend

**XeLaTeX is the canonical backend for every new or rebuilt authored PDF.**

- XeLaTeX / TeX Live: document compositor;
- CTeX / xeCJK: Chinese typesetting;
- TikZ / PGF / PGFPlots / tcolorbox: figures and structured document elements;
- `templates/latex-base-v1/`: five production-qualified page systems;
- `templates/visual-base-v1/`: rejected historical Typst prototypes only;
- ReportLab: permitted only for legacy/mechanical utilities, not authored-layout authority.

The three-round LaTeX migration is complete. Round 1 established the architecture and five candidates, Round 2 stress-tested them, and Round 3 validated real consumer-product classes with full-page visual review. See `docs/LATEX_MIGRATION_ROUND1.md`, `docs/LATEX_MIGRATION_ROUND2.md`, and `docs/LATEX_MIGRATION_ROUND3.md`.

## Production template selection

The five templates are **routed by document family, not globally randomized**:

- L01 KOMA Report: professional report / handbook, secondary training fallback;
- L02 Memoir Book: long-form guide / knowledge book;
- L03 Margin Handout: annotated reading / margin-note handout;
- L04 CTeX Technical Manual: training manual / workbook;
- L05 CTeX Editorial Book: textbook / editorial knowledge book.

A global uniform random pool remains disabled because real-product evidence showed that technical correctness does not imply equal suitability for every document family.

## Core responsibility

`validated stage package -> isolated resource block build -> block evidence -> reviewed prerequisite gate -> XeLaTeX composition -> final PDF preflight -> full-page render -> evidence bundle`

The engine never decides what a project should say. Consumer projects own content, business rules, source identity, domain-specific semantics, and final acceptance criteria.

## Repository boundary

The engine must not require a PAT that can read/write a consumer repository, must not checkout a private consumer repository, and must not commit back into one. Normal execution is session-mediated and ephemeral. Consumer plaintext must not be committed to this public repository.

## Acceptance

Complex deliverables use block-first review:

`content review -> figure/source review -> XeLaTeX composition -> independent preflight -> render every page -> ChatGPT visual review -> hash-bound receipt`

Machine success never equals visual acceptance. Hash changes invalidate prior acceptance.

For canonical XeLaTeX authored PDFs, the final compiler pass must have zero unresolved instances of:

- missing-character warnings;
- overfull horizontal boxes;
- overfull vertical boxes;
- undefined references;
- remaining rerun-needed warnings.

The engine still reports `MACHINE_PASS + REVIEW_REQUIRED`; final `REVIEW_PASS` belongs to the consumer project's review record.

## Core CLI

```bash
python -m pip install -e .

# Canonical authored PDF build
pdf-latex-build --root . --source input.tex --output dist/output.pdf --passes 3

# Validate / run one resource block
pdf-resource-job resource-job.yaml
pdf-resource-run --root . --job resource-job.yaml --block figures --out dist --dpi 144

# Full-page review bundle
pdf-review-pack --out dist/review --dpi 200 output.pdf

# Locked source-page extraction
pdf-locked-pages --spec locked-source.yaml --out dist/source-pages

# Full TeX/CJK/figure runtime smoke
pdf-runtime-smoke --out .runtime-smoke
```

`pdf-typst-build` remains only for reproducibility of rejected historical artifacts and is not a valid backend for new authored PDFs.

## Runtime

The public resource runtime validates XeLaTeX / TeX Live, CJK/fontconfig, TikZ, PGFPlots, CircuiTikZ, tkz-euclide, tikz-3dplot, Poppler, Pillow, PyMuPDF and PDFium.

## Development

Current qualified migration workline: `feat/latex-migration-round3`, based on the original `feat/pdf-production-engine-v1` implementation line.

Do not treat `main` as release authority until an explicitly authorized release merge. The v1 LaTeX template library itself is now qualification-frozen; future changes must preserve the same compile, preflight, render and human-review gates.
