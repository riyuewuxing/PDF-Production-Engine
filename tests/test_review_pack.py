from __future__ import annotations

import json
from pathlib import Path

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from pdf_production_engine.review_pack import ReviewPackError, build_review_pack


def _make_pdf(path: Path, *, sparse_middle: bool = False) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    for i in range(36):
        c.drawString(72, 790 - i * 17, f'normal line {i}')
    c.showPage()
    if sparse_middle:
        c.drawString(72, 790, 'isolated heading')
    else:
        for i in range(18):
            c.drawString(72, 790 - i * 24, f'medium line {i}')
    c.showPage()
    for i in range(12):
        c.drawString(72, 790 - i * 28, f'last line {i}')
    c.showPage()
    c.save()


def test_review_pack_renders_every_page_and_warns_sparse_page(tmp_path: Path) -> None:
    pdf = tmp_path / 'sample.pdf'
    _make_pdf(pdf, sparse_middle=True)
    evidence_path = build_review_pack([pdf], tmp_path / 'review', dpi=96, sheet_cols=2, sheet_rows=2)
    data = json.loads(evidence_path.read_text(encoding='utf-8'))
    assert data['capability'] == 'final-review-pack-v1'
    assert data['status'] == 'MACHINE_PASS'
    assert data['visual_status'] == 'HUMAN_REVIEW_REQUIRED'
    assert data['document_count'] == 1
    assert data['total_page_count'] == 3
    assert data['total_rendered_page_count'] == 3

    document = data['documents'][0]
    assert document['page_count'] == document['rendered_page_count'] == 3
    assert len(document['sha256']) == 64
    assert document['preflight_backend'] == 'PyMuPDF'
    assert document['render_backend'] == 'PDFium'
    assert any(item['page'] == 2 for item in document['occupancy_warnings'])
    assert all(len(page['render_sha256']) == 64 for page in document['pages'])
    assert len(document['contact_sheets']) == 1
    assert (tmp_path / 'review' / document['document_id'] / 'contact-sheet-001.png').is_file()
    assert 'Every page below still requires human visual review.' in (tmp_path / 'review' / 'review-index.md').read_text(encoding='utf-8')


def test_review_pack_batches_multiple_pdfs(tmp_path: Path) -> None:
    first = tmp_path / 'first.pdf'
    second = tmp_path / '第二份.pdf'
    _make_pdf(first)
    _make_pdf(second)
    evidence = json.loads(build_review_pack([first, second], tmp_path / 'review', dpi=72).read_text(encoding='utf-8'))
    assert evidence['document_count'] == 2
    assert evidence['total_page_count'] == 6
    assert evidence['total_rendered_page_count'] == 6
    assert len({doc['document_id'] for doc in evidence['documents']}) == 2


def test_review_pack_rejects_invalid_dpi(tmp_path: Path) -> None:
    pdf = tmp_path / 'sample.pdf'
    _make_pdf(pdf)
    with pytest.raises(ReviewPackError):
        build_review_pack([pdf], tmp_path / 'review', dpi=30)
