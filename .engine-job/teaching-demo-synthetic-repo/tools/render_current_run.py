"""Render every manifest-declared Teaching Demo PDF for visual QA.

Besides page PNGs this stage emits generic text-occupancy evidence. Low occupancy is
an early machine signal for abnormal whitespace/layout collapse; HUMAN page-by-page
inspection is still mandatory and remains the final visual authority.
"""
from __future__ import annotations
from pathlib import Path
import argparse
import hashlib
import shutil
import subprocess
import yaml

import publisher_core as core
from pdf_text_occupancy import analyze_pdf, evaluate as evaluate_occupancy, selftest as occupancy_selftest

ROOT = Path(__file__).resolve().parents[1]
_parser = argparse.ArgumentParser(add_help=False)
_parser.add_argument('--manifest', default=None)
_args, _unknown = _parser.parse_known_args()
MANIFEST = ROOT / (_args.manifest or 'production/current-run.yaml')
PDF_DIR = ROOT / 'outputs/current-run'
RENDER_DIR = ROOT / 'qa/current-run-rendered'


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_cfg() -> dict:
    cfg = yaml.safe_load(MANIFEST.read_text(encoding='utf-8')) or {}
    if _args.manifest:
        def safe(raw, default):
            p = (ROOT / str(raw or default)).resolve()
            if ROOT != p and ROOT not in p.parents:
                raise SystemExit('manifest path escapes repository root')
            return p
        global PDF_DIR, RENDER_DIR
        PDF_DIR = safe(cfg.get('pdf_dir'), 'outputs/current-run')
        RENDER_DIR = safe(cfg.get('render_dir'), 'qa/current-run-rendered')
    return cfg


def declared_pdfs(cfg: dict, contract: dict) -> list[Path]:
    deliverables = cfg.get('deliverables') or {}
    expected_roles = [str(doc['deliverable_role']) for doc in (contract.get('documents') or {}).values()]
    names = []
    for role in expected_roles:
        if role not in deliverables:
            raise SystemExit(f'manifest deliverable role missing: {role}')
        names.append(str(deliverables[role]))
    extras = sorted(set(deliverables) - set(expected_roles))
    if extras:
        raise SystemExit('undeclared product deliverable role(s): ' + ', '.join(extras))
    if len(names) != len(set(names)):
        raise SystemExit('manifest contains duplicate deliverable filenames')
    return [PDF_DIR / name for name in names]


def render_pdf(pdf: Path, out: Path, dpi: int) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    prefix = out / 'page'
    proc = subprocess.run(
        ['pdftoppm', '-png', '-r', str(dpi), str(pdf), str(prefix)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode:
        raise SystemExit(f'pdftoppm failed for {pdf.name}:\n{proc.stdout}')
    pages = sorted(out.glob('page-*.png'))
    if not pages:
        raise SystemExit(f'no rendered pages for {pdf.name}')
    return pages


def selftest() -> None:
    occupancy_selftest()
    contract = {'documents': {'x': {'deliverable_role': 'alpha'}, 'y': {'deliverable_role': 'beta'}}, 'render': {'dpi': 200}}
    cfg = {'deliverables': {'alpha': 'a.pdf', 'beta': 'b.pdf'}}
    paths = declared_pdfs(cfg, contract)
    assert [p.name for p in paths] == ['a.pdf', 'b.pdf']
    try:
        declared_pdfs({'deliverables': {'alpha': 'a.pdf', 'beta': 'a.pdf'}}, contract)
    except SystemExit:
        pass
    else:
        raise AssertionError('duplicate deliverable names escaped')
    assert core.render_dpi(contract) == 200


def main() -> None:
    selftest()
    cfg = load_cfg()
    contract = core.load_product_contract(cfg)
    binding = core.validate_manifest_binding(cfg, contract)
    if binding:
        raise SystemExit('\n'.join(binding))
    occupancy_policy = (core.qa_policy(contract).get('visual_occupancy') or {})
    declared = declared_pdfs(cfg, contract)
    actual = sorted(PDF_DIR.glob('*.pdf')) if PDF_DIR.exists() else []
    missing = [p.name for p in declared if not p.exists()]
    extras = sorted(p.name for p in actual if p not in declared)
    if missing:
        raise SystemExit('declared PDF(s) missing before visual render: ' + ', '.join(missing))
    if extras:
        raise SystemExit('undeclared PDF(s) present before visual render: ' + ', '.join(extras))

    dpi = core.render_dpi(contract)
    if RENDER_DIR.exists():
        shutil.rmtree(RENDER_DIR)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)

    total = 0
    manifest = {
        'version': 1,
        'manifest': str(MANIFEST.relative_to(ROOT)),
        'render_dpi': dpi,
        'occupancy_policy': occupancy_policy,
        'documents': [],
        'warnings': [],
        'errors': [],
        'human_review_required': True,
    }
    for pdf in declared:
        pages = render_pdf(pdf, RENDER_DIR / pdf.stem, dpi)
        total += len(pages)
        metrics = analyze_pdf(pdf)
        warnings, errors = evaluate_occupancy(metrics, occupancy_policy)
        if len(metrics) != len(pages):
            errors.append(f'VISUAL_OCCUPANCY_PAGE_COUNT_DRIFT: bbox={len(metrics)} rendered={len(pages)}')
        doc = {
            'pdf': str(pdf.relative_to(ROOT)),
            'sha256': _sha256(pdf),
            'rendered_pages': len(pages),
            'occupancy': metrics,
            'warnings': warnings,
            'errors': errors,
        }
        manifest['documents'].append(doc)
        manifest['warnings'].extend(f'{pdf.name}: {x}' for x in warnings)
        manifest['errors'].extend(f'{pdf.name}: {x}' for x in errors)
        print(f'{pdf.name}: {len(pages)} pages at {dpi}dpi')
        for warning in warnings:
            print('WARNING:', pdf.name, warning)

    evidence = RENDER_DIR / 'render-manifest.yaml'
    evidence.write_text(yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding='utf-8')
    print(f'render evidence: {evidence.relative_to(ROOT)}')
    if manifest['errors']:
        raise SystemExit('visual occupancy machine gate failed:\n' + '\n'.join(str(x) for x in manifest['errors']))
    print(f'visual QA render ready: {total} pages at {dpi}dpi')
    print('IMPORTANT: every rendered page must still be opened and inspected; render/occupancy success is not HUMAN visual acceptance.')


if __name__ == '__main__':
    main()
