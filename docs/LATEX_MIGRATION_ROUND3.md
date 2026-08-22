# LaTeX Migration - Round 3

Date: 2026-08-22

Status: **COMPLETE — five-template XeLaTeX library production-qualified and frozen as v1.**

## Scope and privacy

Round 3 used two previously accepted real consumer-product classes supplied through the ChatGPT/session staging layer: a long multi-card training product and a self-editing workbook product. Consumer plaintext and original private artifacts were not committed to this public repository.

Each real product was normalized in the active session and rendered through all five LaTeX systems. The public repository retains only generic qualification rules, aggregate counts and opaque output hashes.

## Required gate

For every generated PDF:

1. real consumer content was integrity-checked before/after composition;
2. XeLaTeX ran for three passes with `-no-shell-escape`;
3. the final log had zero missing-character, overfull hbox/vbox, unresolved-reference or rerun-needed failures;
4. the PDF was independently opened and verified as A4;
5. every page was rendered at 200 DPI;
6. every rendered page was visually reviewed;
7. defects caused a source/layout correction and full affected-document rebuild.

## Actual Round-3 failures found and closed

Round 3 was not a ceremonial re-run. Real content exposed several integration defects:

- generated TeX escape corruption in normalized text;
- `chapter` commands incorrectly used by article-class candidates;
- explicit source section numbers being duplicated by automatic LaTeX section numbering;
- workbook hard page breaks creating avoidable whitespace;
- a margin-handout section heading stranded at the bottom of a page, followed by a split `tcolorbox` beginning in the top margin of the next page.

Each defect was corrected and the affected PDFs were rebuilt and re-rendered. The final build has no edge clipping or orphan/split-box defect.

## Final evidence

- five template systems;
- two real consumer product classes;
- ten generated PDFs;
- 157 final pages;
- 157/157 pages rendered at 200 DPI and visually reviewed;
- zero strict final-log issues;
- zero missing required content markers;
- zero edge-clip risks after rebuild;
- zero accidental blank/near-blank pages;
- four deliberately sparse book chapter-divider pages were visually confirmed as intentional;
- combined session artifact SHA-256: `28b20480f3a99be0aa5d6796b169c2d8f1324bc31fab8b1ce86bd05e767a47a5`.

## Final five systems

| ID | Family | Primary route | Final state |
|---|---|---|---|
| L01 | KOMA professional report | report / handbook, secondary workbook fallback | PASS |
| L02 | memoir long-form book | long guide / knowledge book | PASS |
| L03 | margin-note handout | annotated handout / margin notes | PASS |
| L04 | CTeX + tcolorbox technical manual | training manual / workbook | PASS |
| L05 | CTeX editorial book | textbook / editorial knowledge book | PASS |

## Selection policy changed by real-product evidence

All five systems passed, but Round 3 also demonstrated that **global uniform random selection is not a quality-preserving production rule**. A book-oriented system can be technically correct for a workbook while still spending more pages and whitespace than the dedicated manual system.

The production library is therefore frozen with **document-family routing**, not a global random pool. Randomization may only occur inside a future explicitly compatible routed subset.

## Freeze

The three-round migration is complete. XeLaTeX is the canonical authored-PDF backend. Typst remains rejected for new authored PDFs, and ReportLab remains noncanonical for authored layout. Future final PDFs still require their own block review, independent preflight, every-page rendering and hash-bound human acceptance; template qualification does not waive per-deliverable review.
