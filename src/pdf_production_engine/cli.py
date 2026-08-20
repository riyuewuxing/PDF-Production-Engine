from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import fitz
import yaml
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import HRFlowable, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

from . import __version__

SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")
CJK = re.compile(r"[\u3400-\u9fff]")


class ManifestError(ValueError):
    pass


def _safe_relative(root: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute():
        raise ManifestError(f"path must be non-empty and relative: {relative!r}")
    root = root.resolve()
    target = (root / relative).resolve()
    if root != target and root not in target.parents:
        raise ManifestError(f"path escapes project root: {relative}")
    return target


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(root: Path, relative_path: str) -> tuple[dict, Path]:
    path = _safe_relative(root, relative_path)
    if not path.is_file():
        raise ManifestError(f"manifest not found: {relative_path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if data.get("version") != 1:
        raise ManifestError("manifest version must be 1")
    document_id = data.get("document_id")
    if not isinstance(document_id, str) or not SAFE_ID.fullmatch(document_id):
        raise ManifestError("document_id must match [A-Za-z0-9._-]+")
    backend = data.get("backend") or {}
    if backend.get("type") not in {"markdown-reportlab", "command"}:
        raise ManifestError("backend.type must be markdown-reportlab or command")
    output = data.get("output") or {}
    filename = output.get("filename")
    if not isinstance(filename, str) or Path(filename).name != filename or not filename.lower().endswith(".pdf"):
        raise ManifestError("output.filename must be a simple .pdf filename")
    if backend.get("type") == "markdown-reportlab":
        source = (data.get("source") or {}).get("path")
        if not isinstance(source, str):
            raise ManifestError("markdown-reportlab requires source.path")
        _safe_relative(root, source)
    else:
        command = backend.get("command")
        if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
            raise ManifestError("command backend requires backend.command as a non-empty argv list")
        cwd = backend.get("cwd", ".")
        if not isinstance(cwd, str):
            raise ManifestError("backend.cwd must be a relative path")
        _safe_relative(root, cwd)
    return data, path


def _styles(use_cjk: bool) -> dict[str, ParagraphStyle]:
    font = "Helvetica"
    font_bold = "Helvetica-Bold"
    if use_cjk:
        # Standard CJK CID font keeps the generic fixture independent of local font files.
        if "STSong-Light" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        font = "STSong-Light"
        font_bold = "STSong-Light"
    return {
        "title": ParagraphStyle("title", fontName=font_bold, fontSize=22, leading=29, textColor=colors.HexColor("#172033"), spaceAfter=7 * mm),
        "h1": ParagraphStyle("h1", fontName=font_bold, fontSize=16, leading=22, textColor=colors.HexColor("#17365D"), spaceBefore=4 * mm, spaceAfter=3 * mm),
        "h2": ParagraphStyle("h2", fontName=font_bold, fontSize=12.5, leading=18, textColor=colors.HexColor("#1F4E79"), spaceBefore=3 * mm, spaceAfter=2 * mm),
        "h3": ParagraphStyle("h3", fontName=font_bold, fontSize=10.5, leading=15, spaceBefore=2 * mm, spaceAfter=1.5 * mm),
        "body": ParagraphStyle("body", fontName=font, fontSize=9.4, leading=14.5, textColor=colors.HexColor("#252A34"), spaceAfter=2.2 * mm, wordWrap="CJK"),
        "bullet": ParagraphStyle("bullet", fontName=font, fontSize=9.2, leading=14, wordWrap="CJK"),
        "small": ParagraphStyle("small", fontName=font, fontSize=8, leading=11, textColor=colors.HexColor("#687386")),
    }


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_markdown_reportlab(root: Path, manifest: dict, output_pdf: Path) -> None:
    source_path = _safe_relative(root, manifest["source"]["path"])
    text = source_path.read_text(encoding="utf-8")
    metadata = manifest.get("metadata") or {}
    title = str(metadata.get("title") or manifest["document_id"])
    use_cjk = bool(CJK.search(text + title))
    st = _styles(use_cjk)

    story = [Paragraph(_escape(title), st["title"])]
    paragraph: list[str] = []
    bullets: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            story.append(Paragraph(_escape(" ".join(paragraph)), st["body"]))
            paragraph = []

    def flush_bullets() -> None:
        nonlocal bullets
        if bullets:
            story.append(ListFlowable([ListItem(Paragraph(_escape(x), st["bullet"])) for x in bullets], bulletType="bullet", leftIndent=14, spaceAfter=3 * mm))
            bullets = []

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            flush_paragraph(); flush_bullets(); continue
        if line == "---":
            flush_paragraph(); flush_bullets()
            story.extend([Spacer(1, 1 * mm), HRFlowable(width="100%", thickness=0.45, color=colors.HexColor("#D6DCE5")), Spacer(1, 1 * mm)])
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        if heading:
            flush_paragraph(); flush_bullets()
            level = len(heading.group(1))
            story.append(Paragraph(_escape(heading.group(2)), st[f"h{level}"]))
            continue
        bullet = re.match(r"^[-*]\s+(.*)$", line)
        if bullet:
            flush_paragraph()
            bullets.append(bullet.group(1))
            continue
        flush_bullets()
        paragraph.append(line)
    flush_paragraph(); flush_bullets()

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(output_pdf), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=17 * mm, bottomMargin=17 * mm, title=title, author="PDF Production Engine")
    doc.build(story)


def build_command(root: Path, manifest: dict, output_pdf: Path, output_dir: Path) -> Path:
    backend = manifest["backend"]
    cwd = _safe_relative(root, backend.get("cwd", "."))
    values = {
        "root": str(root.resolve()),
        "output_pdf": str(output_pdf.resolve()),
        "output_dir": str(output_dir.resolve()),
    }
    argv = [token.format(**values) for token in backend["command"]]
    proc = subprocess.run(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (output_dir / "backend.log").write_text(proc.stdout or "", encoding="utf-8")
    print(f"backend command exit={proc.returncode}; detailed stdout/stderr saved to backend.log")
    if proc.returncode:
        raise SystemExit(proc.returncode)
    if not output_pdf.is_file():
        produced = backend.get("produced_pdf")
        if produced:
            produced_path = _safe_relative(root, produced.format(**values))
            if produced_path.is_file():
                output_pdf.write_bytes(produced_path.read_bytes())
    if not output_pdf.is_file():
        raise ManifestError(f"command backend did not produce expected PDF: {output_pdf}")
    return output_pdf


def preflight_and_render(pdf_path: Path, render_dir: Path, dpi: int) -> dict:
    render_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    if doc.page_count <= 0:
        raise ManifestError("PDF has zero pages")
    pages = []
    matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    for index in range(doc.page_count):
        page = doc.load_page(index)
        rect = page.rect
        if rect.width <= 0 or rect.height <= 0:
            raise ManifestError(f"invalid page geometry at page {index + 1}")
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        render_path = render_dir / f"page-{index + 1:04d}.png"
        pix.save(render_path)
        pages.append({
            "page": index + 1,
            "width_pt": round(rect.width, 2),
            "height_pt": round(rect.height, 2),
            "render": render_path.name,
            "render_sha256": _sha256(render_path),
            "text_chars": len(page.get_text("text")),
        })
    doc.close()
    if len(list(render_dir.glob("page-*.png"))) != len(pages):
        raise ManifestError("render count does not equal PDF page count")
    return {"page_count": len(pages), "rendered_page_count": len(pages), "dpi": dpi, "pages": pages}


def build(root: Path, manifest_relative: str, out_root: Path, dpi: int = 144) -> Path:
    root = root.resolve()
    manifest, manifest_path = load_manifest(root, manifest_relative)
    document_id = manifest["document_id"]
    out_dir = (out_root.resolve() / document_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / manifest["output"]["filename"]

    if manifest["backend"]["type"] == "markdown-reportlab":
        build_markdown_reportlab(root, manifest, pdf_path)
    else:
        build_command(root, manifest, pdf_path, out_dir)

    if not pdf_path.is_file() or pdf_path.stat().st_size < 100:
        raise ManifestError("PDF missing or implausibly small")

    qa = preflight_and_render(pdf_path, out_dir / "rendered", dpi)
    evidence = {
        "engine": "PDF-Production-Engine",
        "engine_version": __version__,
        "status": "MACHINE_PASS",
        "visual_status": "HUMAN_PIXEL_CONFIRMATION_REQUIRED",
        "built_at": datetime.now(timezone.utc).isoformat(),
        "document_id": document_id,
        "backend": manifest["backend"]["type"],
        "source_manifest": str(manifest_path.relative_to(root)),
        "pdf": {
            "filename": pdf_path.name,
            "size_bytes": pdf_path.stat().st_size,
            "sha256": _sha256(pdf_path),
        },
        "qa": qa,
    }
    evidence_path = out_dir / "build-manifest.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PDF_ENGINE_MACHINE_PASS document={document_id} pages={qa['page_count']} sha256={evidence['pdf']['sha256']}")
    print("HUMAN_PIXEL_CONFIRMATION_REQUIRED: inspect every rendered page before visual acceptance")
    print(f"OUTPUT_DIR={out_dir}")
    return evidence_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-production")
    sub = parser.add_subparsers(dest="command", required=True)
    p_build = sub.add_parser("build", help="Build, preflight, render all pages, and emit evidence")
    p_build.add_argument("--root", type=Path, required=True)
    p_build.add_argument("--manifest", required=True, help="Manifest path relative to --root")
    p_build.add_argument("--out", type=Path, required=True)
    p_build.add_argument("--dpi", type=int, default=144)
    args = parser.parse_args(argv)
    try:
        if args.command == "build":
            if args.dpi < 72 or args.dpi > 300:
                raise ManifestError("dpi must be between 72 and 300")
            build(args.root, args.manifest, args.out, args.dpi)
            return 0
    except ManifestError as exc:
        print(f"PDF_ENGINE_FAIL: {exc}", file=sys.stderr)
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
