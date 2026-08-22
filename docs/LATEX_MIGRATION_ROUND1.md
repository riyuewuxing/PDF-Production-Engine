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

| ID | System | Intended use | Round-1 pages | Session SHA-256 | Result |
|---|---|---|---:|---|---|
| L01 | KOMA-Script `scrreprt` | report / handbook | 3 | `eec171de08276c9077547c3a971c85d6e9b735e5c0d774b6234b4c712996a68a` | PASS |
| L02 | `memoir` | long-form book / guide | 4 | `10b1c910ea178057143f21396dd3855ee2ac51a73f862f89afc3769b55011ee1` | PASS |
| L03 | CTeX + margin-note layout | handout / annotated reading | 2 | `d4df66e1a9accc6bf0d500234b8fe169e6fd409f034ce7655d9395735d815df8` | PASS |
| L04 | CTeX + `tcolorbox` | technical manual / workbook | 2 | `60527f3c9412c2dfa873f3aff7f65048f44db0363a626ee6284d73a76f5e6089` | PASS |
| L05 | CTeX book | textbook / editorial guide | 4 | `47b711b28019c90957cb93d7ff6e787c145e84822b217136d9dcad24f97d8b73` | PASS |

The five PDFs total 15 pages in the refactored common-benchmark build.

## Round-1 visual review

All pages were rendered to pixels after compilation. The Round-1 review found:

- no clipped text;
- no overlapping blocks;
- no black-square/broken CJK glyphs;
- equations and tables remained readable;
- TikZ graphics rendered correctly;
- all candidates were visibly document-first rather than card-dashboard-first;
- the five families are not yet treated as final: L01/L04 and L02/L05 still share some typographic ancestry and must be stress-tested in Round 2 before any final diversity claim.

The direct Tufte failure is retained as a negative test, not hidden.

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
