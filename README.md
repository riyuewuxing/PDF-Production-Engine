# PDF Production Engine

Public, deterministic build runtime for PDF production and related resource artifacts.

This repository is **stateless with respect to consumer projects**. It stores no project-specific business content, private documents, candidate data, source repositories, or long-lived build inputs. It owns only generic build tools, generic schemas, public fixtures, machine QA, renderers, and delivery protocols.

## Core responsibility

`validated job package -> isolated resource builds -> block evidence -> composition -> final PDF preflight -> full-page render -> evidence bundle`

The engine never decides what a project should say. Consumer projects own content, business rules, source identity, and acceptance criteria. ChatGPT acts as orchestrator/reviewer: it reads the private project's resource-operation checklist, prepares the engine job, reviews each block, and writes accepted outputs back to the source repository.

## No direct repository relationship

The engine must not require a PAT that can read or write a consumer repository. It must not checkout a private consumer repository and must not commit directly into one.

Private and public repositories are intentionally decoupled:

1. the consumer repository declares a resource-operation checklist;
2. ChatGPT reads that checklist and the required source inputs;
3. ChatGPT submits only the build package needed for the current resource stage to this engine;
4. the engine runs mechanically and returns evidence/output;
5. ChatGPT reviews the result and writes accepted outputs into the target repository.

If a build input/output is private, the transport layer must use a sealed/encrypted job package or another privacy-preserving handoff. Plain private material must never be committed to this public repository or uploaded as a public artifact.

## Block acceptance is mandatory

A complex deliverable may not be built as one opaque step. Independent resource blocks are produced and reviewed before composition.

Typical document flow:

`content review -> figure/resource build -> figure/resource review -> composition -> final PDF build -> final full-page visual review`

Examples of independent resource blocks include:

- source content / data;
- TikZ/PGFPlots/CircuiTikZ/tkz-euclide/tikz-3dplot figures;
- source-page extracts and contact sheets;
- charts or generated images;
- tables or intermediate document fragments;
- final document composition.

The engine may report `MACHINE_PASS`, but only ChatGPT may record a visual/content acceptance receipt. Composition is allowed only after every required upstream block has an acceptance receipt bound to its evidence hash.

## Current v1 capabilities

- deterministic manifest validation;
- ReportLab PDF build;
- trusted command backend for project-owned publishers;
- PyMuPDF PDF open/preflight;
- PDFium full-page pixel rendering;
- page/PDF SHA-256 evidence;
- public fixture CI;
- generic resource-stage/job protocol.

Planned/next generic runtime capabilities are XeLaTeX/CJK, TikZ-family figure compilation, Poppler page extraction/text extraction, contact-sheet generation, and generic locked-binary fetch/hash verification. These are build-runtime capabilities only; project semantics remain in the consumer repository.

## Canonical CLI

```bash
python -m pip install -e .
pdf-production build --root . --manifest examples/hello/build.yaml --out dist --dpi 144
```

Successful output contains:

```text
dist/<document-id>/
├── <document>.pdf
├── build-manifest.json
└── rendered/
    ├── page-0001.png
    └── ...
```

`build-manifest.json` records PDF SHA-256, size, page count, per-page render hashes, render DPI, and:

`HUMAN_PIXEL_CONFIRMATION_REQUIRED`

## Backends

### `markdown-reportlab`

Generic deterministic Markdown-to-PDF backend used for public fixture/testing and simple documents.

### `command`

Trusted build-package adapter. The source package supplies an argv list. Supported placeholders:

- `{root}`
- `{output_dir}`
- `{output_pdf}`

The engine executes argv without `shell=True`, captures backend stdout/stderr into a local build log, and applies the same PDF preflight/render/evidence gates.

## Acceptance rule

Machine acceptance requires, at minimum:

- manifest safety validation;
- builder success;
- required output exists and is non-trivial;
- independent preflight can open the PDF;
- valid non-zero page geometry;
- every page is rendered;
- render count equals PDF page count;
- hashes/evidence are recorded.

Machine acceptance never equals final acceptance. Every visually meaningful resource block and every final composed PDF must be reviewed after real rendering.

## Development

Current v1 implementation branch: `feat/pdf-production-engine-v1`.

Do not merge to `main` until the stateless orchestration and block-acceptance protocol have passed CI and integration review.
