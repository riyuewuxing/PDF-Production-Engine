"""Generic BOARD_PLAN helpers.

Teaching points and visible board-writing events are different concepts.
A point may create zero, one, or multiple board fragments. New cases therefore use
``fragments`` with explicit ``point_id`` lineage and ``[[BOARD:B<n>]]`` markers.
Legacy ``increments`` keyed by P<n> remain readable for historical artifacts.
"""
from pathlib import Path
import re
import yaml

MARKER_RE = re.compile(r"\[\[BOARD:([PB]\d+)\]\]")
POINT_ID_RE = re.compile(r"^P\d+$")
FRAGMENT_ID_RE = re.compile(r"^[PB]\d+$")


class BoardCase(dict):
    """Case wrapper retaining compatibility with older callers."""
    def increments(self):
        return dict.get(self, 'increments') or {}

    def fragments(self):
        return fragment_map(self)


def load_board_cases(batch_dir: Path):
    path = batch_dir / 'BOARD_PLAN.yaml'
    data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    cases = {}
    for case in data.get('cases') or []:
        wrapped = BoardCase(case)
        cid = wrapped.get('id')
        if not cid:
            raise ValueError(f'BOARD_PLAN case missing id: {path}')
        if cid in cases:
            raise ValueError(f'duplicate BOARD_PLAN case id: {cid}')
        cases[cid] = wrapped
    return cases


def case_id(md: str):
    """Read an explicit case_id metadata line; never infer a project naming pattern."""
    m = re.search(r'(?m)^\s*case_id\s*:\s*([^\s#]+)\s*$', md)
    return m.group(1) if m else None


def marker_seq(md: str):
    """Return board-fragment marker ids in first-appearance order, preserving repeats."""
    return MARKER_RE.findall(md)


def point_seq(md: str):
    """Legacy alias retained for callers; values are marker ids, not point semantics."""
    return list(dict.fromkeys(marker_seq(md)))


def _legacy_increment_parts(fragment_id, item):
    if isinstance(item, dict):
        label = str(item.get('label') or '板书')
        text = str(item.get('text') or '')
        point_id = str(item.get('point_id') or (fragment_id if POINT_ID_RE.fullmatch(fragment_id) else ''))
        return point_id, label, text
    point_id = fragment_id if POINT_ID_RE.fullmatch(fragment_id) else ''
    return point_id, '板书', str(item)


def fragment_map(case):
    """Normalize v2 ``fragments`` or historical ``increments`` to one mapping.

    Output values always contain ``point_id``, ``label`` and ``text``.  Historical
    P<n>-keyed increments are interpreted as one fragment belonging to the same P<n>.
    """
    raw = case.get('fragments')
    if raw is not None:
        if not isinstance(raw, dict):
            raise ValueError('BOARD_PLAN fragments must be a mapping')
        out = {}
        for fragment_id, item in raw.items():
            if not isinstance(fragment_id, str) or not FRAGMENT_ID_RE.fullmatch(fragment_id):
                raise ValueError(f'invalid board fragment id: {fragment_id!r}')
            if not isinstance(item, dict):
                raise ValueError(f'board fragment must be mapping: {fragment_id}')
            point_id = str(item.get('point_id') or '')
            label = str(item.get('label') or '板书')
            text = str(item.get('text') or '')
            out[fragment_id] = {'point_id': point_id, 'label': label, 'text': text}
        return out

    raw = case.get('increments') or {}
    if not isinstance(raw, dict):
        raise ValueError('BOARD_PLAN increments must be a mapping')
    out = {}
    for fragment_id, item in raw.items():
        point_id, label, text = _legacy_increment_parts(str(fragment_id), item)
        out[str(fragment_id)] = {'point_id': point_id, 'label': label, 'text': text}
    return out


def board_fragment(case, fragment_id):
    fragments = fragment_map(case)
    if fragment_id not in fragments:
        raise ValueError(f'board marker missing from BOARD_PLAN: {fragment_id}')
    item = fragments[fragment_id]
    return item['point_id'], item['label'], item['text']


def board_lines(case):
    """User-facing final-board lines in exact fragment order; no engineering ids."""
    out = []
    for item in fragment_map(case).values():
        label, text = item['label'], item['text']
        if text:
            out.append(f'{label}｜{text}' if label and label != '板书' else text)
    return out


def board_box(lines, label='总板书'):
    body = [f'【{label}】'] + list(lines)
    return ':::board\n' + '\n'.join(body) + '\n:::'


def append_total_board(md: str, case, heading='板书设计（总板书）'):
    """Append one deterministic total board when a document does not already have it."""
    if heading in md:
        return md
    return md.rstrip() + f'\n\n## {heading}\n' + board_box(board_lines(case), '总板书') + '\n'


def expand_board_markers(md: str, case):
    """Expand exact writing events without exposing B/P engineering ids."""
    for fragment_id in list(dict.fromkeys(marker_seq(md))):
        _, label, text = board_fragment(case, fragment_id)
        md = md.replace(f'[[BOARD:{fragment_id}]]', board_box([text], f'板书 · {label}'))
    return md


def expected_markers(case):
    return [f'[[BOARD:{fragment_id}]]' for fragment_id in fragment_map(case).keys()]


def selftest():
    # New model: two board moments may belong to the same teaching point.
    case = BoardCase({
        'id': 'SYNTH',
        'fragments': {
            'B0': {'point_id': 'P0', 'label': '问题', 'text': '为什么？'},
            'B1': {'point_id': 'P1', 'label': '1. 实验', 'text': '固定 x，改变 y'},
            'B2': {'point_id': 'P1', 'label': '1. 实验（续）', 'text': '安全条件'},
        },
    })
    md = 'case_id: SYNTH\n[[BOARD:B0]]\n[[BOARD:B1]]\n[[BOARD:B2]]\n'
    assert case_id(md) == 'SYNTH'
    assert marker_seq(md) == ['B0', 'B1', 'B2']
    assert board_fragment(case, 'B2')[0] == 'P1'
    expanded = expand_board_markers(md, case)
    assert 'B0' not in expanded and 'B1' not in expanded and 'B2' not in expanded
    assert '问题' in expanded and '安全条件' in expanded

    # Historical model remains readable.
    legacy = BoardCase({'id': 'OLD', 'increments': {'P0': {'label': '1. 观察', 'text': '现象'}}})
    assert board_fragment(legacy, 'P0') == ('P0', '1. 观察', '现象')


if __name__ == '__main__':
    selftest()
    print('generic board contract selftest: PASS')
