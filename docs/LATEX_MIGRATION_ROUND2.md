# LaTeX Migration - Round 2

Date: 2026-08-21

Status: **ROUND 2 COMPLETE (session evidence). Round 3 remains mandatory for production acceptance.**

## Scope

Round 2 stress-tested the five XeLaTeX candidate families established in Round 1. The objective was not to add more templates. It was to prove that each candidate survives realistic long-form document pressure while remaining readable and structurally distinct.

## User-reported defect became a gate

The Round-1 sample exposed a real typography defect: Chinese body leading was too tight. Round 2 therefore rebuilt all five candidates with a more comfortable body rhythm:

- L01 KOMA Report: `1.46`;
- L02 Memoir Book: about `1.50` (`\OnehalfSpacing`);
- L03 Margin Handout: `1.52`;
- L04 Technical Manual: `1.48`;
- L05 Editorial Book: `1.50`.

These values are not a universal magic constant. The durable rule is that 10.5--11.5pt Chinese A4 body text must pass multi-page visual reading review. Compile success never accepts typography by itself.

## Stress benchmark

All five candidates compile the same neutral benchmark. It exercises:

- long Chinese prose and multi-page continuous reading;
- deliberately long wrapped headings;
- dense pages and an intentionally sparse page;
- inline, display and aligned equations;
- a multi-page `longtable` with repeated headers;
- TikZ and PGFPlots figures;
- a separately compiled external PDF page fixture included through `\includegraphics`;
- captions, quotation, lists, footnotes and long URL wrapping;
- TOC, headers, footers and page transitions;
- orphan-heading pressure and rare-CJK glyph coverage;
- structural distinctness after color is ignored.

The external page fixture is itself LaTeX/TikZ source (`source-page-fixture.tex`), so the public benchmark remains reproducible without committing opaque business binaries.

## XeLaTeX build gate hardened

`pdf-latex-build` is now `xelatex-pdf-build-v2` and defaults to three passes. The final pass has a strict log gate. Any of the following prevents machine acceptance:

- missing character warnings;
- overfull horizontal boxes;
- overfull vertical boxes;
- unresolved references;
- remaining rerun-required warnings.

A negative fixture containing an unsupported emoji was deliberately compiled. XeLaTeX emitted a missing-character warning and the strict builder rejected it, confirming that broken glyphs cannot silently pass.

## Real failures found and fixed

Round 2 did not treat the first stress render as automatically correct.

1. The too-tight Round-1 Chinese leading was rejected and all five templates were rebuilt with larger leading.
2. An early stress build created incidental near-empty pages after a float/list transition in some candidates. The benchmark flow was corrected and rebuilt. Only the deliberately sparse design-test page remains sparse.

Both failures are retained as reasons for the new rules rather than being hidden as one-off cosmetic edits.

## Final Round-2 evidence

The five final candidate PDFs contain 53 pages in total and were independently preflighted, rendered at 200 DPI and visually reviewed page by page.

| ID | Pages | SHA-256 | Machine | Visual |
|---|---:|---|---|---|
| L01 | 12 | `860987af3e2800b2ac9f9cdbeac17005e55396c7f351fdff907511602fd464cb` | PASS | PASS |
| L02 | 10 | `3a4a200f47493f4c38c3b6c76e18898ac5798bd0eda0643833fd35979c8f52d9` | PASS | PASS |
| L03 | 9 | `3e204501552d4179e9bfff19277118558f694b5546d08439f60840cf307a1819` | PASS | PASS |
| L04 | 10 | `85ae63a89314a353275643473bf7e35d967c988c148b14477e93f0a1e65f4732` | PASS | PASS |
| L05 | 12 | `0c626c773df9750e3aece60ff50f17857ee675073c0d0ce3adf491f92246f257` | PASS | PASS |

Combined comparison PDF:

- pages: `53`;
- SHA-256: `a09cc17e39b8c3ddbc5759d6e481fdce8df179c0ae2c5ad697931adff507808a`;
- preflight: PASS;
- every page rendered: yes;
- visual defects found in final rebuild: no clipping, no overlap, no broken CJK glyphs, no accidental blank/near-blank pages, no long-table overflow, no cropped figure.

## Diversity review

Ignoring accent color, the five candidates remain distinguishable by structure:

- L01: compact professional report hierarchy and KOMA header rhythm;
- L02: memoir book block, large chapter number and narrower long-reading measure;
- L03: narrow main text block plus real margin-note architecture;
- L04: technical manual hierarchy with breakable tcolorbox system;
- L05: editorial book chapter treatment, asymmetric book margins and running-head behavior.

L01/L04 and L02/L05 still share typographic ancestry, but Round-2 grayscale comparison shows enough structural separation to keep all five for Round 3. No candidate was kept merely to preserve the number five.

## Round 2 acceptance

**All five candidates pass Round 2 and advance to Round 3.** This is not production acceptance and does not activate random selection.

Round 3 must build real consumer-project PDFs through the accepted XeLaTeX path. Final acceptance still requires block review, composition, independent preflight, every-page rendering, ChatGPT page-by-page visual review and hash-bound receipts. Only after Round 3 may the production five-template pool be frozen or activated.
