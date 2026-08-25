#!/usr/bin/env python3
"""Generic PDF text-occupancy evidence for visual QA.

The metric is intentionally narrow: for text-bearing pages, derive the vertical span of
all text bounding boxes from ``pdftotext -bbox-layout``. Very low occupancy is a strong
signal for abnormal whitespace/layout collapse, but it never replaces HUMAN page review.
"""
from __future__ import annotations
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
from typing import Any


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def analyze_pdf(pdf: Path) -> list[dict[str, Any]]:
    proc = subprocess.run(
        ["pdftotext", "-bbox-layout", str(pdf), "-"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode:
        raise RuntimeError(f"pdftotext -bbox-layout failed for {pdf.name}: {proc.stdout}")
    try:
        root = ET.fromstring(proc.stdout)
    except ET.ParseError as exc:
        raise RuntimeError(f"bbox XML parse failed for {pdf.name}: {exc}") from exc

    metrics: list[dict[str, Any]] = []
    page_no = 0
    for page in root.iter():
        if _local(page.tag) != "page":
            continue
        page_no += 1
        try:
            width = float(page.attrib["width"])
            height = float(page.attrib["height"])
        except (KeyError, ValueError) as exc:
            raise RuntimeError(f"bbox page dimensions invalid: {pdf.name} page {page_no}") from exc
        words = []
        for node in page.iter():
            if _local(node.tag) != "word" or not (node.text or "").strip():
                continue
            try:
                words.append(
                    (
                        float(node.attrib["xMin"]), float(node.attrib["yMin"]),
                        float(node.attrib["xMax"]), float(node.attrib["yMax"]),
                    )
                )
            except (KeyError, ValueError):
                continue
        if words and width > 0 and height > 0:
            x_min = min(x[0] for x in words); y_min = min(x[1] for x in words)
            x_max = max(x[2] for x in words); y_max = max(x[3] for x in words)
            width_fraction = max(0.0, min(1.0, (x_max - x_min) / width))
            height_fraction = max(0.0, min(1.0, (y_max - y_min) / height))
        else:
            x_min = y_min = x_max = y_max = None
            width_fraction = height_fraction = 0.0
        metrics.append(
            {
                "page": page_no,
                "word_count": len(words),
                "page_width": round(width, 3),
                "page_height": round(height, 3),
                "bbox": None if not words else {
                    "x_min": round(x_min, 3), "y_min": round(y_min, 3),
                    "x_max": round(x_max, 3), "y_max": round(y_max, 3),
                },
                "bbox_width_fraction": round(width_fraction, 6),
                "bbox_height_fraction": round(height_fraction, 6),
            }
        )
    if not metrics:
        raise RuntimeError(f"no pages found in bbox XML for {pdf.name}")
    return metrics


def validate_policy(policy: Any) -> list[str]:
    if not isinstance(policy, dict):
        return ["VISUAL_OCCUPANCY_POLICY_NOT_MAPPING"]
    errors: list[str] = []
    if policy.get("enabled") is not True:
        errors.append("VISUAL_OCCUPANCY_POLICY_MUST_BE_ENABLED")
    min_words = policy.get("min_words_for_check")
    warn = policy.get("warn_below_text_bbox_height_fraction")
    hard = policy.get("hard_fail_below_text_bbox_height_fraction")
    if not isinstance(min_words, int) or min_words < 1:
        errors.append("VISUAL_OCCUPANCY_MIN_WORDS_INVALID")
    for name, value in (("warn", warn), ("hard", hard)):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 < float(value) < 1:
            errors.append(f"VISUAL_OCCUPANCY_{name.upper()}_FRACTION_INVALID")
    if isinstance(warn, (int, float)) and isinstance(hard, (int, float)) and float(hard) > float(warn):
        errors.append("VISUAL_OCCUPANCY_HARD_THRESHOLD_MUST_NOT_EXCEED_WARN_THRESHOLD")
    return errors


def evaluate(metrics: list[dict[str, Any]], policy: dict) -> tuple[list[str], list[str]]:
    policy_errors = validate_policy(policy)
    if policy_errors:
        return [], policy_errors
    min_words = int(policy["min_words_for_check"])
    warn_threshold = float(policy["warn_below_text_bbox_height_fraction"])
    hard_threshold = float(policy["hard_fail_below_text_bbox_height_fraction"])
    warnings: list[str] = []
    errors: list[str] = []
    for page in metrics:
        words = int(page.get("word_count") or 0)
        if words < min_words:
            continue
        frac = float(page.get("bbox_height_fraction") or 0.0)
        detail = f"page={page.get('page')} words={words} bbox_height_fraction={frac:.5f}"
        if frac < hard_threshold:
            errors.append("VISUAL_OCCUPANCY_HARD_FAIL: " + detail)
        elif frac < warn_threshold:
            warnings.append("VISUAL_OCCUPANCY_WARNING: " + detail)
    return warnings, errors


def selftest() -> None:
    policy = {
        "enabled": True,
        "min_words_for_check": 20,
        "warn_below_text_bbox_height_fraction": 0.32,
        "hard_fail_below_text_bbox_height_fraction": 0.26,
    }
    assert not validate_policy(policy)
    metrics = [
        {"page": 1, "word_count": 50, "bbox_height_fraction": 0.60},
        {"page": 2, "word_count": 30, "bbox_height_fraction": 0.29},
        {"page": 3, "word_count": 30, "bbox_height_fraction": 0.25391},
        {"page": 4, "word_count": 5, "bbox_height_fraction": 0.10},
    ]
    warnings, errors = evaluate(metrics, policy)
    if len(warnings) != 1 or "page=2" not in warnings[0]:
        raise AssertionError(f"occupancy warning selftest drift: {warnings}")
    if len(errors) != 1 or "page=3" not in errors[0]:
        raise AssertionError(f"historical low-occupancy failure escaped: {errors}")
    bad = dict(policy); bad["hard_fail_below_text_bbox_height_fraction"] = 0.5
    if not validate_policy(bad):
        raise AssertionError("invalid occupancy thresholds escaped")


if __name__ == "__main__":
    selftest()
    print("PASS: PDF text occupancy selftest")
