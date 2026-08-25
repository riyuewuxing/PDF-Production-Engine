"""Topic-agnostic PDF publisher core for teacher teaching-demo products.

Lesson semantics live in manifests/Markdown/BOARD_PLAN/declarative figure assets.
Document structure and shared publication/QA policy live in a product-contract YAML.
This module contains no lesson title, case id, topic formula alias or figure branch.
"""
from __future__ import annotations

from pathlib import Path
import argparse
import copy
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request

import yaml
from pypdf import PdfReader

from latex_inline import render_inline
from physics_figures import figure_tex as registered_figure_tex

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'production/current-run.yaml'
OUT_PDF = ROOT / 'outputs/current-run'
OUT_TEX = ROOT / 'outputs/current-run-tex'
CACHE = ROOT / 'production/current-run/.source-cache'
CONTRACT_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
ALLOWED_SECTION_RENDERERS = {'source_pages', 'markdown'}

def configure_manifest(manifest_path: str | Path) -> dict:
    """Apply safe repo-relative workspace/output routing; legacy defaults remain."""
    global MANIFEST, OUT_PDF, OUT_TEX, CACHE
    p = Path(manifest_path)
    if p.is_absolute():
        raise ProductContractError("manifest must be repository-relative")
    p = (ROOT / p).resolve()
    if ROOT != p and ROOT not in p.parents:
        raise ProductContractError("manifest escapes repository root")
    data = yaml.safe_load(p.read_text(encoding='utf-8')) or {}
    if data.get('version') != 1:
        raise ProductContractError("manifest version must be 1")
    def safe(raw, default):
        rel = str(raw or default)
        q = (ROOT / rel).resolve()
        if ROOT != q and ROOT not in q.parents:
            raise ProductContractError(f"manifest path escapes repository root: {rel}")
        return q
    MANIFEST = p
    OUT_PDF = safe(data.get('pdf_dir'), 'outputs/current-run')
    OUT_TEX = safe(data.get('tex_dir'), 'outputs/current-run-tex')
    CACHE = safe(data.get('cache_dir'), 'production/current-run/.source-cache')
    return data


class ProductContractError(ValueError):
    pass


def load_cfg():
    return yaml.safe_load(MANIFEST.read_text(encoding='utf-8'))


def contract_path(contract_id: str, root: Path = ROOT) -> Path:
    if not isinstance(contract_id, str) or not CONTRACT_ID_RE.fullmatch(contract_id):
        raise ProductContractError(f'invalid product_contract id: {contract_id!r}')
    return root / 'production/contracts' / f'{contract_id}.yaml'


def _is_nonempty_str(value) -> bool:
    return isinstance(value, str) and bool(value)


def validate_qa_role_contract(data: dict) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return errors
    documents = data.get('documents') or {}
    qa = data.get('qa') or {}
    if not isinstance(documents, dict) or not isinstance(qa, dict):
        return errors
    deliverable_to_docs: dict[str, list[str]] = {}
    section_to_docs: dict[str, list[str]] = {}
    section_specs: dict[str, list[dict]] = {}
    for doc_role, doc in documents.items():
        if not isinstance(doc, dict):
            continue
        deliverable = doc.get('deliverable_role')
        if _is_nonempty_str(deliverable):
            deliverable_to_docs.setdefault(deliverable, []).append(str(doc_role))
        for section in doc.get('sections') or []:
            if not isinstance(section, dict):
                continue
            role = section.get('role')
            if _is_nonempty_str(role):
                section_to_docs.setdefault(role, []).append(str(doc_role))
                section_specs.setdefault(role, []).append(section)
    for key, role in qa.items():
        if key.endswith('_deliverable_role'):
            if not _is_nonempty_str(role):
                errors.append(f'PRODUCT_QA_DELIVERABLE_ROLE_INVALID: {key}={role!r}')
                continue
            matches = deliverable_to_docs.get(role, [])
            if len(matches) != 1:
                errors.append(f'PRODUCT_QA_DELIVERABLE_ROLE_NOT_UNIQUE: {key}={role!r}: matches={matches}')
        elif key.endswith('_section_role'):
            if not _is_nonempty_str(role):
                errors.append(f'PRODUCT_QA_SECTION_ROLE_INVALID: {key}={role!r}')
                continue
            matches = section_to_docs.get(role, [])
            specs = section_specs.get(role, [])
            if len(matches) != 1 or len(specs) != 1:
                errors.append(f'PRODUCT_QA_SECTION_ROLE_NOT_UNIQUE: {key}={role!r}: matches={matches}')
                continue
            spec = specs[0]
            if spec.get('renderer') != 'markdown' or not spec.get('source_role'):
                errors.append(f'PRODUCT_QA_SECTION_ROLE_NOT_SOURCE_BACKED: {key}={role!r}')
    if 'required_training_section_roles' in qa:
        required = qa.get('required_training_section_roles')
        if not isinstance(required, list) or not all(_is_nonempty_str(x) for x in required):
            errors.append('PRODUCT_QA_REQUIRED_TRAINING_ROLES_INVALID')
        else:
            training_deliverable = qa.get('training_deliverable_role')
            training_docs = deliverable_to_docs.get(training_deliverable, []) if _is_nonempty_str(training_deliverable) else []
            training_doc = training_docs[0] if len(training_docs) == 1 else None
            for role in required:
                matches = section_to_docs.get(role, [])
                if len(matches) != 1:
                    errors.append(f'PRODUCT_QA_REQUIRED_TRAINING_ROLE_NOT_UNIQUE: {role}: matches={matches}')
                elif training_doc is not None and matches[0] != training_doc:
                    errors.append(f'PRODUCT_QA_REQUIRED_TRAINING_ROLE_CROSS_DOCUMENT: {role}: {matches[0]} != {training_doc}')
    tokens = qa.get('required_extraction_sections')
    if tokens is not None and (not isinstance(tokens, list) or not all(_is_nonempty_str(x) for x in tokens)):
        errors.append('PRODUCT_QA_EXTRACTION_SECTIONS_INVALID')
    return errors


def validate_policy_contract(data: dict) -> list[str]:
    errors: list[str] = []
    render = data.get('render') or {}
    if not isinstance(render, dict):
        errors.append('PRODUCT_RENDER_POLICY_NOT_MAPPING')
    else:
        dpi = render.get('dpi')
        if not isinstance(dpi, int) or not 150 <= dpi <= 600:
            errors.append(f'PRODUCT_RENDER_DPI_INVALID: {dpi!r}')
    publication = data.get('publication') or {}
    if not isinstance(publication, dict):
        errors.append('PRODUCT_PUBLICATION_POLICY_NOT_MAPPING')
    else:
        if not _is_nonempty_str(publication.get('publisher')):
            errors.append('PRODUCT_PUBLISHER_MISSING')
        for key in ('require_global_typography', 'require_symbol_notation_lint', 'forbid_case_id_leak'):
            if not isinstance(publication.get(key), bool):
                errors.append(f'PRODUCT_PUBLICATION_BOOL_INVALID: {key}')
        patterns = publication.get('forbidden_engineering_regexes')
        if not isinstance(patterns, list) or not all(_is_nonempty_str(x) for x in patterns):
            errors.append('PRODUCT_ENGINEERING_REGEXES_INVALID')
        else:
            for pattern in patterns:
                try:
                    re.compile(pattern)
                except re.error as exc:
                    errors.append(f'PRODUCT_ENGINEERING_REGEX_INVALID: {pattern!r}: {exc}')
    source = data.get('source_policy') or {}
    if not isinstance(source, dict):
        errors.append('PRODUCT_SOURCE_POLICY_NOT_MAPPING')
    else:
        for key in ('require_source_pages', 'require_locked_identity', 'require_resilient_transport'):
            if not isinstance(source.get(key), bool):
                errors.append(f'PRODUCT_SOURCE_POLICY_BOOL_INVALID: {key}')
    manifest = data.get('manifest_constraints') or {}
    if not isinstance(manifest, dict):
        errors.append('PRODUCT_MANIFEST_CONSTRAINT_POLICY_NOT_MAPPING')
    else:
        allowed = manifest.get('allowed')
        required = manifest.get('required')
        if not isinstance(allowed, list) or not all(_is_nonempty_str(x) for x in allowed):
            errors.append('PRODUCT_MANIFEST_CONSTRAINT_ALLOWED_INVALID')
            allowed = []
        if not isinstance(required, list) or not all(_is_nonempty_str(x) for x in required):
            errors.append('PRODUCT_MANIFEST_CONSTRAINT_REQUIRED_INVALID')
            required = []
        if len(set(allowed)) != len(allowed):
            errors.append('PRODUCT_MANIFEST_CONSTRAINT_ALLOWED_DUPLICATE')
        if not set(required).issubset(set(allowed)):
            errors.append('PRODUCT_MANIFEST_CONSTRAINT_REQUIRED_NOT_ALLOWED')
    qa = data.get('qa') or {}
    if not isinstance(qa, dict):
        return errors
    span = qa.get('exam_skeleton_section_pages_max')
    if not isinstance(span, int) or span < 1:
        errors.append(f'PRODUCT_SKELETON_PAGE_SPAN_INVALID: {span!r}')
    density = qa.get('skeleton_density') or {}
    density_required = {
        'max_nonspace_chars': int,
        'min_content_lines': int,
        'max_content_lines': int,
        'max_avg_visible_chars_per_line': (int, float),
        'max_single_line_visible_chars': int,
        'max_full_sentence_ratio': (int, float),
        'min_cue_line_ratio': (int, float),
        'max_long_prose_lines': int,
    }
    if not isinstance(density, dict):
        errors.append('PRODUCT_SKELETON_DENSITY_NOT_MAPPING')
    else:
        for key, typ in density_required.items():
            if key not in density or not isinstance(density[key], typ):
                errors.append(f'PRODUCT_SKELETON_DENSITY_FIELD_INVALID: {key}')
        if isinstance(density.get('min_content_lines'), int) and isinstance(density.get('max_content_lines'), int) and density['min_content_lines'] > density['max_content_lines']:
            errors.append('PRODUCT_SKELETON_DENSITY_LINE_RANGE_INVALID')
        for key in ('max_full_sentence_ratio', 'min_cue_line_ratio'):
            value = density.get(key)
            if isinstance(value, (int, float)) and not 0 <= float(value) <= 1:
                errors.append(f'PRODUCT_SKELETON_DENSITY_RATIO_INVALID: {key}')
    defense = qa.get('defense_questions') or {}
    if not isinstance(defense, dict):
        errors.append('PRODUCT_DEFENSE_POLICY_NOT_MAPPING')
    else:
        pattern = defense.get('heading_regex')
        if not _is_nonempty_str(pattern):
            errors.append('PRODUCT_DEFENSE_HEADING_REGEX_MISSING')
        else:
            try:
                re.compile(pattern)
            except re.error as exc:
                errors.append(f'PRODUCT_DEFENSE_HEADING_REGEX_INVALID: {exc}')
        lo, hi = defense.get('min'), defense.get('max')
        if not isinstance(lo, int) or not isinstance(hi, int) or lo < 0 or hi < lo:
            errors.append(f'PRODUCT_DEFENSE_COUNT_RANGE_INVALID: {lo!r},{hi!r}')
    homework = qa.get('homework_solution') or {}
    if not isinstance(homework, dict):
        errors.append('PRODUCT_HOMEWORK_POLICY_NOT_MAPPING')
    else:
        if not isinstance(homework.get('required'), bool):
            errors.append('PRODUCT_HOMEWORK_REQUIRED_INVALID')
        if homework.get('required') and not _is_nonempty_str(homework.get('token')):
            errors.append('PRODUCT_HOMEWORK_TOKEN_MISSING')
    return errors


def validate_product_contract(data: dict, *, expected_id: str | None = None) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ['PRODUCT_CONTRACT_NOT_MAPPING']
    if data.get('version') != 1:
        errors.append('PRODUCT_CONTRACT_VERSION_INVALID')
    cid = data.get('id')
    if not _is_nonempty_str(cid) or not CONTRACT_ID_RE.fullmatch(cid):
        errors.append('PRODUCT_CONTRACT_ID_INVALID')
    if expected_id is not None and cid != expected_id:
        errors.append(f'PRODUCT_CONTRACT_ID_DRIFT: {cid!r} != {expected_id!r}')
    documents = data.get('documents')
    if not isinstance(documents, dict) or not documents:
        errors.append('PRODUCT_CONTRACT_DOCUMENTS_MISSING')
        documents = {}
    deliverable_roles: set[str] = set()
    tex_filenames: set[str] = set()
    all_section_roles: set[str] = set()
    for doc_role, doc in documents.items():
        if not _is_nonempty_str(doc_role) or not isinstance(doc, dict):
            errors.append(f'PRODUCT_DOCUMENT_INVALID: {doc_role!r}')
            continue
        deliverable = doc.get('deliverable_role')
        if not _is_nonempty_str(deliverable):
            errors.append(f'PRODUCT_DOCUMENT_DELIVERABLE_ROLE_MISSING: {doc_role}')
        elif deliverable in deliverable_roles:
            errors.append(f'PRODUCT_DOCUMENT_DELIVERABLE_ROLE_DUPLICATE: {deliverable}')
        else:
            deliverable_roles.add(deliverable)
        tex_filename = doc.get('tex_filename')
        if not _is_nonempty_str(tex_filename) or not tex_filename.endswith('.tex') or Path(tex_filename).name != tex_filename:
            errors.append(f'PRODUCT_DOCUMENT_TEX_FILENAME_INVALID: {doc_role}')
        elif tex_filename in tex_filenames:
            errors.append(f'PRODUCT_DOCUMENT_TEX_FILENAME_DUPLICATE: {tex_filename}')
        else:
            tex_filenames.add(tex_filename)
        for key in ('header_kind', 'title_suffix', 'subtitle'):
            if not _is_nonempty_str(doc.get(key)):
                errors.append(f'PRODUCT_DOCUMENT_FIELD_MISSING: {doc_role}.{key}')
        sections = doc.get('sections')
        if sections is not None:
            if not isinstance(sections, list) or not sections:
                errors.append(f'PRODUCT_DOCUMENT_SECTIONS_INVALID: {doc_role}')
                continue
            local_roles: set[str] = set()
            for idx, section in enumerate(sections):
                if not isinstance(section, dict):
                    errors.append(f'PRODUCT_SECTION_INVALID: {doc_role}[{idx}]')
                    continue
                role = section.get('role')
                if not _is_nonempty_str(role):
                    errors.append(f'PRODUCT_SECTION_ROLE_MISSING: {doc_role}[{idx}]')
                    continue
                if role in local_roles:
                    errors.append(f'PRODUCT_SECTION_ROLE_DUPLICATE: {doc_role}.{role}')
                local_roles.add(role)
                if role in all_section_roles:
                    errors.append(f'PRODUCT_SECTION_ROLE_NOT_GLOBAL_UNIQUE: {role}')
                all_section_roles.add(role)
                if not _is_nonempty_str(section.get('heading')):
                    errors.append(f'PRODUCT_SECTION_HEADING_MISSING: {doc_role}.{role}')
                renderer = section.get('renderer')
                if renderer not in ALLOWED_SECTION_RENDERERS:
                    errors.append(f'PRODUCT_SECTION_RENDERER_INVALID: {doc_role}.{role}: {renderer!r}')
                if renderer == 'source_pages':
                    if section.get('source_role'):
                        errors.append(f'PRODUCT_SOURCE_PAGES_HAS_SOURCE_ROLE: {doc_role}.{role}')
                    if section.get('include_total_board') or section.get('consume_board_markers'):
                        errors.append(f'PRODUCT_SOURCE_PAGES_HAS_MARKDOWN_OPTIONS: {doc_role}.{role}')
                elif renderer == 'markdown' and not _is_nonempty_str(section.get('source_role')):
                    errors.append(f'PRODUCT_MARKDOWN_SOURCE_ROLE_MISSING: {doc_role}.{role}')
        else:
            if doc.get('renderer') != 'markdown':
                errors.append(f'PRODUCT_DOCUMENT_RENDERER_INVALID: {doc_role}')
            if not _is_nonempty_str(doc.get('source_role')):
                errors.append(f'PRODUCT_DOCUMENT_SOURCE_ROLE_MISSING: {doc_role}')
    qa = data.get('qa') or {}
    if not isinstance(qa, dict):
        errors.append('PRODUCT_QA_NOT_MAPPING')
    else:
        errors.extend(validate_qa_role_contract(data))
    errors.extend(validate_policy_contract(data))
    return errors


def load_product_contract(cfg_or_id: dict | str, root: Path = ROOT) -> dict:
    contract_id = cfg_or_id.get('product_contract') if isinstance(cfg_or_id, dict) else cfg_or_id
    path = contract_path(str(contract_id or ''), root)
    if not path.exists():
        raise ProductContractError(f'product contract missing: {path}')
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    except Exception as exc:
        raise ProductContractError(f'product contract unreadable: {path}: {exc}') from exc
    errors = validate_product_contract(data, expected_id=str(contract_id))
    if errors:
        raise ProductContractError('\n'.join(errors))
    return data


def manifest_constraint_policy(contract: dict) -> tuple[set[str], set[str]]:
    policy = contract.get('manifest_constraints') or {}
    return set(policy.get('allowed') or []), set(policy.get('required') or [])


def validate_manifest_binding(cfg: dict, contract: dict) -> list[str]:
    errors: list[str] = []
    deliverables = cfg.get('deliverables') or {}
    sources = cfg.get('source') or {}
    documents = contract.get('documents') or {}
    for doc_role, doc in documents.items():
        deliverable_role = doc.get('deliverable_role')
        if deliverable_role not in deliverables:
            errors.append(f'MANIFEST_DELIVERABLE_ROLE_MISSING: {doc_role}: {deliverable_role}')
        for section in doc.get('sections') or []:
            source_role = section.get('source_role')
            if source_role and source_role not in sources:
                errors.append(f'MANIFEST_SOURCE_ROLE_MISSING: {doc_role}.{section.get("role")}: {source_role}')
        source_role = doc.get('source_role')
        if source_role and source_role not in sources:
            errors.append(f'MANIFEST_SOURCE_ROLE_MISSING: {doc_role}: {source_role}')
    if len(deliverables) != len(documents):
        errors.append(f'MANIFEST_DELIVERABLE_COUNT_DRIFT: {len(deliverables)} != {len(documents)}')
    constraints = cfg.get('constraints') or {}
    if not isinstance(constraints, dict):
        errors.append('MANIFEST_CONSTRAINTS_NOT_MAPPING')
    else:
        allowed, required = manifest_constraint_policy(contract)
        unexpected = sorted(set(constraints) - allowed)
        missing = sorted(required - set(constraints))
        for key in unexpected:
            errors.append(f'MANIFEST_SHARED_POLICY_LEAK: {key}')
        for key in missing:
            errors.append(f'MANIFEST_TOPIC_CONSTRAINT_MISSING: {key}')
    return errors


def contract_document(contract: dict, role: str) -> dict:
    doc = (contract.get('documents') or {}).get(role)
    if not isinstance(doc, dict):
        raise ProductContractError(f'product document role missing: {role}')
    return doc


def contract_document_for_deliverable(contract: dict, deliverable_role: str) -> tuple[str, dict]:
    matches = [(role, doc) for role, doc in (contract.get('documents') or {}).items() if doc.get('deliverable_role') == deliverable_role]
    if len(matches) != 1:
        raise ProductContractError(f'deliverable role must resolve exactly once: {deliverable_role}: {len(matches)}')
    return matches[0]


def contract_section(contract: dict, role: str) -> dict:
    matches = []
    for doc in (contract.get('documents') or {}).values():
        if isinstance(doc, dict):
            matches.extend(x for x in (doc.get('sections') or []) if x.get('role') == role)
    if len(matches) != 1:
        raise ProductContractError(f'product section role must resolve exactly once: {role}: {len(matches)}')
    return matches[0]


def render_dpi(contract: dict) -> int:
    return int((contract.get('render') or {})['dpi'])


def publication_policy(contract: dict) -> dict:
    return dict(contract.get('publication') or {})


def source_policy(contract: dict) -> dict:
    return dict(contract.get('source_policy') or {})


def qa_policy(contract: dict) -> dict:
    return dict(contract.get('qa') or {})


def expected_total_board_copies(contract: dict) -> int:
    return sum(1 for doc in (contract.get('documents') or {}).values() for section in (doc.get('sections') or []) if section.get('include_total_board'))


def source_pages_required(contract: dict) -> bool:
    return any(section.get('renderer') == 'source_pages' for doc in (contract.get('documents') or {}).values() for section in (doc.get('sections') or []))


def product_contract_selftest() -> None:
    with tempfile.TemporaryDirectory(prefix='qz-product-contract-') as tmp:
        root = Path(tmp); contracts = root / 'production/contracts'; contracts.mkdir(parents=True)
        data = {
            'version': 1, 'id': 'synthetic-product-v1',
            'documents': {
                'alpha': {'deliverable_role': 'a', 'tex_filename': 'a.tex', 'header_kind': 'A', 'title_suffix': 'A', 'subtitle': 'A', 'sections': [
                    {'role': 'source', 'heading': '一', 'renderer': 'source_pages'},
                    {'role': 'body', 'heading': '二', 'renderer': 'markdown', 'source_role': 'body', 'include_total_board': True},
                    {'role': 'trial', 'heading': '三', 'renderer': 'markdown', 'source_role': 'trial', 'consume_board_markers': True},]},
                'beta': {'deliverable_role': 'b', 'tex_filename': 'b.tex', 'header_kind': 'B', 'title_suffix': 'B', 'subtitle': 'B', 'renderer': 'markdown', 'source_role': 'analysis'},},
            'render': {'dpi': 200},
            'publication': {'publisher': 'XeLaTeX', 'require_global_typography': True, 'require_symbol_notation_lint': True, 'forbid_case_id_leak': True, 'forbidden_engineering_regexes': [r'\bP\d+\b']},
            'source_policy': {'require_source_pages': True, 'require_locked_identity': True, 'require_resilient_transport': True},
            'manifest_constraints': {'allowed': ['topic_min'], 'required': ['topic_min']},
            'qa': {'training_deliverable_role': 'a', 'extraction_deliverable_role': 'b', 'skeleton_section_role': 'body', 'trial_section_role': 'trial', 'defense_section_role': 'body', 'homework_solution_section_role': 'body', 'required_training_section_roles': ['source'], 'required_extraction_sections': ['证据'], 'exam_skeleton_section_pages_max': 1, 'skeleton_density': {'max_nonspace_chars': 800, 'min_content_lines': 7, 'max_content_lines': 28, 'max_avg_visible_chars_per_line': 46, 'max_single_line_visible_chars': 96, 'max_full_sentence_ratio': .3, 'min_cue_line_ratio': .6, 'max_long_prose_lines': 2}, 'defense_questions': {'heading_regex': r'^##\s+\d+\.', 'min': 1, 'max': 3}, 'homework_solution': {'required': True, 'token': '解析'}},}
        (contracts / 'synthetic-product-v1.yaml').write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding='utf-8')
        loaded = load_product_contract('synthetic-product-v1', root)
        assert render_dpi(loaded) == 200 and expected_total_board_copies(loaded) == 1 and source_pages_required(loaded)
        cfg = {'deliverables': {'a': 'a.pdf', 'b': 'b.pdf'}, 'source': {'body': 'b.md', 'trial': 't.md', 'analysis': 'a.md'}, 'constraints': {'topic_min': 2}}
        if validate_manifest_binding(cfg, loaded):
            raise AssertionError('clean synthetic product binding rejected')
        leaked = copy.deepcopy(cfg); leaked['constraints']['visual_render_dpi'] = 200
        if not any('MANIFEST_SHARED_POLICY_LEAK' in x for x in validate_manifest_binding(leaked, loaded)):
            raise AssertionError('shared product policy leaked back into lesson manifest without failing')
        broken = copy.deepcopy(data); broken['render']['dpi'] = 96
        if not any('RENDER_DPI_INVALID' in x for x in validate_product_contract(broken, expected_id='synthetic-product-v1')):
            raise AssertionError('low render DPI escaped')
        broken = copy.deepcopy(data); broken['publication']['forbidden_engineering_regexes'] = ['[']
        if not any('ENGINEERING_REGEX_INVALID' in x for x in validate_product_contract(broken, expected_id='synthetic-product-v1')):
            raise AssertionError('invalid publication regex escaped')
        broken = copy.deepcopy(data); broken['qa']['defense_questions']['min'] = 5; broken['qa']['defense_questions']['max'] = 2
        if not any('DEFENSE_COUNT_RANGE_INVALID' in x for x in validate_product_contract(broken, expected_id='synthetic-product-v1')):
            raise AssertionError('invalid defense range escaped')
        try:
            contract_path('../escape', root)
        except ProductContractError:
            pass
        else:
            raise AssertionError('product contract path traversal escaped')


def latex_plain(text: str) -> str:
    for a, b in [('\\', r'\textbackslash{}'), ('&', r'\&'), ('%', r'\%'), ('#', r'\#'), ('$', r'\$'), ('_', r'\_'), ('{', r'\{'), ('}', r'\}'), ('^', r'\textasciicircum{}'), ('~', r'\textasciitilde{}')]:
        text = text.replace(a, b)
    return text.replace('↔', r'$\leftrightarrow$').replace('→', r'$\rightarrow$').replace('←', r'$\leftarrow$').replace('⇒', r'$\Rightarrow$').replace('≠', r'$\ne$')


def latex_inline(text: str) -> str:
    return render_inline(text.strip(), latex_plain)


def preamble(case_id: str, kind: str, compact: bool = False) -> str:
    return rf'''\documentclass[UTF8,10pt]{{article}}
\usepackage{{ctex}}
\usepackage{{geometry,fontspec,xeCJK,amsmath,amssymb,graphicx,siunitx}}
\usepackage{{xcolor,tcolorbox,enumitem,fancyhdr,lastpage,hyperref,needspace,microtype}}
\usepackage{{tikz}}
\usepackage{{pgfplots}}
\usepackage[american]{{circuitikz}}
\usepackage{{tkz-euclide}}
\usepackage{{tikz-3dplot}}
\usetikzlibrary{{arrows.meta,positioning,calc,decorations.pathmorphing,patterns}}
\tcbuselibrary{{skins,breakable}}
\pgfplotsset{{compat=1.18}}
\geometry{{a4paper,left=2.5cm,right=2.5cm,top=2.5cm,bottom=2.5cm,headheight=14pt,headsep=5mm,footskip=8mm}}
\setCJKmainfont{{Noto Serif CJK SC}}
\setCJKsansfont{{Noto Sans CJK SC}}
\setmainfont{{Linux Libertine O}}
\setsansfont{{Noto Sans}}
\sisetup{{detect-all,per-mode=symbol}}
\definecolor{{muted}}{{HTML}}{{606873}}
\hypersetup{{hidelinks,pdfcreator={{XeLaTeX - qiuzhidaren}},pdfproducer={{xdvipdfmx}}}}
\pagestyle{{fancy}}\fancyhf{{}}
\renewcommand{{\headrulewidth}}{{0.35pt}}\renewcommand{{\footrulewidth}}{{0pt}}
\lhead{{\small\sffamily 求职达人 · 教师面试试讲}}
\rhead{{\small\sffamily {latex_inline(kind)}}}
\cfoot{{\small\sffamily 第\thepage 页 / 共\pageref*{{LastPage}}页}}
\setlength{{\parindent}}{{2em}}\setlength{{\parskip}}{{0pt}}
\linespread{{1.6}}\selectfont
\setlist[itemize]{{leftmargin=*,itemsep=4pt,topsep=6pt,parsep=0pt}}
\setlist[enumerate]{{leftmargin=*,itemsep=4pt,topsep=6pt,parsep=0pt}}
\newcommand{{\qzsection}}[1]{{\needspace{{6\baselineskip}}\par\vspace{{9pt}}\noindent{{\sffamily\Large\bfseries #1}}\par\vspace{{3pt}}\hrule height .55pt\vspace{{7pt}}}}
\newcommand{{\qzsubsection}}[1]{{\needspace{{4\baselineskip}}\par\vspace{{7pt}}\noindent{{\sffamily\large\bfseries #1}}\par\vspace{{3pt}}}}
\newcommand{{\qzminor}}[1]{{\needspace{{3\baselineskip}}\par\vspace{{5pt}}\noindent{{\sffamily\bfseries #1}}\par\vspace{{2pt}}}}
\newtcolorbox{{syncboard}}[1]{{enhanced,colback=black!5,colframe=black!15,boxrule=.5pt,arc=2mm,left=15pt,right=15pt,top=9pt,bottom=9pt,title=\sffamily\bfseries #1,colbacktitle=black!5,coltitle=black,fonttitle=\small,before skip=7pt,after skip=9pt}}
\newtcolorbox{{totalboard}}[1]{{enhanced,colback=black!5,colframe=black!15,boxrule=.5pt,arc=2mm,left=15pt,right=15pt,top=10pt,bottom=10pt,title=\centering\sffamily\bfseries #1,colbacktitle=black!5,coltitle=black,before skip=8pt,after skip=10pt}}
\newtcolorbox{{figurepanel}}[1]{{enhanced,colback=white,colframe=black!15,boxrule=.5pt,arc=2mm,left=15pt,right=15pt,top=10pt,bottom=10pt,title=\sffamily\bfseries #1,colbacktitle=black!5,coltitle=black,fonttitle=\small,before skip=8pt,after skip=9pt}}
\newtcolorbox{{notebox}}[1]{{enhanced,breakable,colback=black!5,colframe=black!15,boxrule=.5pt,arc=2mm,left=15pt,right=15pt,top=12pt,bottom=12pt,title=\sffamily\bfseries #1,colbacktitle=black!5,coltitle=black,fonttitle=\small,before skip=8pt,after skip=10pt}}
\tikzset{{qzvector/.style={{-{{Latex[length=2.6mm]}},line width=.8pt}},qzsurface/.style={{line width=.75pt}},qzobject/.style={{draw=black!75,fill=black!5,line width=.75pt}},qzlabel/.style={{fill=white,fill opacity=.9,text opacity=1,inner sep=1.5pt}}}}
\begin{{document}}
'''


def doc_title(title: str, subtitle: str) -> str:
    return rf'''\begin{{center}}
{{\sffamily\LARGE\bfseries {latex_inline(title)}}}\par
\vspace{{5pt}}{{\small\sffamily\color{{muted}} {latex_inline(subtitle)}}}
\end{{center}}\vspace{{6pt}}
'''


def figure_tex(name: str) -> str:
    return registered_figure_tex(name)


def board_increment(board_case: dict, point: str) -> tuple[str, str]:
    increments = board_case.get('increments') or {}; item = increments.get(point)
    if item is None:
        raise SystemExit(f'board marker missing from BOARD_PLAN: {point}')
    if isinstance(item, str):
        return '同步板书', item
    return item.get('label') or '同步板书', item.get('text') or ''


def render_md(md: str, board_case: dict | None = None, consume_board_markers: bool = False, nested: bool = False) -> str:
    lines = md.splitlines(); out = []; in_list = False; i = 0
    def close_list():
        nonlocal in_list
        if in_list:
            out.append('\\end{itemize}\n'); in_list = False
    while i < len(lines):
        s = lines[i].strip()
        if not s or s.startswith('# '):
            close_list(); i += 1; continue
        marker = re.fullmatch(r'\[\[BOARD:(P\d+)\]\]', s)
        if marker and consume_board_markers:
            close_list()
            if not board_case:
                raise SystemExit('board marker encountered without BOARD_PLAN')
            label, text = board_increment(board_case, marker.group(1))
            out.append(r'\begin{syncboard}{同步板书 · ' + latex_inline(label) + '}\n' + latex_inline(text) + '\n\\end{syncboard}\n'); i += 1; continue
        fig = re.fullmatch(r'\[\[FIGURE:([a-z0-9-]+)\]\]', s)
        if fig:
            close_list(); out.append(figure_tex(fig.group(1))); i += 1; continue
        if s.startswith('> '):
            close_list(); quoted = []
            while i < len(lines) and lines[i].strip().startswith('> '):
                quoted.append(lines[i].strip()[2:].strip()); i += 1
            title = '训练提示'
            if quoted and re.fullmatch(r'\[.+\]', quoted[0]):
                title = quoted.pop(0)[1:-1]
            body = ''.join(latex_inline(q) + r'\par\vspace{1.5pt}' + '\n' for q in quoted); out.append(r'\begin{notebox}{' + latex_inline(title) + '}\n' + body + r'\end{notebox}' + '\n'); continue
        if s.startswith('## '):
            close_list(); cmd = 'qzsubsection' if nested else 'qzsection'; out.append('\\' + cmd + '{' + latex_inline(s[3:]) + '}\n'); i += 1; continue
        if s.startswith('### '):
            close_list(); cmd = 'qzminor' if nested else 'qzsubsection'; out.append('\\' + cmd + '{' + latex_inline(s[4:]) + '}\n'); i += 1; continue
        if s.startswith('#### '):
            close_list(); out.append(r'\qzminor{' + latex_inline(s[5:]) + '}\n'); i += 1; continue
        if s.startswith('- '):
            if not in_list:
                out.append('\\begin{itemize}\n'); in_list = True
            out.append('\\item ' + latex_inline(s[2:]) + '\n'); i += 1; continue
        close_list(); out.append(latex_inline(s) + '\\par\n'); i += 1
    close_list(); return ''.join(out)


def total_board(board_case: dict, title: str = '总板书', compact: bool = False) -> str:
    layout = board_case.get('layout') or 'linear'; chunks = []
    if layout == 'route-numbered':
        route = board_case.get('route') or []
        if route:
            route_text = r'\quad $\longrightarrow$ \quad '.join(latex_inline(str(x)) for x in route); chunks.append(r'\begin{center}\sffamily\bfseries ' + route_text + r'\end{center}\vspace{3pt}' + '\n')
        for sec in board_case.get('sections') or []:
            number = sec.get('number'); head = (f'{number}. ' if number is not None else '') + str(sec.get('title') or ''); chunks.append(r'\noindent{\sffamily\bfseries ' + latex_inline(head) + r'}\par\vspace{2pt}' + '\n')
            for line in sec.get('lines') or []:
                chunks.append(r'\hspace*{1em}' + latex_inline(str(line)) + r'\par' + '\n')
            chunks.append(r'\vspace{4pt}' + '\n')
    else:
        for item in (board_case.get('increments') or {}).values():
            text = item if isinstance(item, str) else item.get('text', ''); chunks.append(r'\noindent ' + latex_inline(str(text)) + r'\par\vspace{1pt}' + '\n')
    return rf'''\needspace{{10\baselineskip}}
\qzsubsection{{板书设计（总板书）}}
\begin{{totalboard}}{{{latex_inline(title)}}}
{''.join(chunks)}\end{{totalboard}}
'''


def board_for_case(workspace: Path, case_id: str) -> dict:
    data = yaml.safe_load((workspace / 'BOARD_PLAN.yaml').read_text(encoding='utf-8')) or {}
    for case in data.get('cases') or []:
        if case.get('id') == case_id:
            return case
    raise SystemExit(f'{case_id}: BOARD_PLAN missing')


def _validate_image(path: Path):
    data = path.read_bytes(); ok = data.startswith(b'\xff\xd8\xff') or data.startswith(b'\x89PNG\r\n\x1a\n')
    if len(data) < 8_000 or not ok:
        raise SystemExit(f'invalid source page image: {path} ({len(data)} bytes)')


def _cache_key(text: str):
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _git_blob_sha(path: Path):
    size = path.stat().st_size; h = hashlib.sha1(); h.update(f'blob {size}\0'.encode('ascii'))
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def _render_pdf_pages(pdf: Path, page_numbers, cache_tag='pdf'):
    CACHE.mkdir(parents=True, exist_ok=True); pages = []
    for n in page_numbers:
        prefix = CACHE / f'{cache_tag}-pdfpage-{int(n):04d}'; out = Path(str(prefix) + '.png')
        if not out.exists():
            proc = subprocess.run(['pdftoppm','-f',str(n),'-l',str(n),'-singlefile','-png','-r','200',str(pdf),str(prefix)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            if proc.returncode:
                raise SystemExit(f'pdftoppm failed for source PDF page {n}:\n{proc.stdout}')
        _validate_image(out); pages.append(out)
    return pages


def resolve_source_pages(cfg, workspace: Path):
    source = cfg['input']['source_pages']; mode = source['mode']; offline = os.environ.get('QZ_OFFLINE_SOURCE_DIR')
    if offline:
        p = Path(offline); pages = sorted(x for x in p.glob('*') if x.is_file())
        if not pages:
            raise SystemExit('QZ_OFFLINE_SOURCE_DIR contains no pages')
        for page in pages:
            _validate_image(page)
        return pages, {'resolution':'offline-override','canonical_source':False,'configured_mode':mode,'page_count':len(pages),'expected_blob_sha':source.get('blob_sha')}
    if mode == 'local-images':
        pages = [workspace / x for x in source['files']]
        for p in pages:
            _validate_image(p)
        return pages, {'resolution':'local-images','canonical_source':True,'configured_mode':mode,'page_count':len(pages)}
    if mode == 'local-pdf':
        pdf = workspace / source['file']
        if not pdf.exists() or pdf.read_bytes()[:4] != b'%PDF':
            raise SystemExit(f'local source is not a PDF: {pdf}')
        pages = _render_pdf_pages(pdf, source['pages'], _cache_key(str(pdf.resolve()))); return pages, {'resolution':'local-pdf','canonical_source':True,'configured_mode':mode,'page_count':len(pages)}
    if mode == 'remote-pdf':
        CACHE.mkdir(parents=True, exist_ok=True); expected_blob = source.get('blob_sha'); key = expected_blob or _cache_key(source['url']); dest = CACHE / f'source-{key}.pdf'
        if not dest.exists():
            req = urllib.request.Request(source['url'], headers={'User-Agent':'Mozilla/5.0 qiuzhidaren/1.0'})
            with urllib.request.urlopen(req, timeout=90) as r, dest.open('wb') as f:
                shutil.copyfileobj(r, f)
        if dest.read_bytes()[:4] != b'%PDF':
            raise SystemExit('remote source is not a PDF')
        actual_blob = _git_blob_sha(dest)
        if expected_blob and actual_blob != expected_blob:
            dest.unlink(missing_ok=True); raise SystemExit(f'upstream textbook blob mismatch: expected {expected_blob}, got {actual_blob}')
        pages = _render_pdf_pages(dest, source['pages'], key[:16]); return pages, {'resolution':'remote-pdf','canonical_source':True,'configured_mode':mode,'page_count':len(pages),'expected_blob_sha':expected_blob,'actual_blob_sha':actual_blob}
    if mode != 'remote-images':
        raise SystemExit(f'unsupported source page mode: {mode}')
    CACHE.mkdir(parents=True, exist_ok=True); pages = []
    for i, url in enumerate(source['urls'], 1):
        key = _cache_key(url); suffix = Path(url.split('?',1)[0]).suffix or '.jpg'; dest = CACHE / f'image-{i:02d}-{key}{suffix}'
        if not dest.exists():
            req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 qiuzhidaren/1.0'})
            with urllib.request.urlopen(req, timeout=45) as r, dest.open('wb') as f:
                shutil.copyfileobj(r, f)
        _validate_image(dest); pages.append(dest)
    return pages, {'resolution':'remote-images','canonical_source':True,'configured_mode':mode,'page_count':len(pages)}


def source_pages_tex(cfg, pages, heading: str):
    printed = cfg['input']['printed_pages']; chunks = [r'\qzsection{' + latex_inline(heading) + '}' + '\n']
    chunks.append(r'\noindent{\small\color{muted} 本次教学边界：' + latex_inline(cfg['input']['book']) + '，印刷页 ' + latex_inline('-'.join(map(str, printed))) + r'。}\par' + '\n')
    for i, page in enumerate(pages):
        path = page.resolve().as_posix(); chunks.append(r'\begin{center}\includegraphics[width=0.94\textwidth,height=0.76\textheight,keepaspectratio]{\detokenize{' + path + r'}}\end{center}' + '\n')
        if i < len(pages)-1:
            chunks.append(r'\newpage' + '\n')
    return ''.join(chunks)


def document_tex(cfg: dict, contract: dict, doc_role: str, workspace: Path, board_case: dict, pages) -> str:
    doc = contract_document(contract, doc_role); title = cfg['title']; out = [preamble(cfg.get('case_id',''), str(doc['header_kind'])), doc_title(f"{title}｜{doc['title_suffix']}", str(doc['subtitle']))]
    sections = doc.get('sections')
    if sections:
        for idx, section in enumerate(sections):
            if idx:
                out.append(r'\newpage' + '\n')
            renderer = section['renderer']; heading = str(section['heading'])
            if renderer == 'source_pages':
                out.append(source_pages_tex(cfg, pages, heading)); continue
            source_role = section['source_role']; md = (workspace / cfg['source'][source_role]).read_text(encoding='utf-8'); out.append(r'\qzsection{' + latex_inline(heading) + '}' + '\n'); out.append(render_md(md, board_case, bool(section.get('consume_board_markers')), nested=True))
            if section.get('include_total_board'):
                out.append(total_board(board_case, title + ' · 总板书'))
    else:
        source_role = doc['source_role']; md = (workspace / cfg['source'][source_role]).read_text(encoding='utf-8'); out.append(render_md(md, nested=True))
    out.append('\\end{document}\n'); return ''.join(out)


def training_tex(cfg, workspace: Path, board_case: dict, pages):
    contract = load_product_contract(cfg); role, _ = contract_document_for_deliverable(contract, (contract.get('qa') or {}).get('training_deliverable_role')); return document_tex(cfg, contract, role, workspace, board_case, pages)


def analysis_tex(cfg, workspace: Path):
    contract = load_product_contract(cfg); role, _ = contract_document_for_deliverable(contract, (contract.get('qa') or {}).get('extraction_deliverable_role')); return document_tex(cfg, contract, role, workspace, {}, [])


def compile_tex(tex: str, tex_path: Path, pdf_path: Path):
    tex_path.parent.mkdir(parents=True, exist_ok=True); pdf_path.parent.mkdir(parents=True, exist_ok=True); tex_path.write_text(tex, encoding='utf-8')
    with tempfile.TemporaryDirectory(prefix='qz-two-pdf-') as tmp:
        tmpdir = Path(tmp); temp = tmpdir / 'main.tex'; temp.write_text(tex, encoding='utf-8')
        for _ in range(2):
            p = subprocess.run(['xelatex','-interaction=nonstopmode','-halt-on-error','main.tex'], cwd=tmpdir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            if p.returncode:
                raise SystemExit(f'XeLaTeX failed for {tex_path}:\n{p.stdout[-8000:]}')
        shutil.copy2(tmpdir / 'main.pdf', pdf_path)
    return len(PdfReader(str(pdf_path)).pages)


def clean_outputs():
    for p in (OUT_PDF, OUT_TEX):
        if p.exists():
            shutil.rmtree(p)
        p.mkdir(parents=True, exist_ok=True)


def main(manifest_path: str | None = None):
    if manifest_path:
        configure_manifest(manifest_path)
    product_contract_selftest(); cfg = load_cfg(); contract = load_product_contract(cfg); binding_errors = validate_manifest_binding(cfg, contract)
    if binding_errors:
        raise SystemExit('\n'.join(binding_errors))
    workspace = ROOT / cfg['workspace']; src = cfg['source']; required_roles = set()
    for doc in contract['documents'].values():
        if doc.get('source_role'):
            required_roles.add(doc['source_role'])
        for section in doc.get('sections') or []:
            if section.get('source_role'):
                required_roles.add(section['source_role'])
    required_files = [src[role] for role in sorted(required_roles)] + [src[k] for k in ('evidence','board') if src.get(k)]
    missing = [x for x in required_files if not (workspace / x).exists()]
    if missing:
        raise SystemExit(f"{cfg.get('case_id')}: source missing: {missing}")
    board_case = board_for_case(workspace, cfg['case_id']); pages, provenance = resolve_source_pages(cfg, workspace); clean_outputs(); (OUT_TEX / 'source-provenance.yaml').write_text(yaml.safe_dump(provenance, allow_unicode=True, sort_keys=False), encoding='utf-8')
    page_counts = {}
    for doc_role, doc in contract['documents'].items():
        tex = document_tex(cfg, contract, doc_role, workspace, board_case, pages); deliverable_role = doc['deliverable_role']; pdf_path = OUT_PDF / cfg['deliverables'][deliverable_role]; tex_path = OUT_TEX / doc['tex_filename']; page_counts[deliverable_role] = compile_tex(tex, tex_path, pdf_path)
    pdfs = sorted(OUT_PDF.glob('*.pdf')); expected = len(contract['documents'])
    if len(pdfs) != expected:
        raise SystemExit(f'current run must contain exactly {expected} PDFs, got {len(pdfs)}')
    print(f"current run built: {cfg.get('case_id')}"); print('pages: ' + ', '.join(f'{k}={v}' for k,v in page_counts.items())); print('source_provenance=' + provenance['resolution']); [print(p.relative_to(ROOT)) for p in pdfs]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', default=None, help='repository-relative manifest; legacy production/current-run.yaml is the default')
    main(parser.parse_args().manifest)
