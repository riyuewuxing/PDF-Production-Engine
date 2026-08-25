"""Canonical Teaching Demo build adapter.

All rendering/content logic lives in topic-agnostic `publisher_core`. This file adds
resilient acquisition for a locked remote PDF source and *always* runs the cheap
Teaching Demo input/font gate before full PDF composition. No lesson title, case id,
formula alias or figure branch is allowed here.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import yaml
from pypdf import PdfReader

import process_telemetry as telemetry
import publisher_core as core
from check_teaching_demo_inputs import selftest as input_gate_selftest, validate as validate_teaching_demo_inputs
from latex_inline import selftest as inline_selftest
from physics_figures import selftest as figure_registry_selftest
from physics_notation import selftest as notation_selftest


def _encoded_repo_path(path: str) -> str:
    return '/'.join(quote(part, safe='') for part in path.split('/'))


def _remote_pdf_candidates(source: dict):
    """Return transports for one immutable source identity, in fallback order."""
    seen = set()
    out = []

    def add(name, url, headers=None):
        if url and url not in seen:
            seen.add(url)
            out.append((name, url, headers or {}))

    add('configured-url', source.get('url'))
    repo, ref, path = source.get('repo'), source.get('ref'), source.get('path')
    if repo and ref and path:
        enc = _encoded_repo_path(path)
        add('github-raw', f'https://raw.githubusercontent.com/{repo}/{ref}/{enc}')
        add('github-media', f'https://media.githubusercontent.com/media/{repo}/{ref}/{enc}')
        headers = {'Accept': 'application/vnd.github.raw+json'}
        token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        if token:
            headers['Authorization'] = f'Bearer {token}'
            headers['X-GitHub-Api-Version'] = '2022-11-28'
        add('github-api-raw', f'https://api.github.com/repos/{repo}/contents/{enc}?ref={quote(str(ref), safe="")}', headers)
    return out


def _validate_locked_pdf(path, source: dict):
    if not path.exists():
        raise RuntimeError('downloaded source missing')
    size = path.stat().st_size
    if size < 100_000:
        raise RuntimeError(f'downloaded source suspiciously small: {size} bytes')
    with path.open('rb') as f:
        if not f.read(5).startswith(b'%PDF-'):
            raise RuntimeError('downloaded source is not a PDF')
    expected_size = source.get('size_bytes')
    if expected_size is not None and size != int(expected_size):
        raise RuntimeError(f'source size mismatch: expected {expected_size}, got {size}')
    actual_blob = core._git_blob_sha(path)
    expected_blob = source.get('blob_sha')
    if not expected_blob:
        raise RuntimeError('remote-pdf source must lock blob_sha')
    if actual_blob != expected_blob:
        raise RuntimeError(f'upstream textbook blob mismatch: expected {expected_blob}, got {actual_blob}')
    return {'size_bytes': size, 'actual_blob_sha': actual_blob}


def _runtime_path(raw: str) -> Path:
    path = Path(raw).expanduser()
    return path if path.is_absolute() else core.ROOT / path


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def _reviewed_source_pages(cfg: dict, source: dict):
    selected_raw = os.environ.get('QZ_REVIEWED_SOURCE_PDF')
    if not selected_raw:
        return None
    receipts_raw = os.environ.get('QZ_REVIEW_RECEIPTS')
    block_id = os.environ.get('QZ_REVIEWED_SOURCE_BLOCK_ID')
    if not receipts_raw or not block_id:
        raise SystemExit('reviewed source-pages input requires QZ_REVIEW_RECEIPTS and QZ_REVIEWED_SOURCE_BLOCK_ID')

    selected = _runtime_path(selected_raw)
    receipts_path = _runtime_path(receipts_raw)
    if not selected.exists() or selected.read_bytes()[:4] != b'%PDF':
        raise SystemExit(f'reviewed source-pages PDF missing or invalid: {selected}')
    receipts = yaml.safe_load(receipts_path.read_text(encoding='utf-8')) or {}
    matches = [x for x in receipts.get('receipts') or [] if x.get('block_id') == block_id]
    if len(matches) != 1:
        raise SystemExit(f'reviewed source-pages receipt must resolve exactly once: {block_id}: {len(matches)}')
    receipt = matches[0]
    if receipt.get('state') != 'REVIEW_PASS' or receipt.get('reviewer') != 'ChatGPT':
        raise SystemExit(f'reviewed source-pages receipt is not ChatGPT REVIEW_PASS: {block_id}')
    accepted = str(receipt.get('accepted_sha256') or '')
    if len(accepted) != 64 or _sha256(selected) != accepted:
        raise SystemExit('reviewed source-pages PDF hash does not match REVIEW_PASS receipt')

    evidence_ref = str(receipt.get('evidence_ref') or '')
    evidence_path = _runtime_path(evidence_ref)
    evidence = yaml.safe_load(evidence_path.read_text(encoding='utf-8')) or {}
    if evidence.get('block_id') != block_id or evidence.get('review_state') != 'REVIEW_PASS' or evidence.get('accepted_sha256') != accepted:
        raise SystemExit('reviewed source-pages evidence/receipt binding invalid')
    locked = evidence.get('locked_source') or {}
    expected_pairs = {
        'repo': source.get('repo'),
        'ref': source.get('ref'),
        'path': source.get('path'),
        'size_bytes': source.get('size_bytes'),
        'git_blob_sha': source.get('blob_sha'),
    }
    for key, expected in expected_pairs.items():
        if expected is not None and locked.get(key) != expected:
            raise SystemExit(f'reviewed source-pages locked-source drift: {key}')
    extraction = evidence.get('extraction') or {}
    printed = list((cfg.get('input') or {}).get('printed_pages') or [])
    if list(extraction.get('physical_pages') or []) != list(source.get('pages') or []):
        raise SystemExit('reviewed source-pages physical-page drift')
    if list(extraction.get('printed_pages') or []) != printed:
        raise SystemExit('reviewed source-pages printed-page drift')
    if (evidence.get('output') or {}).get('sha256') != accepted:
        raise SystemExit('reviewed source-pages evidence output hash drift')

    count = len(PdfReader(str(selected)).pages)
    if count != len(printed) or count != int(extraction.get('extracted_page_count') or -1):
        raise SystemExit(f'reviewed source-pages page-count drift: {count}')
    pages = core._render_pdf_pages(selected, range(1, count + 1), accepted[:16])
    provenance = {
        'resolution': 'reviewed-source-pages-block',
        'canonical_source': True,
        'configured_mode': source.get('mode'),
        'page_count': count,
        'pdf_physical_pages': list(source.get('pages') or []),
        'printed_pages': printed,
        'expected_blob_sha': source.get('blob_sha'),
        'actual_blob_sha': locked.get('git_blob_sha'),
        'source_size_bytes': locked.get('size_bytes'),
        'reviewed_block_id': block_id,
        'reviewed_output_sha256': accepted,
        'review_evidence_ref': evidence_ref,
    }
    return pages, provenance


def _download_locked_pdf(source: dict):
    required = ('repo', 'ref', 'path', 'blob_sha')
    missing = [k for k in required if not source.get(k)]
    if missing:
        raise SystemExit(f'remote-pdf source lock incomplete: missing {missing}')

    core.CACHE.mkdir(parents=True, exist_ok=True)
    expected_blob = source['blob_sha']
    dest = core.CACHE / f'source-{expected_blob}.pdf'
    if dest.exists():
        try:
            verified = _validate_locked_pdf(dest, source)
            return dest, {'transport': 'verified-cache', 'cache_hit': True, 'attempts': [], **verified}
        except RuntimeError:
            dest.unlink(missing_ok=True)

    attempts = []
    candidates = _remote_pdf_candidates(source)
    if not candidates:
        raise SystemExit('remote-pdf source has no usable binary transport')

    for transport, url, extra_headers in candidates:
        for attempt in (1, 2):
            part = dest.with_suffix(dest.suffix + '.part')
            part.unlink(missing_ok=True)
            headers = {
                'User-Agent': 'qiuzhidaren-source-fetch/2.0',
                'Accept-Encoding': 'identity',
                **extra_headers,
            }
            try:
                req = Request(url, headers=headers)
                with urlopen(req, timeout=90) as response, part.open('wb') as out:
                    shutil.copyfileobj(response, out, length=1024 * 1024)
                verified = _validate_locked_pdf(part, source)
                os.replace(part, dest)
                attempts.append({'transport': transport, 'attempt': attempt, 'ok': True})
                return dest, {'transport': transport, 'cache_hit': False, 'attempts': attempts, **verified}
            except (HTTPError, URLError, TimeoutError, OSError, RuntimeError) as exc:
                part.unlink(missing_ok=True)
                attempts.append({'transport': transport, 'attempt': attempt, 'ok': False, 'error': f'{type(exc).__name__}: {exc}'})
                if attempt == 1:
                    time.sleep(1)

    summary = '; '.join(f"{x['transport']}#{x['attempt']}={x.get('error','failed')}" for x in attempts)
    raise SystemExit(
        'all locked-source transports failed; source identity remains locked and no unverified mirror was used. '
        + summary
    )


_core_resolve_source_pages = core.resolve_source_pages


def resolve_source_pages(cfg, workspace):
    source = cfg['input']['source_pages']
    reviewed = _reviewed_source_pages(cfg, source)
    if reviewed is not None:
        return reviewed
    if os.environ.get('QZ_OFFLINE_SOURCE_DIR') or source.get('mode') != 'remote-pdf':
        return _core_resolve_source_pages(cfg, workspace)

    pdf, acquisition = _download_locked_pdf(source)
    pages = core._render_pdf_pages(pdf, source['pages'], source['blob_sha'][:16])
    provenance = {
        'resolution': 'remote-pdf-resilient',
        'canonical_source': True,
        'configured_mode': 'remote-pdf',
        'repo': source['repo'],
        'ref': source['ref'],
        'path': source['path'],
        'page_count': len(pages),
        'pdf_physical_pages': list(source['pages']),
        'expected_blob_sha': source['blob_sha'],
        'actual_blob_sha': acquisition['actual_blob_sha'],
        'source_size_bytes': acquisition['size_bytes'],
        'transport': acquisition['transport'],
        'cache_hit': acquisition['cache_hit'],
        'transport_attempts': acquisition['attempts'],
    }
    return pages, provenance


def source_transport_selftest():
    fixture = {
        'repo': 'owner/repo',
        'ref': '0123456789abcdef',
        'path': '目录/教材 A.pdf',
        'blob_sha': '0' * 40,
        'url': 'https://example.invalid/book.pdf',
    }
    names = [x[0] for x in _remote_pdf_candidates(fixture)]
    assert names == ['configured-url', 'github-raw', 'github-media', 'github-api-raw'], names
    url = _remote_pdf_candidates(fixture)[1][1]
    assert '%E7%9B%AE%E5%BD%95' in url and '%20' in url


core.resolve_source_pages = resolve_source_pages

if __name__ == '__main__':
    inline_selftest()
    notation_selftest()
    figure_registry_selftest()
    source_transport_selftest()
    input_gate_selftest()
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', default=None, help='repository-relative manifest; legacy current-run manifest is default')
    args = parser.parse_args()

    prebuild_start = time.perf_counter()
    input_errors = validate_teaching_demo_inputs(args.manifest)
    prebuild_seconds = time.perf_counter() - prebuild_start
    telemetry.record(
        'prebuild',
        prebuild_seconds,
        'FAIL' if input_errors else 'PASS',
        detail='; '.join(input_errors[:5]) if input_errors else None,
    )
    if input_errors:
        raise SystemExit('Teaching Demo prebuild input gate failed before composition:\n' + '\n'.join(input_errors))

    composition_start = time.perf_counter()
    try:
        core.main(args.manifest)
    except BaseException as exc:
        telemetry.record('composition', time.perf_counter() - composition_start, 'FAIL', detail=f'{type(exc).__name__}: {exc}')
        raise
    telemetry.record('composition', time.perf_counter() - composition_start, 'PASS')
