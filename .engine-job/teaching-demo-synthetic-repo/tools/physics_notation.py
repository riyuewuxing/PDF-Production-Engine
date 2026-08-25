"""Reusable physics notation/semantic lint for teacher trial-lesson artifacts.

The gate is topic-agnostic. It catches cheap, high-confidence defects before an
expensive PDF build/render: malformed math markup, risky Unicode math glyphs that
have caused missing-font output, and a small set of physics-language contradictions
whose semantics are invariant enough to fail closed.
"""
from __future__ import annotations
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class NotationIssue:
    code: str
    fragment: str


def math_fragments(text: str) -> list[str]:
    return re.findall(r'\$([^$]+)\$', text, flags=re.S)


def lint_math_fragment(fragment: str) -> list[NotationIssue]:
    compact = re.sub(r'\s+', '', fragment)
    issues: list[NotationIssue] = []
    if re.search(r'E_\{k,\d+\}', compact):
        issues.append(NotationIssue('PHYSICS_SUBSCRIPT_COMMA', fragment))
    if re.search(r'E_k\d', compact):
        issues.append(NotationIssue('PHYSICS_COMPOSITE_SUBSCRIPT_UNBRACED', fragment))
    if re.search(r'(?<![A-Za-z\\_{])([A-Za-z])([0-9]+)(?![A-Za-z0-9_}])', compact):
        issues.append(NotationIssue('PHYSICS_NUMERIC_SUBSCRIPT_MISSING', fragment))
    if re.search(r'[A-Za-z][\u4e00-\u9fff]', compact):
        issues.append(NotationIssue('PHYSICS_SEMANTIC_SUBSCRIPT_NOT_LATEX', fragment))
    return issues


def lint_math_inside_code(text: str) -> list[NotationIssue]:
    issues: list[NotationIssue] = []
    for match in re.finditer(r'`([^`\n]*)`', text):
        code = match.group(1)
        if '$' in code:
            issues.append(NotationIssue('PHYSICS_MATH_MARKUP_INSIDE_CODE', match.group(0)))
    return issues


def _prose_without_math_or_code(text: str) -> str:
    text = re.sub(r'```.*?```', ' ', text, flags=re.S)
    text = re.sub(r'`[^`]*`', ' ', text)
    return re.sub(r'\$[^$]+\$', ' ', text, flags=re.S)


def lint_formula_outside_math(text: str) -> list[NotationIssue]:
    issues: list[NotationIssue] = []
    prose = _prose_without_math_or_code(text)
    pattern = re.compile(
        r'(?<![A-Za-z0-9_])((?:\\?[A-Za-zΔΦ][A-Za-z0-9_{}\\\u4e00-\u9fff]*|[A-Za-zΔΦ])'
        r'(?:\s*/\s*(?:\\?[A-Za-zΔΦ][A-Za-z0-9_{}\\\u4e00-\u9fff]*))?\s*(?:=|≈|∝|≤|≥|≠))'
    )
    for match in pattern.finditer(prose):
        start = max(0, match.start() - 20)
        end = min(len(prose), match.end() + 35)
        fragment = re.sub(r'\s+', ' ', prose[start:end]).strip()
        issues.append(NotationIssue('PHYSICS_FORMULA_OUTSIDE_MATH', fragment))
    return issues


def lint_risky_unicode_math(text: str) -> list[NotationIssue]:
    """Reject Unicode stand-ins that have produced missing glyphs in canonical PDFs.

    Mathematical meaning should be expressed through LaTeX commands inside math mode
    (for example ``$a\\perp b$`` and ``$v_m$``), not by relying on a font containing
    every Unicode math/subscript codepoint.
    """
    issues: list[NotationIssue] = []
    for match in re.finditer(r'[⟂⊥]', text):
        start = max(0, match.start() - 18)
        end = min(len(text), match.end() + 18)
        issues.append(NotationIssue('PHYSICS_RISKY_UNICODE_PERPENDICULAR', text[start:end].replace('\n', ' ')))
    for match in re.finditer(r'[\u2070-\u209f]', text):
        start = max(0, match.start() - 18)
        end = min(len(text), match.end() + 18)
        issues.append(NotationIssue('PHYSICS_RISKY_UNICODE_SCRIPT_CHAR', text[start:end].replace('\n', ' ')))
    return issues


_RESISTANCE_DIRECTION_PATTERNS = (
    re.compile(r'阻力(?:的)?方向(?:始终|总是)?\s*(?:沿|顺着)\s*(?:物体的?)?运动方向'),
    re.compile(r'阻力(?:的)?方向\s*与\s*(?:物体的?)?运动方向\s*(?:相同|一致|同向)'),
    re.compile(r'阻力(?:始终|总是)?\s*(?:沿|顺着)\s*(?:物体的?)?运动方向'),
)


def lint_high_confidence_physics_semantics(text: str) -> list[NotationIssue]:
    """Catch only context-independent contradictions learned from real failures.

    Do not broaden this into a heuristic physics grader. A statement is rejected here
    only when the wording itself contradicts the named physical quantity, such as
    declaring a resistance force to point along the motion direction.
    """
    issues: list[NotationIssue] = []
    for pattern in _RESISTANCE_DIRECTION_PATTERNS:
        for match in pattern.finditer(text):
            start = max(0, match.start() - 20)
            end = min(len(text), match.end() + 24)
            issues.append(NotationIssue('PHYSICS_RESISTANCE_DIRECTION_CONTRADICTION', text[start:end].replace('\n', ' ')))
    return issues


def lint_text(text: str, *, require_math_mode: bool = True) -> list[NotationIssue]:
    issues: list[NotationIssue] = []
    issues.extend(lint_math_inside_code(text))
    issues.extend(lint_risky_unicode_math(text))
    issues.extend(lint_high_confidence_physics_semantics(text))
    for fragment in math_fragments(text):
        issues.extend(lint_math_fragment(fragment))
    if require_math_mode:
        issues.extend(lint_formula_outside_math(text))
    return issues


def selftest() -> None:
    good = [
        r'$E_k=\frac12mv^2$',
        r'$E_{k2}-E_{k1}=\Delta E_k$',
        r'$v_1^2-v_2^2$',
        r'$W_{\text{总}}=\sum_iW_i$',
        r'$\frac{U_1}{U_2}=\frac{n_1}{n_2}$',
        r'$U_1I_1=U_2I_2$',
        r'$\frac{I_1}{I_2}=\frac{n_2}{n_1}$',
        r'$P_{\text{入}}=P_{\text{出}}$',
        r'$a\perp b$',
        '阻力方向与运动方向相反。',
        '摩擦力方向需要依据相对运动趋势判断。',
        'PDF1 与 PDF2 是文件编号，不是物理公式。',
        r'代码示例 `F=ma` 不作为正文公式解析。',
    ]
    bad = {
        r'$E_{k,2}-E_{k,1}$': 'PHYSICS_SUBSCRIPT_COMMA',
        r'$E_k2-E_k1$': 'PHYSICS_COMPOSITE_SUBSCRIPT_UNBRACED',
        r'$v1+v2$': 'PHYSICS_NUMERIC_SUBSCRIPT_MISSING',
        r'$U1/U2=n1/n2$': 'PHYSICS_NUMERIC_SUBSCRIPT_MISSING',
        r'$I1/I2=n2/n1$': 'PHYSICS_NUMERIC_SUBSCRIPT_MISSING',
        r'$B1,T2,R3$': 'PHYSICS_NUMERIC_SUBSCRIPT_MISSING',
        r'$W总=\Delta E_k$': 'PHYSICS_SEMANTIC_SUBSCRIPT_NOT_LATEX',
        r'$P入=P出$': 'PHYSICS_SEMANTIC_SUBSCRIPT_NOT_LATEX',
        r'$U输=220\,\mathrm{V}$': 'PHYSICS_SEMANTIC_SUBSCRIPT_NOT_LATEX',
        'F=ma': 'PHYSICS_FORMULA_OUTSIDE_MATH',
        'W总=Ek2-Ek1': 'PHYSICS_FORMULA_OUTSIDE_MATH',
        'U1/U2=n1/n2': 'PHYSICS_FORMULA_OUTSIDE_MATH',
        r'这里误写成 `$F=ma$`': 'PHYSICS_MATH_MARKUP_INSIDE_CODE',
        '两直线关系写成 a ⟂ b': 'PHYSICS_RISKY_UNICODE_PERPENDICULAR',
        '速度写作 vₘ': 'PHYSICS_RISKY_UNICODE_SCRIPT_CHAR',
        '阻力沿运动方向，故功写成负值。': 'PHYSICS_RESISTANCE_DIRECTION_CONTRADICTION',
        '阻力的方向与物体运动方向相同。': 'PHYSICS_RESISTANCE_DIRECTION_CONTRADICTION',
    }
    for sample in good:
        found = lint_text(sample)
        if found:
            raise AssertionError(f'good sample rejected: {sample}: {found}')
    for sample, expected in bad.items():
        codes = {x.code for x in lint_text(sample)}
        if expected not in codes:
            raise AssertionError(f'bad sample escaped: {sample}: expected {expected}, got {codes}')
    generated_tex = r'\geometry{left=2.5cm}\tikzset{qzlabel/.style={fill=white}} $F=ma$'
    found = lint_text(generated_tex, require_math_mode=False)
    if found:
        raise AssertionError(f'generated TeX structural assignments falsely rejected: {found}')


if __name__ == '__main__':
    selftest()
    print('physics notation/semantic selftest passed')
