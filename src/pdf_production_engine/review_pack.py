from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import fitz
import pypdfium2 as pdfium
from PIL import Image, ImageDraw


class ReviewPackError(ValueError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_doc_id(index: int, path: Path) -> str:
    stem = re.sub(r'[^A-Za-z0-9._-]+', '-', path.stem).strip('-_.')
    if not stem:
        stem = 'pdf'
    return f'{index:03d}-{stem[:48]}'


def _page_occupancy(image: Image.Image) -> dict:
    gray = image.convert('L')
    width, height = gray.size
    # Ignore common header/footer and edge margins. This is a warning heuristic,
    # never a visual-acceptance decision.
    crop = gray.crop((int(width * 0.05), int(height * 0.08), int(width * 0.95), int(height * 0.92)))
    crop.thumbnail((256, 256), Image.Resampling.LANCZOS)
    w, h = crop.size
    hist = crop.histogram()
    total = max(1, sum(hist))
    ink = sum(hist[:245])
    ink_fraction = ink / total

    mask = crop.point(lambda p: 255 if p < 245 else 0)
    bbox = mask.getbbox()
    if bbox:
        left, top, right, bottom = bbox
        bbox_area_fraction = ((right - left) * (bottom - top)) / max(1, w * h)
        bbox_height_fraction = (bottom - top) / max(1, h)
        bbox_width_fraction = (right - left) / max(1, w)
    else:
        bbox_area_fraction = 0.0
        bbox_height_fraction = 0.0
        bbox_width_fraction = 0.0

    # Row/column activity is more robust than bbox when a footer/header would
    # otherwise stretch the content bounds.
    pixels = mask.load()
    active_rows = 0
    for y in range(h):
        dark = sum(1 for x in range(w) if pixels[x, y])
        if dark >= max(1, int(w * 0.01)):
            active_rows += 1
    active_cols = 0
    for x in range(w):
        dark = sum(1 for y in range(h) if pixels[x, y])
        if dark >= max(1, int(h * 0.01)):
            active_cols += 1
    active_row_fraction = active_rows / max(1, h)
    active_col_fraction = active_cols / max(1, w)

    warnings: list[str] = []
    if ink_fraction < 0.003:
        warnings.append('NEAR_EMPTY_PAGE')
    elif ink_fraction < 0.018 and active_row_fraction < 0.11:
        warnings.append('LOW_PAGE_OCCUPANCY')
    elif ink_fraction < 0.028 and active_row_fraction < 0.075:
        warnings.append('ISOLATED_CONTENT_BAND')

    return {
        'analysis_region': '5%-95% width, 8%-92% height',
        'ink_threshold_gray_lt': 245,
        'ink_fraction': round(ink_fraction, 5),
        'bbox_area_fraction': round(bbox_area_fraction, 5),
        'bbox_height_fraction': round(bbox_height_fraction, 5),
        'bbox_width_fraction': round(bbox_width_fraction, 5),
        'active_row_fraction': round(active_row_fraction, 5),
        'active_col_fraction': round(active_col_fraction, 5),
        'warnings': warnings,
    }


def _font_summary(doc: fitz.Document) -> list[dict]:
    fonts: dict[tuple[int, str, str], dict] = {}
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        for font in page.get_fonts(full=True):
            xref = int(font[0])
            ext = str(font[1])
            font_type = str(font[2])
            basefont = str(font[3])
            key = (xref, basefont, font_type)
            item = fonts.setdefault(key, {
                'xref': xref,
                'basefont': basefont,
                'type': font_type,
                'extension': ext,
                'pages': [],
                'embedded': None,
            })
            item['pages'].append(page_index + 1)
    for (xref, _basefont, _type), item in fonts.items():
        if xref <= 0:
            item['embedded'] = False
            continue
        try:
            extracted = doc.extract_font(xref)
            item['embedded'] = bool(extracted and len(extracted) >= 4 and extracted[3])
        except Exception:
            item['embedded'] = None
        item['pages'] = sorted(set(item['pages']))
    return sorted(fonts.values(), key=lambda x: (x['basefont'], x['xref']))


def _make_contact_sheets(render_paths: list[Path], out_dir: Path, cols: int, rows: int) -> list[Path]:
    if cols < 1 or rows < 1:
        raise ReviewPackError('contact-sheet cols/rows must be >= 1')
    per_sheet = cols * rows
    sheets: list[Path] = []
    thumb_w = 220
    label_h = 24
    gap = 12
    margin = 16
    for sheet_index, start in enumerate(range(0, len(render_paths), per_sheet), 1):
        batch = render_paths[start:start + per_sheet]
        opened = [Image.open(path).convert('RGB') for path in batch]
        try:
            ratios = [im.height / max(1, im.width) for im in opened]
            thumb_h = max(120, min(340, int(thumb_w * max(ratios))))
            cell_w = thumb_w + gap
            cell_h = thumb_h + label_h + gap
            canvas = Image.new('RGB', (margin * 2 + cols * cell_w, margin * 2 + rows * cell_h), 'white')
            draw = ImageDraw.Draw(canvas)
            for local_index, (path, im) in enumerate(zip(batch, opened)):
                page_num = start + local_index + 1
                copy = im.copy()
                copy.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                col = local_index % cols
                row = local_index // cols
                x = margin + col * cell_w + (thumb_w - copy.width) // 2
                y = margin + row * cell_h + label_h
                draw.text((margin + col * cell_w, margin + row * cell_h), f'page {page_num}', fill='black')
                canvas.paste(copy, (x, y))
            sheet = out_dir / f'contact-sheet-{sheet_index:03d}.png'
            canvas.save(sheet, format='PNG')
            sheets.append(sheet)
        finally:
            for im in opened:
                im.close()
    return sheets


def review_pdf(pdf_path: Path, out_dir: Path, *, dpi: int, sheet_cols: int, sheet_rows: int) -> dict:
    if not pdf_path.is_file():
        raise ReviewPackError(f'PDF not found: {pdf_path}')
    if pdf_path.read_bytes()[:4] != b'%PDF':
        raise ReviewPackError(f'not a PDF: {pdf_path}')
    out_dir.mkdir(parents=True, exist_ok=True)
    render_dir = out_dir / 'rendered'
    render_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    if doc.page_count <= 0:
        doc.close()
        raise ReviewPackError(f'PDF has zero pages: {pdf_path}')
    metadata = dict(doc.metadata or {})
    pages: list[dict] = []
    for index in range(doc.page_count):
        page = doc.load_page(index)
        rect = page.rect
        if rect.width <= 0 or rect.height <= 0:
            doc.close()
            raise ReviewPackError(f'invalid geometry: {pdf_path} page {index + 1}')
        pages.append({
            'page': index + 1,
            'width_pt': round(rect.width, 2),
            'height_pt': round(rect.height, 2),
            'text_chars': len(page.get_text('text')),
        })
    fonts = _font_summary(doc)
    doc.close()

    render_doc = pdfium.PdfDocument(str(pdf_path))
    if len(render_doc) != len(pages):
        render_doc.close()
        raise ReviewPackError(f'preflight/render page-count disagreement: {pdf_path}')
    scale = dpi / 72.0
    render_paths: list[Path] = []
    for index, page_meta in enumerate(pages):
        page = render_doc[index]
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil()
        render_path = render_dir / f'page-{index + 1:04d}.png'
        image.save(render_path, format='PNG')
        page_meta['render'] = str(render_path.relative_to(out_dir))
        page_meta['render_sha256'] = _sha256(render_path)
        page_meta['occupancy'] = _page_occupancy(image)
        render_paths.append(render_path)
        image.close()
        bitmap.close()
        page.close()
    render_doc.close()

    sheets = _make_contact_sheets(render_paths, out_dir, sheet_cols, sheet_rows)
    warnings = [
        {'page': page['page'], 'codes': page['occupancy']['warnings']}
        for page in pages if page['occupancy']['warnings']
    ]
    return {
        'filename': pdf_path.name,
        'size_bytes': pdf_path.stat().st_size,
        'sha256': _sha256(pdf_path),
        'page_count': len(pages),
        'rendered_page_count': len(render_paths),
        'dpi': dpi,
        'preflight_backend': 'PyMuPDF',
        'render_backend': 'PDFium',
        'metadata': metadata,
        'fonts': fonts,
        'pages': pages,
        'occupancy_warnings': warnings,
        'contact_sheets': [
            {'path': sheet.name, 'sha256': _sha256(sheet)} for sheet in sheets
        ],
    }


def build_review_pack(pdf_paths: Iterable[Path], out_dir: Path, *, dpi: int = 200, sheet_cols: int = 4, sheet_rows: int = 5) -> Path:
    paths = [Path(p).resolve() for p in pdf_paths]
    if not paths:
        raise ReviewPackError('at least one PDF is required')
    if dpi < 72 or dpi > 300:
        raise ReviewPackError('dpi must be between 72 and 300')
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    documents = []
    for index, pdf_path in enumerate(paths, 1):
        doc_id = _safe_doc_id(index, pdf_path)
        doc_out = out_dir / doc_id
        result = review_pdf(pdf_path, doc_out, dpi=dpi, sheet_cols=sheet_cols, sheet_rows=sheet_rows)
        result['document_id'] = doc_id
        result['source_path'] = str(pdf_path)
        documents.append(result)

    evidence = {
        'engine': 'PDF-Production-Engine',
        'capability': 'final-review-pack-v1',
        'status': 'MACHINE_PASS',
        'visual_status': 'HUMAN_REVIEW_REQUIRED',
        'built_at': datetime.now(timezone.utc).isoformat(),
        'document_count': len(documents),
        'total_page_count': sum(d['page_count'] for d in documents),
        'total_rendered_page_count': sum(d['rendered_page_count'] for d in documents),
        'documents': documents,
    }
    evidence_path = out_dir / 'review-pack.json'
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lines = [
        '# PDF Final Review Pack',
        '',
        'Status: MACHINE_PASS / HUMAN_REVIEW_REQUIRED',
        f"Documents: {evidence['document_count']}; pages: {evidence['total_page_count']}",
        '',
    ]
    for document in documents:
        lines.extend([
            f"## {document['filename']}",
            '',
            f"- SHA-256: `{document['sha256']}`",
            f"- Pages: {document['page_count']}; rendered: {document['rendered_page_count']}; DPI: {document['dpi']}",
            f"- Occupancy warnings: {len(document['occupancy_warnings'])}",
            '- Every page below still requires human visual review.',
            '',
        ])
        for page in document['pages']:
            codes = ','.join(page['occupancy']['warnings']) or 'none'
            lines.append(f"- page {page['page']:04d}: `{document['document_id']}/{page['render']}`; warnings={codes}; render_sha256={page['render_sha256']}")
        lines.append('')
    (out_dir / 'review-index.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return evidence_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog='pdf-review-pack')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--dpi', type=int, default=200)
    parser.add_argument('--sheet-cols', type=int, default=4)
    parser.add_argument('--sheet-rows', type=int, default=5)
    parser.add_argument('pdf', nargs='+', type=Path)
    args = parser.parse_args(argv)
    try:
        evidence = build_review_pack(args.pdf, args.out, dpi=args.dpi, sheet_cols=args.sheet_cols, sheet_rows=args.sheet_rows)
    except ReviewPackError as exc:
        print(f'PDF_REVIEW_PACK_FAIL: {exc}')
        return 2
    print(f'PDF_REVIEW_PACK_MACHINE_PASS evidence={evidence}')
    print('HUMAN_REVIEW_REQUIRED: open every rendered final page before REVIEW_PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
