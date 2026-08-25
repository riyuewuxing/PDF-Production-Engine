"""Generic BOARD_PLAN helpers.

BOARD_PLAN may contain topic-specific data, but these helpers do not know any
case-id naming convention and never manufacture user-visible B0/B1 engineering
labels. Internal point ids are consumed only through explicit [[BOARD:Pn]] markers.
"""
from pathlib import Path
import re
import yaml


class BoardCase(dict):
    """Case wrapper retaining a convenient increments view for legacy callers."""
    def increments(self):
        return dict.get(self, 'increments') or {}


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


def point_seq(md: str):
    """Return internal board-point ids in first-appearance order."""
    return list(dict.fromkeys(re.findall(r'\[\[BOARD:(P\d+)\]\]', md)))


def _increment_parts(item):
    if isinstance(item, dict):
        return str(item.get('label') or '同步板书'), str(item.get('text') or '')
    return '同步板书', str(item)


def board_lines(case):
    """User-facing total-board lines: content only, no synthetic B-index labels."""
    out = []
    for item in (case.get('increments') or {}).values():
        label, text = _increment_parts(item)
        if text:
            out.append(f'{label}｜{text}' if label and label != '同步板书' else text)
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
    """Expand markers from BOARD_PLAN labels/text without exposing point ids."""
    increments = case.get('increments') or {}
    for point in point_seq(md):
        if point not in increments:
            raise ValueError(f'board marker missing from BOARD_PLAN: {point}')
        label, text = _increment_parts(increments[point])
        md = md.replace(f'[[BOARD:{point}]]', board_box([text], f'同步板书 · {label}'))
    return md


def expected_markers(case):
    return [f'[[BOARD:{p}]]' for p in (case.get('increments') or {}).keys()]


def selftest():
    case = BoardCase({
        'id': 'SYNTH',
        'increments': {
            'P0': {'label': '1. 观察', 'text': '现象'},
            'P1': {'label': '2. 关系', 'text': '$F=ma$'},
        },
    })
    md = 'case_id: SYNTH\n[[BOARD:P0]]\n[[BOARD:P1]]\n'
    assert case_id(md) == 'SYNTH'
    assert point_seq(md) == ['P0', 'P1']
    expanded = expand_board_markers(md, case)
    assert 'P0' not in expanded and 'P1' not in expanded
    assert 'B0' not in expanded and 'B1' not in expanded
    assert '1. 观察' in expanded and '$F=ma$' in expanded


if __name__ == '__main__':
    selftest()
    print('generic board contract selftest: PASS')
