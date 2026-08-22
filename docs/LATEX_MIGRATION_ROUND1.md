# LaTeX Migration - Round 1

Date: 2026-08-21

Status: **ROUND 1 COMPLETE (session/local evidence); Round 2 and Round 3 remain required.**

## User decision implemented

1. Reduce the template target from ten to five.
2. Make **LaTeX, specifically XeLaTeX, the canonical authored-PDF foundation**.
3. Reuse mature LaTeX classes/packages instead of inventing a custom layout engine.
4. Reject the previous Typst T01-T10 pool; it must never enter the production random pool.
5. Final acceptance is three rounds and must end with real PDF visual acceptance.

## Architecture change

Added `pdf-latex-build` / `xelatex-pdf-build-v1`:

- input must be `.tex`;
- source must remain under the declared project root;
- output must be `.pdf`;
- XeLaTeX is resolved from the runtime;
- `-no-shell-escape` is enforced;
- bounded 1-4 pass compilation, default 2;
- output is independently opened with PyMuPDF;
- source/output SHA-256, page count and compile evidence are recorded;
- machine pass remains `REVIEW_REQUIRED`.

`pdf-typst-build` is retained only for reproducibility of historical rejected artifacts. It is not a valid backend for new authored PDFs.

## Mature upstream bases evaluated

The goal is to depend on established typesetting behavior, not copy entire third-party class files into this repository.

- KOMA-Script / `scrreprt`: https://ctan.org/pkg/koma-script - professional report/book classes, LPPL 1.3c.
- `memoir`: https://ctan.org/pkg/memoir - configurable long-form book class, LPPL 1.3c.
- `tufte-latex`: https://ctan.org/pkg/tufte-latex - margin-note handout/book architecture, Apache-2.0.
- ElegantBook: https://ctan.org/pkg/elegantbook - Chinese book template, LPPL 1.3c; retained as an upstream comparison reference for Round 2 if the pinned runtime includes it.
- ElegantNote: https://ctan.org/pkg/elegantnote - Chinese note/article template, LPPL 1.3c; retained as an upstream comparison reference for Round 2 if the pinned runtime includes it.
- `tcolorbox`: https://ctan.org/pkg/tcolorbox - mature breakable box/callout layer, LPPL.
- CTeX: https://ctan.org/pkg/ctex - Chinese typesetting layer for XeLaTeX/LuaLaTeX/(pdf)LaTeX.

### Tufte compile probe

A direct `tufte-handout` + Chinese/XeLaTeX probe produced a PDF but failed the strict compile gate at end-of-document with a page-mark/lowercasing incompatibility. It was therefore **not** accepted as a production candidate in Round 1. The useful information architecture was kept through a simpler CTeX + `marginnote` wrapper (`L03`) rather than weakening the compile gate.

This is intentional: upstream inspiration does not override the machine gate.

## Five Round-1 candidates

All candidates compile the same neutral benchmark containing Chinese prose, headings, display math, table, TikZ figure, callout behavior, headers/footers and pagination.

The following identities are from the canonical two-pass `pdf-latex-build` equivalent session run. They identify the exact reviewed files; they are evidence identities, not a claim that raw XeLaTeX bytes are reproducible across different runtime timestamps/environments.

| ID | System | Intended use | Round-1 pages | Session SHA-256 | Result |
|---|---|---|---:|---|---|
| L01 | KOMA-Script `scrreprt` | report / handbook | 3 | `0499ea163453c3e0c59f5c654be6410c6c50713cd9a3dd19f7daba0a68d527ea` | PASS |
| L02 | `memoir` | long-form book / guide | 4 | `7ec05589b3191b0fe94a094860ffb0b22d0e8049fc3124e6115c388e60ce9102` | PASS |
| L03 | CTeX + margin-note layout | handout / annotated reading | 2 | `31187d4387796b1d3de4b2bd6ad565f775e473831c814030d2596f9c8675edfa` | PASS |
| L04 | CTeX + `tcolorbox` | technical manual / workbook | 2 | `7e7130e54412c7a20b18128b4c6020c4b70de35a379cbb9c0a79f7430ee011fa` | PASS |
| L05 | CTeX book | textbook / editorial guide | 4 | `7ee16fcb324f30ff1014cc3920a02a37d1f4d76eb166fbfc711b12e43ec5009a` | PASS |

The five PDFs total 15 pages. The combined Round-1 comparison PDF used for full-page inspection has SHA-256 `b9d9a4b1c8f7a0ff05026873813ce4fb88959e63b9936b8447f293f6461db9b4`.

## Round-1 visual review

All 15 pages were rendered to pixels after canonical two-pass compilation. The Round-1 review found:

- no clipped text;
- no overlapping blocks;
- no black-square/broken CJK glyphs;
- equations and tables remained readable;
- TikZ graphics rendered correctly;
- all candidates were visibly document-first rather than card-dashboard-first;
- the five families are not yet treated as final: L01/L04 and L02/L05 still share some typographic ancestry and must be stress-tested in Round 2 before any final diversity claim.

Independent PDF preflight confirmed the combined file is openable, unencrypted, A4, non-scanned and exactly 15 pages. The direct Tufte failure is retained as a negative test, not hidden.

## Why Round 1 is complete but not final acceptance

Round 1 answers the root question: **the authored-document system now has a working XeLaTeX path and five real compiling candidates, while the rejected Typst pool is disabled.**

It does not yet prove that the five candidates survive difficult production content. That is the job of Round 2.

## Round 2 gate

Round 2 must use the same five families and test at least:

- very long Chinese paragraphs;
- intentionally dense and intentionally sparse pages;
- multi-page sections;
- long headings;
- long tables with page breaks;
- multiple equations and aligned equations;
- TikZ/PGFPlots figures;
- source-page/image placement;
- captions, footnotes, lists and quotations;
- TOC, page headers/footers, chapter/section transitions;
- orphan/widow-like visual failures and suspicious blank pages;
- font fallback / missing glyph behavior;
- template-pair distinctness after color is ignored.

Weak candidates must be revised or replaced, not cosmetically rescored.

## Round 3 gate

Round 3 must build real consumer-project PDFs through the accepted LaTeX path. Final acceptance requires full-page rendering, ChatGPT visual review, no layout defects, recorded PDF SHA-256, and hash-bound acceptance receipts. Only then may the final five-template pool be frozen/activated.
