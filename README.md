# PDF Production Engine

A public, deterministic PDF build engine for multiple projects.

It owns only the mechanical production layer:

`validated build manifest -> PDF build -> PDF open/preflight -> render every page -> SHA-256/evidence -> delivery`

It does **not** own consumer-project business content and it never treats successful rendering as final visual acceptance.

## Why this repository exists

Projects such as `qiuzhidaren`, PPT/document systems, reports, and future repositories may all need repeatable PDF generation. Instead of giving another AI the project and asking it to "build a PDF", this repository provides one stable execution protocol and a standard GitHub-hosted runtime.

Public CI uses only public fixtures. Private projects can use the owner-triggered private build workflow, which checks out a permitted private project temporarily, builds the PDF, renders every page, and writes the outputs directly back to that private repository. Private PDF bytes are not uploaded as artifacts of this public repository.

## Canonical CLI

```bash
python -m pip install -e .
pdf-production build \
  --root . \
  --manifest examples/hello/build.yaml \
  --out dist \
  --dpi 144
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

`build-manifest.json` records PDF SHA-256, size, page count, per-page render hashes, render DPI, and the mandatory visual state:

`HUMAN_PIXEL_CONFIRMATION_REQUIRED`

## Backends

### `markdown-reportlab`

Generic deterministic Markdown-to-PDF backend used for public fixture/testing and simple documents.

### `command`

Trusted consumer-project adapter. The private project keeps its own business-specific publisher and supplies an argv list in its manifest. Supported placeholders:

- `{root}`
- `{output_dir}`
- `{output_pdf}`

The engine runs the argv list without `shell=True`, captures detailed publisher output into temporary `backend.log`, and then applies the same PDF preflight/render/evidence gates.

## Public CI

`.github/workflows/ci.yml` runs on `main`, `feat/**`, pull requests, and manual dispatch. It:

1. installs the engine;
2. runs unit/safety tests;
3. builds the public fixture;
4. opens the PDF;
5. renders every page;
6. verifies page/render counts and SHA-256 evidence;
7. uploads only the **public fixture** artifact.

## Private project builds

See [`docs/PRIVATE_PROJECT_INTEGRATION.md`](docs/PRIVATE_PROJECT_INTEGRATION.md).

The production workflow is deliberately narrow:

- owner-triggered only;
- least-privilege `PROJECT_REPO_TOKEN`;
- no `pull_request_target`;
- no private output artifact upload;
- direct commit of requested PDF/evidence/render pages back to the private consumer repository.

## Build manifest example

```yaml
version: 1
document_id: my-document
backend:
  type: command
  cwd: .
  command:
    - python
    - tools/publish.py
    - --output
    - '{output_pdf}'
output:
  filename: my-document.pdf
metadata:
  title: My document
```

## Acceptance rule

Machine acceptance requires all of the following:

- manifest passes safety validation;
- publisher exits successfully;
- expected PDF exists and is non-trivial;
- PyMuPDF can open the PDF;
- PDF has at least one valid page;
- every page is rendered at the requested DPI;
- rendered page count equals PDF page count;
- PDF and page SHA-256 values are recorded.

Even then the engine reports only `MACHINE_PASS`. Human/AI visual inspection of all rendered pages remains required before a consumer project may claim final visual acceptance.

## Development

Current v1 implementation branch: `feat/pdf-production-engine-v1`.

Do not merge to `main` until CI and fixture artifact have been inspected.
