# LaTeX Base Library v1 - Round 1

This directory replaces the rejected Typst visual-base experiment as the candidate document-template layer.

## Non-negotiable backend rule

- Canonical authored-PDF backend: **XeLaTeX**.
- Chinese typesetting: CTeX / xeCJK with runtime-provided fonts.
- TikZ/PGF/tcolorbox and normal LaTeX packages may be used for figures and structured callouts.
- Typst templates are legacy/rejected references only and are not eligible for production template selection.
- ReportLab may remain inside engine-side mechanical utilities/fixtures, but it is not an authored-document layout authority.

## Why five, not ten

The previous ten Typst files over-counted visual variants as independent systems. v1 deliberately limits the candidate pool to five page systems. A candidate counts as distinct only when its page architecture remains recognizably different after colors and labels are removed.

## Round-1 candidate systems

1. `L01_koma_report.tex` - KOMA-Script `scrreprt`: professional report / handbook.
2. `L02_memoir_book.tex` - `memoir`: long-form book / guide.
3. `L03_margin_handout.tex` - CTeX article + margin-note architecture: narrow main measure plus outside notes. This keeps the useful Tufte-style information architecture while avoiding direct `tufte-handout` CJK/page-mark incompatibility found during the Round-1 compile probe.
4. `L04_ctex_manual.tex` - CTeX article + `tcolorbox`: technical manual / workbook with restrained callouts.
5. `L05_ctex_book.tex` - CTeX book: editorial textbook / long knowledge document.

All five consume the same neutral `benchmark-content.tex`. The benchmark includes Chinese prose, section hierarchy, display math, a table, a TikZ figure, callouts, headers/footers and natural pagination.

## Upstream reuse / provenance

The wrappers intentionally reuse mature LaTeX classes and packages instead of re-implementing a page-layout engine:

- KOMA-Script (`scrreprt`) - upstream LPPL 1.3c.
- memoir - upstream LPPL 1.3c.
- CTeX - established Chinese LaTeX classes/packages; use the upstream package from the pinned TeX Live runtime.
- tcolorbox - upstream LPPL; use the upstream package from TeX Live.
- `marginnote`, `fancyhdr`, `titlesec`, TikZ/PGF and standard math/table packages are runtime dependencies, not vendored copies.

The repository stores only thin project-owned wrappers and neutral benchmark content. Upstream class/package source is not copied here.

## Acceptance state

Round 1 proves the architecture and five working candidate families. It does **not** activate a random template pool and it is not final visual acceptance.

Three-round gate:

1. **Round 1 - architecture migration and first five XeLaTeX candidates**: compile, preflight, full-page render, remove the Typst pool from eligibility.
2. **Round 2 - template stress test and refinement**: long Chinese paragraphs, dense pages, sparse pages, formulas, long tables, figures, page breaks, TOC/headers/footers; eliminate or revise weak candidates.
3. **Round 3 - real project PDF acceptance**: build real consumer PDFs through the accepted LaTeX path, full-page review, hash-bound acceptance, freeze the final template set.

No candidate becomes production-accepted before Round 3.
