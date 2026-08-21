from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import fitz


class TypstBuildError(ValueError):
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
        raise TypstBuildError(f"source does not exist: {source}")
    if source.suffix.lower() != ".typ":
        raise TypstBuildError("source must be a .typ file")
    return source


def _safe_output(output: Path) -> Path:
    output = output.resolve()
    if output.suffix.lower() != ".pdf":
        raise TypstBuildError("output must be a .pdf file")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def resolve_typst_binary(explicit: str | None = None) -> str:
    if explicit:
        path = shutil.which(explicit) if not Path(explicit).is_file() else str(Path(explicit).resolve())
    else:
        path = shutil.which("typst")
    if not path:
        raise TypstBuildError(
            "Typst CLI not found. The runtime must provide a pinned native Typst executable in PATH."
        )
    return path


def build_typst_pdf(
    source: Path,
    output: Path,
    *,
    root: Path | None = None,
    typst_bin: str | None = None,
) -> dict:
    source = _safe_source(source)
    output = _safe_output(output)
    binary = resolve_typst_binary(typst_bin)
    project_root = (root or source.parent).resolve()
    if not project_root.is_dir():
        raise TypstBuildError(f"project root does not exist: {project_root}")
    try:
        source.relative_to(project_root)
    except ValueError as exc:
        raise TypstBuildError("source must be contained inside the declared project root") from exc

    version = subprocess.run(
        [binary, "--version"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    ).stdout.strip()

    command = [binary, "compile", "--root", str(project_root), str(source), str(output)]
    proc = subprocess.run(
        command,
        cwd=str(project_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        raise TypstBuildError(f"Typst compile failed ({proc.returncode}):\n{proc.stdout}")
    if not output.is_file() or output.stat().st_size <= 0:
        raise TypstBuildError("Typst compile produced no non-empty PDF")

    try:
        doc = fitz.open(output)
    except Exception as exc:
        raise TypstBuildError(f"output cannot be opened as PDF: {exc}") from exc
    try:
        page_count = doc.page_count
        if page_count <= 0:
            raise TypstBuildError("output PDF has no pages")
    finally:
        doc.close()

    return {
        "engine": "PDF-Production-Engine",
        "capability": "typst-pdf-build-v1",
        "status": "MACHINE_PASS",
        "review_status": "REVIEW_REQUIRED",
        "runtime": {
            "typst": version,
            "binary": Path(binary).name,
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
        "command": {
            "argv": [Path(binary).name, "compile", "--root", "<project-root>", "<source>", "<output>"],
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-typst-build")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--typst-bin")
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args(argv)
    try:
        evidence = build_typst_pdf(
            args.source,
            args.output,
            root=args.root,
            typst_bin=args.typst_bin,
        )
        evidence_path = (args.evidence or args.output.with_suffix(".typst-evidence.json")).resolve()
        evidence_path.parent.mkdir(parents=True, exist_ok=True)
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            "TYPST_BUILD_MACHINE_PASS "
            f"pages={evidence['output']['page_count']} sha256={evidence['output']['sha256']} evidence={evidence_path}"
        )
        print("REVIEW_REQUIRED: run final review pack and inspect actual rendered pages")
        return 0
    except (OSError, subprocess.SubprocessError, TypstBuildError) as exc:
        print(f"TYPST_BUILD_FAIL: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
