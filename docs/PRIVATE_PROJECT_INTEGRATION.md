# Private project integration

The preferred production boundary is:

`private consumer repo -> trusted owner-triggered public PDF engine -> PDF/preflight/render -> direct commit back to the same private repo`

The public engine repository must never persist private source or private PDF output.

## 1. Configure a least-privilege token

Create a fine-grained GitHub token that can access only the consumer repositories that are allowed to use this engine. Required repository permission for direct write-back is `Contents: Read and write`.

Store it only as this public repository Actions secret:

`PROJECT_REPO_TOKEN`

Do not commit the token to either repository.

## 2. Add a build manifest to the private project

### Existing project publisher (`command` backend)

```yaml
version: 1
document_id: teacher-structured
backend:
  type: command
  cwd: .
  command:
    - python
    - tools/publish_yunnan_structured.py
    - --source-root
    - content/job-search/teacher/interview/structured/materials/yunnan
    - --output
    - '{output_pdf}'
output:
  filename: teacher-structured.pdf
metadata:
  title: Teacher structured interview material
```

The engine does not use a shell for `backend.command`; it executes the explicit argv list. `{output_pdf}`, `{output_dir}`, and `{root}` placeholders are available.

Detailed consumer-command stdout/stderr is written to the temporary `backend.log` and is not printed to the public workflow log or uploaded as an artifact.

### Generic Markdown (`markdown-reportlab` backend)

```yaml
version: 1
document_id: report
backend:
  type: markdown-reportlab
source:
  path: docs/report.md
output:
  filename: report.pdf
metadata:
  title: Report
```

Use this only when the generic layout is sufficient. Complex project-specific publication should keep its publisher in the private project and use the command backend.

## 3. Run the workflow

Run **Build Private Project PDF** in this repository and provide:

- `source_repo`: e.g. `owner/private-project`
- `project_branch`: branch to read and receive generated outputs
- `manifest_path`: path of the private build manifest
- `requirements_path`: optional pip requirements file in the private project
- `install_xelatex`: enable for XeLaTeX projects
- `return_pdf_path`: destination PDF path in the private repo
- `return_render_dir`: optional destination directory for page PNGs

A successful run commits only the explicitly requested PDF, `<pdf>.build.json`, and optionally the render directory back to the private repository.

## 4. Privacy constraints

- The workflow is `workflow_dispatch` only and additionally checks that the actor is the repository owner.
- There is no `pull_request_target` path.
- Private build outputs are never uploaded using `actions/upload-artifact`.
- Do not use private titles, personal names, or sensitive information in workflow input values because workflow metadata/logs belong to the public repository.
- Prefer generic private paths such as `outputs/report.pdf` when the filename itself is sensitive.
- Treat the public runner as ephemeral processing, not private storage.

## 5. Visual acceptance

The engine only records `MACHINE_PASS` plus `HUMAN_PIXEL_CONFIRMATION_REQUIRED`.

Final acceptance belongs to the consumer project's reviewer. If visual review is required, set `return_render_dir` so every rendered page is written back to the private repository alongside the PDF.
