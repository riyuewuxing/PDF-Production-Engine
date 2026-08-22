from pathlib import Path

import pytest

from pdf_production_engine.latex_build import (
    LatexBuildError,
    _safe_output,
    _safe_source,
    build_latex_pdf,
    resolve_xelatex_binary,
)


def test_source_must_exist_and_be_tex(tmp_path: Path):
    missing = tmp_path / "missing.tex"
    with pytest.raises(LatexBuildError, match="does not exist"):
        _safe_source(missing)

    wrong = tmp_path / "source.typ"
    wrong.write_text("hello", encoding="utf-8")
    with pytest.raises(LatexBuildError, match="must be a .tex"):
        _safe_source(wrong)


def test_output_must_be_pdf(tmp_path: Path):
    with pytest.raises(LatexBuildError, match="must be a .pdf"):
        _safe_output(tmp_path / "out.txt")


def test_missing_explicit_xelatex_binary_is_visible(tmp_path: Path):
    with pytest.raises(LatexBuildError, match="XeLaTeX not found"):
        resolve_xelatex_binary(str(tmp_path / "definitely-not-xelatex"))


def test_source_must_be_inside_declared_root(tmp_path: Path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside.tex"
    outside.write_text("\\documentclass{article}\\begin{document}x\\end{document}", encoding="utf-8")
    fake_xelatex = tmp_path / "xelatex"
    fake_xelatex.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_xelatex.chmod(0o755)

    with pytest.raises(LatexBuildError, match="contained inside"):
        build_latex_pdf(outside, root / "out.pdf", root=root, xelatex_bin=str(fake_xelatex))


def test_pass_count_is_bounded(tmp_path: Path):
    source = tmp_path / "source.tex"
    source.write_text("\\documentclass{article}\\begin{document}x\\end{document}", encoding="utf-8")
    fake_xelatex = tmp_path / "xelatex"
    fake_xelatex.write_text("#!/bin/sh\necho fake xelatex\nexit 0\n", encoding="utf-8")
    fake_xelatex.chmod(0o755)

    with pytest.raises(LatexBuildError, match="between 1 and 4"):
        build_latex_pdf(source, tmp_path / "out.pdf", root=tmp_path, xelatex_bin=str(fake_xelatex), passes=0)
