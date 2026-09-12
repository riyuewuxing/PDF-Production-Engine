"""Structure-bound Teaching Demo publisher primitive facade.

This module exposes product/render/source primitives only.  It deliberately has no
complete manifest-to-product ``main`` and no CLI.  Complete PDF composition belongs
to ``build_current_run.py`` under the accepted-content precondition.
"""
from __future__ import annotations

import re
from pathlib import Path

import publisher_core_legacy as _core
from board_contract import board_fragment, fragment_map

BASELINE_TEMPLATE = _core.ROOT / 'production/templates/teacher_teaching_demo/user-latex-baseline-v2.tex'
registered_figure_tex = _core.registered_figure_tex


def __getattr__(name: str):
    """Delegate mature primitive API and mutable routing globals to the primitive core."""
    if name == 'main':
        raise AttributeError('publisher_core has no complete product build capability; use build_current_run.build')
    return getattr(_core, name)


def baseline_template_text() -> str:
    if not BASELINE_TEMPLATE.exists():
        raise _core.ProductContractError(
            f'LaTeX baseline template missing: {BASELINE_TEMPLATE.relative_to(_core.ROOT)}'
        )
    text = BASELINE_TEMPLATE.read_text(encoding='utf-8')
    required = [
        r'\documentclass[UTF8,10pt]{article}',
        r'\usepackage[fontset=fandol]{ctex}',
        r'\geometry{a4paper,left=2.5cm,right=2.5cm,top=2.5cm,bottom=2.5cm}',
        r'\linespread{1.6}',
        r'\newcommand{\step}',
        r'\newcommand{\action}',
        r'\newtcolorbox{boardbox}',
        r'\newtcolorbox{totalboard}',
        r'\newenvironment{figurepanel}',
        '@@QZ_HEADER_KIND@@',
        r'\begin{document}',
    ]
    missing = [token for token in required if token not in text]
    if missing:
        raise _core.ProductContractError(f'LaTeX baseline template invariant missing: {missing}')
    return text


def preamble(case_id: str, kind: str, compact: bool = False) -> str:
    del case_id, compact
    return baseline_template_text().replace('@@QZ_HEADER_KIND@@', _core.latex_inline(kind))


def doc_title(title: str, subtitle: str) -> str:
    del subtitle
    return '\\section*{' + _core.latex_inline(title) + '}\n'


def figure_tex(name: str) -> str:
    return registered_figure_tex(name)


def _board_box(label: str, text: str) -> str:
    return (
        r'\action{转身板书}' + '\n'
        + r'\begin{boardbox}' + '\n'
        + r'\small\textbf{' + _core.latex_inline(label) + r'}\quad '
        + _core.latex_inline(text) + '\n'
        + r'\end{boardbox}' + '\n'
    )


def render_md(
    md: str,
    board_case: dict | None = None,
    consume_board_markers: bool = False,
    nested: bool = False,
    layout_role: str | None = None,
) -> str:
    del nested
    lines = md.splitlines()
    out: list[str] = []
    in_list = False
    i = 0

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            out.append('\\end{itemize}\n')
            in_list = False

    while i < len(lines):
        s = lines[i].strip()
        if not s or s.startswith('# '):
            close_list(); i += 1; continue

        marker = re.fullmatch(r'\[\[BOARD:([PB]\d+)\]\]', s)
        if marker and consume_board_markers:
            close_list()
            if not board_case:
                raise SystemExit('board marker encountered without BOARD_PLAN')
            _, label, text = board_fragment(board_case, marker.group(1))
            out.append(_board_box(label, text)); i += 1; continue

        fig = re.fullmatch(r'\[\[FIGURE:([a-z0-9-]+)\]\]', s)
        if fig:
            close_list(); out.append(figure_tex(fig.group(1))); i += 1; continue

        if s.startswith('> '):
            close_list(); quoted: list[str] = []
            while i < len(lines) and lines[i].strip().startswith('> '):
                quoted.append(lines[i].strip()[2:].strip()); i += 1
            title = '训练提示'
            if quoted and re.fullmatch(r'\[.+\]', quoted[0]):
                title = quoted.pop(0)[1:-1]
            out.append(r'\begin{notebox}' + '\n')
            out.append(r'\textbf{' + _core.latex_inline(title) + r'}\par' + '\n')
            for q in quoted:
                out.append(_core.latex_inline(q) + r'\par' + '\n')
            out.append(r'\end{notebox}' + '\n')
            continue

        if s.startswith('## '):
            close_list(); out.append(r'\step{' + _core.latex_inline(s[3:]) + '}\n'); i += 1; continue
        if s.startswith('### '):
            close_list()
            cmd = 'qaquestion' if layout_role == 'defense' else 'step'
            out.append('\\' + cmd + '{' + _core.latex_inline(s[4:]) + '}\n')
            i += 1; continue
        if s.startswith('#### '):
            close_list(); out.append(r'\par\medskip\noindent\textbf{' + _core.latex_inline(s[5:]) + r'}\par\smallskip' + '\n'); i += 1; continue

        if s.startswith('- '):
            if not in_list:
                out.append('\\begin{itemize}\n'); in_list = True
            out.append('\\item ' + _core.latex_inline(s[2:]) + '\n'); i += 1; continue

        close_list()
        out.append(_core.latex_inline(s) + '\n\n')
        i += 1

    close_list()
    return ''.join(out)


def _board_fragment_rows(board_case: dict) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for item in fragment_map(board_case).values():
        label, text = item['label'], item['text']
        if text:
            rows.append((label, text))
    return rows


def total_board(board_case: dict, title: str = '总板书', compact: bool = False) -> str:
    del compact
    chunks: list[str] = []
    for label, text in _board_fragment_rows(board_case):
        chunks.append(
            r'\textbf{' + _core.latex_inline(label) + r'}\quad '
            + _core.latex_inline(text) + r'\par\vspace{5pt}' + '\n'
        )
    return (
        r'\step{板书设计（总板书）}' + '\n'
        + r'\begin{totalboard}{' + _core.latex_inline(title) + '}' + '\n'
        + r'\raggedright\small' + '\n'
        + ''.join(chunks)
        + r'\end{totalboard}' + '\n'
    )


def source_pages_tex(cfg: dict, pages, heading: str) -> str:
    printed = list(cfg['input']['printed_pages'])
    chunks = [r'\qzsection{' + _core.latex_inline(heading) + '}' + '\n']
    chunks.append(
        r'\noindent{\small\color{muted} 本次教学边界：'
        + _core.latex_inline(cfg['input']['book']) + '，印刷页 '
        + _core.latex_inline('-'.join(map(str, printed))) + r'。}\par\medskip' + '\n'
    )
    for start in range(0, len(pages), 2):
        pair = pages[start:start + 2]
        chunks.append(r'\begin{center}' + '\n')
        for j, page in enumerate(pair):
            idx = start + j
            page_label = str(printed[idx]) if idx < len(printed) else str(idx + 1)
            path = Path(page).resolve().as_posix()
            if j:
                chunks.append(r'\hfill' + '\n')
            width = '0.485\\textwidth' if len(pair) == 2 else '0.72\\textwidth'
            chunks.append(r'\begin{minipage}[t]{' + width + '}' + '\n')
            chunks.append(r'\centering\includegraphics[width=\linewidth,keepaspectratio,trim=18 18 18 18,clip]{\detokenize{' + path + '}}' + '\n')
            chunks.append(r'\par\vspace{2pt}{\scriptsize 教材印刷页 ' + _core.latex_inline(page_label) + '}' + '\n')
            chunks.append(r'\end{minipage}' + '\n')
        chunks.append(r'\end{center}' + '\n')
        if start + 2 < len(pages):
            chunks.append(r'\newpage' + '\n')
    return ''.join(chunks)


def document_tex(cfg: dict, contract: dict, doc_role: str, workspace, board_case: dict, pages) -> str:
    doc = _core.contract_document(contract, doc_role)
    title = cfg['title']
    out = [
        preamble(cfg.get('case_id', ''), str(doc['header_kind'])),
        doc_title(f"{title}｜{doc['title_suffix']}", str(doc['subtitle'])),
    ]
    sections = doc.get('sections')
    if sections:
        for idx, section in enumerate(sections):
            if idx:
                out.append(r'\newpage' + '\n')
            renderer = section['renderer']
            heading = str(section['heading'])
            if renderer == 'source_pages':
                out.append(source_pages_tex(cfg, pages, heading))
                continue
            source_role = section['source_role']
            md = (workspace / cfg['source'][source_role]).read_text(encoding='utf-8')
            out.append(r'\qzsection{' + _core.latex_inline(heading) + '}' + '\n')
            out.append(render_md(
                md,
                board_case,
                bool(section.get('consume_board_markers')),
                nested=True,
                layout_role=source_role,
            ))
            if section.get('include_total_board'):
                out.append(total_board(board_case, title))
    else:
        source_role = doc['source_role']
        md = (workspace / cfg['source'][source_role]).read_text(encoding='utf-8')
        out.append(render_md(md, nested=True, layout_role=source_role))
    out.append('\\end{document}\n')
    return ''.join(out)


def training_tex(cfg, workspace: Path, board_case: dict, pages):
    contract = _core.load_product_contract(cfg)
    role, _ = _core.contract_document_for_deliverable(contract, (contract.get('qa') or {}).get('training_deliverable_role'))
    return document_tex(cfg, contract, role, workspace, board_case, pages)


def analysis_tex(cfg, workspace: Path):
    contract = _core.load_product_contract(cfg)
    role, _ = _core.contract_document_for_deliverable(contract, (contract.get('qa') or {}).get('extraction_deliverable_role'))
    return document_tex(cfg, contract, role, workspace, {}, [])


def publisher_template_selftest() -> None:
    rendered = preamble('synthetic-case', '模板自检')
    checks = [
        (r'\usepackage[fontset=fandol]{ctex}', 'Fandol ctex fontset'),
        (r'\linespread{1.6}', '1.6 line spacing'),
        (r'\newcommand{\step}', 'step macro'),
        (r'\newcommand{\action}', 'action macro'),
    ]
    for token, label in checks:
        if token not in rendered:
            raise AssertionError(f'user LaTeX structural baseline drifted: {label}')
    sample = render_md('## （二）新课讲授\n### 1. 核心问题\n正文。\n', nested=True, layout_role='trial')
    if sample.count(r'\step{') != 2 or r'\qzminor' in sample:
        raise AssertionError('Markdown headings no longer inherit user step grammar')
    if r'\sffamily' in sample:
        raise AssertionError('report-style sans heading leaked into user grammar')
    board = {
        'route': ['不应出现'],
        'fragments': {
            'B0': {'point_id': 'P0', 'label': '问题', 'text': '为什么？'},
            'B1': {'point_id': 'P1', 'label': '1. 实验', 'text': '固定量/改变量/测量量'},
            'B2': {'point_id': 'P1', 'label': '1. 实验（续）', 'text': '安全条件'},
        },
    }
    tb = total_board(board, '测试课题')
    if '不应出现' in tb or '问题' not in tb or '安全条件' not in tb:
        raise AssertionError('total board is not the exact composition of trial fragments')
    rendered_board = render_md('[[BOARD:B1]]\n[[BOARD:B2]]\n', board, True, layout_role='trial')
    if rendered_board.count(r'\begin{boardbox}') != 2:
        raise AssertionError('multiple board fragments for one point are not rendered independently')
    two_up = source_pages_tex(
        {'input': {'printed_pages': [1, 2], 'book': '教材'}},
        [Path('/tmp/a.png'), Path('/tmp/b.png')],
        '教材',
    )
    if two_up.count(r'\begin{minipage}') != 2 or r'\newpage' in two_up:
        raise AssertionError('two source pages must share one training page')


_primitive_resolve_source_pages = _core.resolve_source_pages


def resolve_source_pages(cfg: dict, workspace: Path):
    source = (cfg.get('input') or {}).get('source_pages') or {}
    if source.get('mode') != 'repository-pdf':
        return _primitive_resolve_source_pages(cfg, workspace)
    raw = source.get('file')
    if not isinstance(raw, str) or not raw or Path(raw).is_absolute() or '..' in Path(raw).parts:
        raise SystemExit(f'invalid repository textbook path: {raw!r}')
    pdf = (_core.ROOT / raw).resolve()
    try:
        pdf.relative_to(_core.ROOT.resolve())
    except ValueError as exc:
        raise SystemExit(f'repository textbook escapes root: {raw}') from exc
    if not pdf.is_file():
        raise SystemExit(f'repository textbook missing: {raw}')
    with pdf.open('rb') as fh:
        if fh.read(4) != b'%PDF':
            raise SystemExit(f'repository textbook is not a PDF: {raw}')
    expected_size = source.get('size_bytes')
    actual_size = pdf.stat().st_size
    if not isinstance(expected_size, int) or actual_size != expected_size:
        raise SystemExit(f'repository textbook size mismatch: expected {expected_size}, got {actual_size}')
    expected_blob = source.get('blob_sha')
    if not isinstance(expected_blob, str) or not re.fullmatch(r'[0-9a-f]{40}', expected_blob):
        raise SystemExit('repository textbook blob_sha invalid')
    actual_blob = _core._git_blob_sha(pdf)
    if actual_blob != expected_blob:
        raise SystemExit(f'repository textbook blob mismatch: expected {expected_blob}, got {actual_blob}')
    selected = source.get('pages')
    if not isinstance(selected, list) or not selected or not all(isinstance(x, int) and x > 0 for x in selected):
        raise SystemExit('repository textbook pages invalid')
    pages = _core._render_pdf_pages(pdf, selected, expected_blob[:16])
    return pages, {
        'resolution': 'repository-pdf',
        'canonical_source': True,
        'configured_mode': 'repository-pdf',
        'page_count': len(pages),
        'repository_path': raw,
        'expected_blob_sha': expected_blob,
        'actual_blob_sha': actual_blob,
        'size_bytes': actual_size,
    }
