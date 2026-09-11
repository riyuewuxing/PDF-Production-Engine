from pathlib import Path

import pytest

from pdf_production_engine.typst_build import TypstBuildError, _safe_output, _safe_source, build_typst_pdf, resolve_typst_binary


def test_source_must_exist_and_be_typ(tmp_path: Path):
    missing = tmp_path / 'missing.typ'
    with pytest.raises(TypstBuildError, match='does not exist'):
        _safe_source(missing)

    wrong = tmp_path / 'source.txt'
    wrong.write_text('hello', encoding='utf-8')
    with pytest.raises(TypstBuildError, match='must be a .typ'):
        _safe_source(wrong)


def test_output_must_be_pdf(tmp_path: Path):
    with pytest.raises(TypstBuildError, match='must be a .pdf'):
        _safe_output(tmp_path / 'out.txt')


def test_missing_explicit_typst_binary_is_visible(tmp_path: Path):
    with pytest.raises(TypstBuildError, match='Typst CLI not found'):
        resolve_typst_binary(str(tmp_path / 'definitely-not-typst'))


def test_source_must_be_inside_declared_root(tmp_path: Path):
    root = tmp_path / 'root'
    root.mkdir()
    outside = tmp_path / 'outside.typ'
    outside.write_text('= outside\n', encoding='utf-8')
    fake_typst = tmp_path / 'typst'
    fake_typst.write_text('#!/bin/sh\nexit 0\n', encoding='utf-8')
    fake_typst.chmod(0o755)

    with pytest.raises(TypstBuildError, match='contained inside'):
        build_typst_pdf(outside, root / 'out.pdf', root=root, typst_bin=str(fake_typst))
