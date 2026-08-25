"""Small math-aware inline Markdown renderer for the canonical LaTeX publisher.

Supported atoms are intentionally narrow and deterministic: **bold**, $math$
and `code`. The parser is topic-agnostic and hard-fails unbalanced delimiters
before XeLaTeX can turn source mistakes into broken or misleading output.
"""
from __future__ import annotations

from collections.abc import Callable


class InlineMarkupError(ValueError):
    pass


def _find_unescaped(text: str, token: str, start: int) -> int:
    pos = start
    while True:
        pos = text.find(token, pos)
        if pos < 0:
            return -1
        slashes = 0
        j = pos - 1
        while j >= 0 and text[j] == '\\':
            slashes += 1
            j -= 1
        if slashes % 2 == 0:
            return pos
        pos += len(token)


def _escape_text(value: str, escape_plain: Callable[[str], str]) -> str:
    """Normalize the boundary between Markdown parsing and LaTeX escaping.

    Some legacy escape functions sequentially escape backslash and then braces,
    producing ``\\textbackslash\\{\\}`` instead of ``\\textbackslash{}``.
    Normalize that generic escape artifact here so code/plain paths cannot leak
    visible ``{}`` after backslashes. Correct single-pass escapers are unchanged.
    """
    rendered = escape_plain(value)
    return rendered.replace(r'\textbackslash\{\}', r'\textbackslash{}')


def render_inline(text: str, escape_plain: Callable[[str], str]) -> str:
    """Render supported inline markup while preserving math atoms verbatim.

    Backslash may escape a literal `$`, backtick, `*`, or backslash in plain
    text. The escaped delimiter is handed to the plain-text escaper, so LaTeX
    receives a real text glyph rather than entering math/code/bold mode.
    """
    text = text.strip()
    out: list[str] = []
    plain: list[str] = []
    bold = False
    i = 0

    def flush_plain() -> None:
        if plain:
            out.append(_escape_text(''.join(plain), escape_plain))
            plain.clear()

    while i < len(text):
        if text[i] == '\\' and i + 1 < len(text) and text[i + 1] in '$`*\\':
            plain.append(text[i + 1])
            i += 2
            continue

        if text.startswith('**', i):
            flush_plain()
            if bold:
                out.append('}')
                bold = False
            else:
                out.append(r'\textbf{')
                bold = True
            i += 2
            continue

        ch = text[i]
        if ch == '$':
            flush_plain()
            end = _find_unescaped(text, '$', i + 1)
            if end < 0:
                raise InlineMarkupError('unclosed inline math delimiter')
            if end == i + 1:
                raise InlineMarkupError('empty inline math atom')
            out.append(text[i:end + 1])
            i = end + 1
            continue

        if ch == '`':
            flush_plain()
            end = _find_unescaped(text, '`', i + 1)
            if end < 0:
                raise InlineMarkupError('unclosed inline code delimiter')
            out.append(r'\texttt{' + _escape_text(text[i + 1:end], escape_plain) + '}')
            i = end + 1
            continue

        plain.append(ch)
        i += 1

    flush_plain()
    if bold:
        raise InlineMarkupError('unclosed bold delimiter')
    return ''.join(out)


def selftest() -> None:
    def esc(value: str) -> str:
        return (value.replace('\\', r'\textbackslash{}')
                     .replace('&', r'\&')
                     .replace('$', r'\$'))

    def legacy_sequential_esc(value: str) -> str:
        for a, b in [
            ('\\', r'\textbackslash{}'), ('_', r'\_'), ('{', r'\{'), ('}', r'\}'),
        ]:
            value = value.replace(a, b)
        return value

    samples = {
        '**核心：观察 → 建模**': r'\textbf{核心：观察 → 建模}',
        '**关系：$F=ma$；方向由合力决定**': r'\textbf{关系：$F=ma$；方向由合力决定}',
        '前文 **$x_1/x_2$ 与 $t_1/t_2$** 后文': r'前文 \textbf{$x_1/x_2$ 与 $t_1/t_2$} 后文',
        '**量纲：$\mathrm{m/s}$；先统一单位**': r'\textbf{量纲：$\mathrm{m/s}$；先统一单位}',
        '`x1/x2` 是源码示例': r'\texttt{x1/x2} 是源码示例',
        'A&B': r'A\&B',
        r'价格写作 \$5，不进入数学模式': r'价格写作 \$5，不进入数学模式',
        r'字面 \* 不开启粗体': r'字面 * 不开启粗体',
    }
    for source, expected in samples.items():
        actual = render_inline(source, esc)
        if actual != expected:
            raise AssertionError(f'{source!r}: {actual!r} != {expected!r}')
        if '**' in actual:
            raise AssertionError(f'bold marker leaked: {source!r} -> {actual!r}')

    path = render_inline(r'`C:\tmp\a_b`', legacy_sequential_esc)
    if path != r'\texttt{C:\textbackslash{}tmp\textbackslash{}a\_b}':
        raise AssertionError(f'legacy backslash escape artifact not normalized: {path!r}')

    bad = [
        '**未闭合',
        '公式 $F=ma',
        '代码 `missing',
        '空公式 $$',
    ]
    for source in bad:
        try:
            render_inline(source, esc)
        except InlineMarkupError:
            pass
        else:
            raise AssertionError(f'unbalanced inline markup escaped: {source!r}')

    tricky = '**数学 $a^{**2}=b$ 后继续**'
    actual = render_inline(tricky, esc)
    if not (actual.startswith(r'\textbf{') and actual.endswith('}')):
        raise AssertionError('delimiter inside math atom disturbed bold parsing')


if __name__ == '__main__':
    selftest()
    print('latex inline selftest passed')
