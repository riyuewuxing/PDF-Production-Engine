"""Topic-agnostic loader for declarative teaching-demo figure assets.

Concrete physics semantics live in `production/components/figures/*.tex` and the
registry YAML. Adding a new reusable/topic-specific figure must not require a new
publisher/checker branch: add a declarative asset and register its marker as data.
"""
from __future__ import annotations

from pathlib import Path
import re
import tempfile

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / 'production/components/figures/registry.yaml'
MARKER_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')


class FigureRegistryError(ValueError):
    pass


class UnknownFigureMarker(KeyError):
    pass


def _asset_map(registry_path: Path = REGISTRY) -> dict[str, Path]:
    try:
        data = yaml.safe_load(registry_path.read_text(encoding='utf-8')) or {}
    except Exception as exc:
        raise FigureRegistryError(f'figure registry unreadable: {exc}') from exc
    if data.get('version') != 1:
        raise FigureRegistryError('figure registry must use version: 1')
    raw = data.get('figures')
    if not isinstance(raw, dict) or not raw:
        raise FigureRegistryError('figure registry must define a non-empty figures mapping')

    base = registry_path.parent.resolve()
    out: dict[str, Path] = {}
    used_paths: set[Path] = set()
    for marker, spec in raw.items():
        if not isinstance(marker, str) or not MARKER_RE.fullmatch(marker):
            raise FigureRegistryError(f'invalid figure marker: {marker!r}')
        rel = spec.get('tex') if isinstance(spec, dict) else spec
        if not isinstance(rel, str) or not rel.endswith('.tex'):
            raise FigureRegistryError(f'{marker}: tex asset must be a .tex path')
        rel_path = Path(rel)
        if rel_path.is_absolute() or '..' in rel_path.parts:
            raise FigureRegistryError(f'{marker}: tex asset must stay inside figure asset root')
        path = (base / rel_path).resolve()
        if path.parent != base:
            raise FigureRegistryError(f'{marker}: nested/escaped asset paths are not allowed')
        if not path.exists() or not path.is_file():
            raise FigureRegistryError(f'{marker}: figure asset missing: {rel}')
        if path in used_paths:
            raise FigureRegistryError(f'{marker}: figure asset path reused: {rel}')
        used_paths.add(path)
        out[marker] = path
    return out


def available_figures(registry_path: Path = REGISTRY) -> tuple[str, ...]:
    return tuple(sorted(_asset_map(registry_path)))


def figure_tex(name: str, registry_path: Path = REGISTRY) -> str:
    assets = _asset_map(registry_path)
    path = assets.get(name)
    if path is None:
        raise UnknownFigureMarker(f'unregistered figure marker: {name}')
    tex = path.read_text(encoding='utf-8').strip()
    if not tex or '\\begin{figurepanel}' not in tex or '\\end{figurepanel}' not in tex:
        raise FigureRegistryError(f'{name}: asset must render one figurepanel')
    if '\\node[' in tex and 'qzlabel' not in tex:
        raise FigureRegistryError(f'{name}: labeled figure must use qzlabel clearance style')
    return tex + '\n'


def selftest() -> None:
    names = available_figures()
    if not names:
        raise AssertionError('figure registry unexpectedly empty')
    for name in names:
        figure_tex(name)
    try:
        figure_tex('__synthetic-missing__')
    except UnknownFigureMarker:
        pass
    else:
        raise AssertionError('unknown figure marker must hard fail')

    # Synthetic data proves the loader has no dependency on any real lesson.
    with tempfile.TemporaryDirectory(prefix='qz-figure-registry-') as tmp:
        d = Path(tmp)
        (d / 'shape.tex').write_text(
            '\\begin{figurepanel}{Synthetic}\\begin{tikzpicture}\\draw (0,0)--(1,0);\\end{tikzpicture}\\end{figurepanel}\n',
            encoding='utf-8',
        )
        reg = d / 'registry.yaml'
        reg.write_text(
            'version: 1\nfigures:\n  synthetic-shape:\n    tex: shape.tex\n',
            encoding='utf-8',
        )
        assert available_figures(reg) == ('synthetic-shape',)
        assert 'Synthetic' in figure_tex('synthetic-shape', reg)

        reg.write_text(
            'version: 1\nfigures:\n  bad:\n    tex: ../escape.tex\n',
            encoding='utf-8',
        )
        try:
            available_figures(reg)
        except FigureRegistryError:
            pass
        else:
            raise AssertionError('figure path traversal escaped registry gate')


if __name__ == '__main__':
    selftest()
    print('declarative physics figure registry selftest: PASS')
