"""Generic handwriting-density gate for teaching-demo exam skeletons.

The gate measures navigation density, not lesson semantics. It rejects prose-like
mini lesson plans even if they fit on one PDF page. Thresholds are supplied by a
shared profile mapping so no topic/case/title appears in this module.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import json
import re
from typing import Any

MATH_RE = re.compile(r"\$(?:\\.|[^$])+\$")
HTML_RE = re.compile(r"<!--.*?-->")
HEADING_RE = re.compile(r"^#{1,6}\s+")
BULLET_RE = re.compile(r"^(?:[-*+]\s+|\d+[.)、]\s*)")
MARKER_RE = re.compile(r"^\[\[(?:BOARD|FIGURE):[^\]]+\]\]$")
TEX_COMMAND_RE = re.compile(r"\\[A-Za-z]+\*?")
MARKUP_RE = re.compile(r"[*_`#{}\\]")
SPACE_RE = re.compile(r"\s+")
PUNCT_RE = re.compile(r"[，。！？；：,.!?;:]")
TERMINAL_RE = re.compile(r"[。！？!?]$")
ARROW_RE = re.compile(r"(?:→|⇒|↔|⟶|->|=>|<->|\|)")

DEFAULT_PROFILE: dict[str, Any] = {
    "max_nonspace_chars": 800,
    "min_content_lines": 7,
    "max_content_lines": 28,
    "max_avg_visible_chars_per_line": 46.0,
    "max_single_line_visible_chars": 96,
    "max_full_sentence_ratio": 0.30,
    "min_cue_line_ratio": 0.60,
    "max_long_prose_lines": 2,
}


@dataclass(frozen=True)
class SkeletonMetrics:
    nonspace_chars: int
    content_lines: int
    avg_visible_chars_per_line: float
    max_visible_chars_in_line: int
    full_sentence_lines: int
    full_sentence_ratio: float
    cue_lines: int
    cue_line_ratio: float
    long_prose_lines: int
    heading_lines: int


@dataclass(frozen=True)
class DensityIssue:
    code: str
    detail: str


def _visible_formula(match: re.Match[str]) -> str:
    """Approximate handwritten visual load of a TeX formula without parsing TeX."""
    s = match.group(0)[1:-1]
    s = TEX_COMMAND_RE.sub("", s)
    s = MARKUP_RE.sub("", s)
    s = SPACE_RE.sub("", s)
    return s


def _visible_text(line: str) -> str:
    line = HTML_RE.sub("", line.strip())
    line = BULLET_RE.sub("", line)
    line = MATH_RE.sub(_visible_formula, line)
    line = TEX_COMMAND_RE.sub("", line)
    line = MARKUP_RE.sub("", line)
    return SPACE_RE.sub("", line)


def analyze(text: str) -> SkeletonMetrics:
    total_chars = 0
    lengths: list[int] = []
    full_sentence = 0
    cues = 0
    long_prose = 0
    headings = 0

    for raw in text.splitlines():
        line = raw.strip()
        if not line or MARKER_RE.fullmatch(line):
            continue
        if HEADING_RE.match(line):
            headings += 1
            continue

        bullet = bool(BULLET_RE.match(line))
        has_math = bool(MATH_RE.search(line))
        arrowish = bool(ARROW_RE.search(line)) or "｜" in line
        visible = _visible_text(line)
        if not visible:
            continue
        n = len(visible)
        lengths.append(n)
        total_chars += n

        punct = len(PUNCT_RE.findall(visible))
        sentence_like = bool(TERMINAL_RE.search(visible)) or (n >= 50 and punct >= 4 and not arrowish)
        if sentence_like:
            full_sentence += 1

        cue_like = (
            n <= 56
            and (
                bullet
                or has_math
                or arrowish
                or "：" in line
                or "?" in line
                or "？" in line
            )
            and not (n >= 42 and punct >= 3)
        )
        if cue_like:
            cues += 1

        if n >= 48 and punct >= 2 and not (arrowish or has_math):
            long_prose += 1

    count = len(lengths)
    avg = (sum(lengths) / count) if count else 0.0
    max_len = max(lengths) if lengths else 0
    return SkeletonMetrics(
        nonspace_chars=total_chars,
        content_lines=count,
        avg_visible_chars_per_line=round(avg, 2),
        max_visible_chars_in_line=max_len,
        full_sentence_lines=full_sentence,
        full_sentence_ratio=round(full_sentence / count, 3) if count else 0.0,
        cue_lines=cues,
        cue_line_ratio=round(cues / count, 3) if count else 0.0,
        long_prose_lines=long_prose,
        heading_lines=headings,
    )


def validate(text: str, profile: dict[str, Any] | None = None) -> tuple[SkeletonMetrics, list[DensityIssue]]:
    p = dict(DEFAULT_PROFILE)
    if profile:
        p.update(profile)
    m = analyze(text)
    issues: list[DensityIssue] = []

    def add(code: str, detail: str) -> None:
        issues.append(DensityIssue(code, detail))

    if m.nonspace_chars > int(p["max_nonspace_chars"]):
        add("SKELETON_HANDWRITING_LOAD", f"{m.nonspace_chars}>{p['max_nonspace_chars']}")
    if m.content_lines < int(p["min_content_lines"]):
        add("SKELETON_TOO_FEW_CUES", f"{m.content_lines}<{p['min_content_lines']}")
    if m.content_lines > int(p["max_content_lines"]):
        add("SKELETON_TOO_MANY_LINES", f"{m.content_lines}>{p['max_content_lines']}")
    if m.avg_visible_chars_per_line > float(p["max_avg_visible_chars_per_line"]):
        add("SKELETON_LINE_DENSITY", f"avg={m.avg_visible_chars_per_line}>{p['max_avg_visible_chars_per_line']}")
    if m.max_visible_chars_in_line > int(p["max_single_line_visible_chars"]):
        add("SKELETON_SINGLE_LINE_OVERLOAD", f"max={m.max_visible_chars_in_line}>{p['max_single_line_visible_chars']}")
    if m.full_sentence_ratio > float(p["max_full_sentence_ratio"]):
        add("SKELETON_TOO_PROSE_LIKE", f"ratio={m.full_sentence_ratio}>{p['max_full_sentence_ratio']}")
    if m.cue_line_ratio < float(p["min_cue_line_ratio"]):
        add("SKELETON_CUE_RATIO_LOW", f"ratio={m.cue_line_ratio}<{p['min_cue_line_ratio']}")
    if m.long_prose_lines > int(p["max_long_prose_lines"]):
        add("SKELETON_LONG_PROSE", f"{m.long_prose_lines}>{p['max_long_prose_lines']}")
    return m, issues


def selftest() -> None:
    good = r'''# synthetic
## 目标/重难点/方法
- 目：现象→关系；重：规律｜难：边界｜法：实验+追问
## 教学过程
### 导
现象冲突 → 为什么？
### 授
- 装置：A→B；测 $x_1,x_2$
- 控量：定 A，变 B → 记录
- 图像：点→线 → 读斜率
- 结论：$y=kx$；条件：C
### 结/作
主线：现象→实验→图像→规律｜作：一图一问
'''
    m, issues = validate(good)
    if issues:
        raise AssertionError((m, issues))

    verbose = '''# synthetic\n## 教学过程\n同学们今天我们首先来观察这样一个生活中的现象，然后请大家认真思考它为什么会发生，并尝试结合以前学过的知识解释这个现象。\n接下来教师将组织学生进行实验，并且在实验过程中提醒大家注意控制变量、记录数据和分析误差，从而逐步得到我们今天需要学习的重要规律。\n最后我们还要联系生活实际，通过一道综合练习来巩固今天所学习的知识，并进一步理解这个规律的适用条件和物理意义。\n'''
    _, bad = validate(verbose)
    codes = {x.code for x in bad}
    if not ({"SKELETON_TOO_PROSE_LIKE", "SKELETON_CUE_RATIO_LOW"} & codes):
        raise AssertionError(codes)

    overloaded = "# synthetic\n## 授\n" + "\n".join(
        f"- 第{i}点：" + "关键词" * 22 + "→结论" for i in range(1, 22)
    )
    _, bad = validate(overloaded)
    if "SKELETON_HANDWRITING_LOAD" not in {x.code for x in bad}:
        raise AssertionError(bad)


def to_json(metrics: SkeletonMetrics, issues: list[DensityIssue]) -> str:
    return json.dumps(
        {"metrics": asdict(metrics), "issues": [asdict(x) for x in issues]},
        ensure_ascii=False,
        indent=2,
    )


if __name__ == "__main__":
    selftest()
    print("skeleton density selftest: PASS")
