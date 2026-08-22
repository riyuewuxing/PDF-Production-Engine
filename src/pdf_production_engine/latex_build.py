from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import fitz


class LatexBuildError(ValueError):
    pass


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe_source(source: Path) -> Path:
    source = source.resolve()
    if not source.is_file():
        raise LatexBuildError(f"source does not exist: {source}")
    if source.suffix.lower() != ".tex":
        raise LatexBuildError("source must be a .tex file")
    return source


def _safe_output(output: Path) -> Path:
    output = output.resolve()
    if output.suffix.lower() != ".pdf":
        raise LatexBuildError("output must be a .pdf file")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def resolve_xelatex_binary(explicit: str | None = None) -> str:
    if explicit:
        path = shutil.which(explicit) if not Path(explicit).is_file() else str(Path(explicit).resolve())
    else:
        path = shutil.which("xelatex")
    if not path:
        raise LatexBuildError(
            "XeLaTeX not found. The canonical PDF runtime must provide xelatex/TeX Live in PATH."
        )
    return path


def build_latex_pdf(
    source: Path,
    output: Path,
    *,
    root: Path | None = None,
    xelatex_bin: str | None = None,
    passes: int = 2,
) -> dict:
    source = _safe_source(source)
    output = _safe_output(output)
    binary = resolve_xelatex_binary(xelatex_bin)
    project_root = (root or source.parent).resolve()
    if not project_root.is_dir():
        raise LatexBuildError(f"project root does not exist: {project_root}")
    try:
        source_rel = source.relative_to(project_root)
    except ValueError as exc:
        raise LatexBuildError("source must be contained inside the declared project root") from exc
    if passes < 1 or passes > 4:
        raise LatexBuildError("passes must be between 1 and 4")

    version_output = subprocess.run(
        [binary, "--version"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    ).stdout.strip()
    version = version_output.splitlines()[0] if version_output else "unknown"

    normalized_command = [
        Path(binary).name,
        "-no-shell-escape",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        "-output-directory=<output-dir>",
        "-jobname=<output-stem>",
        "<source>",
    ]
    command = [
        binary,
        "-no-shell-escape",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        f"-output-directory={output.parent}",
        f"-jobname={output.stem}",
        str(source_rel),
    ]

    pass_logs: list[str] = []
    for index in range(passes):
        proc = subprocess.run(
            command,
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        pass_logs.append(proc.stdout)
        if proc.returncode != 0:
            raise LatexBuildError(
                f"XeLaTeX pass {index + 1}/{passes} failed ({proc.returncode}):\n{proc.stdout}"
            )

    if not output.is_file() or output.stat().st_size <= 0:
        raise LatexBuildError("XeLaTeX produced no non-empty PDF")

    try:
        doc = fitz.open(output)
    except Exception as exc:
        raise LatexBuildError(f"output cannot be opened as PDF: {exc}") from exc
    try:
        page_count = doc.page_count
        if page_count <= 0:
            raise LatexBuildError("output PDF has no pages")
    finally:
        doc.close()

    return {
        "engine": "PDF-Production-Engine",
        "capability": "xelatex-pdf-build-v1",
        "status": "MACHINE_PASS",
        "review_status": "REVIEW_REQUIRED",
        "canonical_document_backend": True,
        "runtime": {
            "xelatex": version,
            "binary": Path(binary).name,
            "shell_escape": False,
            "passes": passes,
        },
        "source": {
            "path": str(source),
            "sha256": _sha256(source),
            "project_root": str(project_root),
        },
        "output": {
            "path": str(output),
            "filename": output.name,
            "size_bytes": output.stat().st_size,
            "page_count": page_count,
            "sha256": _sha256(output),
        },
        "command": {"argv": normalized_command},
        "passes": [
            {"index": i + 1, "log_tail": log[-4000:]}
            for i, log in enumerate(pass_logs)
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-latex-build")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--xelatex-bin")
    parser.add_argument("--passes", type=int, default=2)
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args(argv)
    try:
        evidence = build_latex_pdf(
            args.source,
            args.output,
            root=args.root,
            xelatex_bin=args.xelatex_bin,
            passes=args.passes,
        )
        evidence_path = (args.evidence or args.output.with_suffix(".latex-evidence.json")).resolve()
        evidence_path.parent.mkdir(parents=True, exist_ok=True)
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            "LATEX_BUILD_MACHINE_PASS "
            f"pages={evidence['output']['page_count']} sha256={evidence['output']['sha256']} evidence={evidence_path}"
        )
        print("REVIEW_REQUIRED: run final review pack and inspect actual rendered pages")
        return 0
    except (OSError, subprocess.SubprocessError, LatexBuildError) as exc:
        print(f"LATEX_BUILD_FAIL: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
