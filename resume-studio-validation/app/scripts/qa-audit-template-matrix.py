"""Synthetic-only native PDF regression gate (QA dependency: PyMuPDF==1.26.7).
Run after the Windows Electron matrix, never against a personal resume directory.
The sparse-page threshold is diagnostic, not an aesthetic pass/fail criterion.
"""
import argparse
import collections
import json
import os
from pathlib import Path
import re
import unicodedata

import fitz


def normalize(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).casefold()


def audit(root, locale, modes, source_sha, runner_sha):
    manifest = json.loads((root / "matrix-manifest.json").read_text(encoding="utf-8"))
    if (not manifest.get("complete") or manifest.get("platform") != "win32"
            or manifest.get("locale") != locale or manifest.get("sourceSha") != source_sha
            or manifest.get("runnerSha") != runner_sha or not manifest.get("electron")):
        raise ValueError("Invalid or mismatched Windows matrix evidence identity")
    count = manifest.get("registryCount")
    if not isinstance(count, int) or count <= 0:
        raise ValueError("Invalid registry count")
    cases = manifest.get("cases", [])
    seen = set()
    by_mode = collections.defaultdict(set)
    report = {"locale": locale, "sourceSha": source_sha, "runnerSha": runner_sha,
              "electron": manifest["electron"], "cases": [], "issues": []}

    for c in cases:
        mode, template = c["mode"], c["templateId"]
        key = (mode, template)
        if (mode not in modes or not re.fullmatch(r"[a-z0-9-]+", template)
                or key in seen or c["file"] != mode + "--" + template + ".pdf"):
            raise ValueError("Unexpected, unsafe or duplicate matrix case")
        seen.add(key)
        by_mode[mode].add(template)
        file = root / c["file"]
        if c["status"] != "rendered" or not file.is_file() or file.stat().st_size != c["bytes"]:
            raise ValueError("Missing, failed or size-mismatched case: " + str(key))
        email = [v for v in c["expected"] if v.startswith("qa-") and v.endswith(".invalid") and "@" in v]
        if len(email) != 1 or not c.get("hidden"):
            raise ValueError("Missing synthetic contact/visibility probes")
        row = {"mode": mode, "templateId": template, "issues": [], "pages": 0,
               "minContinuationTopPt": None, "minContinuationBottomPt": None,
               "sparseNonfinal": 0}
        with fitz.open(file) as pdf:
            row["pages"] = len(pdf)
            if not len(pdf):
                row["issues"].append("empty PDF")
            else:
                text = "\n".join(page.get_text("text") for page in pdf)
                flat = normalize(text)
                missing = [v for v in c["expected"] if normalize(v) not in flat]
                hidden = [v for v in c["hidden"] if normalize(v) in flat]
                if missing:
                    row["issues"].append("missing synthetic markers: " + repr(missing))
                if hidden:
                    row["issues"].append("hidden markers leaked: " + repr(hidden))
                if normalize(email[0]) not in normalize(pdf[0].get_text("text")):
                    row["issues"].append("first-page email incomplete")
                if "\ufffd" in text or re.search(r"[\u2e80-\u2fdf\uf900-\ufaff\ufe30-\ufe4f]", text):
                    row["issues"].append("replacement/compatibility characters")
            if mode == "compact" and len(pdf) != 1:
                row["issues"].append("compact fixture must be one page")
            if mode == "extended" and len(pdf) != 2:
                row["issues"].append("forced-break fixture must be two pages")
            for i, page in enumerate(pdf):
                w, h = page.rect.width, page.rect.height
                spans = [s for b in page.get_text("dict")["blocks"] if b["type"] == 0
                         for line in b["lines"] for s in line["spans"] if s["text"].strip()]
                if abs(w - 595.276) > 2 or abs(h - 841.89) > 2:
                    row["issues"].append(f"page {i+1}: not A4")
                if not spans:
                    row["issues"].append(f"page {i+1}: blank text")
                    continue
                if any(s["bbox"][0] < -2 or s["bbox"][1] < -2 or
                       s["bbox"][2] > w+2 or s["bbox"][3] > h+2 for s in spans):
                    row["issues"].append(f"page {i+1}: text outside A4")
                top = min(s["bbox"][1] for s in spans)
                bottom = h - max(s["bbox"][3] for s in spans)
                if i:
                    for name, value in (("minContinuationTopPt", top), ("minContinuationBottomPt", bottom)):
                        prior = row[name]
                        row[name] = round(value if prior is None else min(prior, value), 2)
                    if top < 12 or bottom < 12:
                        row["issues"].append(f"page {i+1}: continuation text margin below 12pt")
                if i < len(pdf)-1 and h-bottom < h*.6:
                    row["sparseNonfinal"] += 1
        report["cases"].append(row)
        if row["issues"]:
            report["issues"].append({"mode": mode, "templateId": template, "issues": row["issues"]})

    if set(by_mode) != set(modes) or any(len(by_mode[m]) != count for m in modes):
        raise ValueError("Incomplete matrix coverage")
    if any(by_mode[m] != by_mode[modes[0]] for m in modes):
        raise ValueError("Template IDs differ between modes")
    report["caseCount"] = len(cases)
    report["pageCount"] = sum(c["pages"] for c in report["cases"])
    report["passed"] = not report["issues"]
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, required=True)
    p.add_argument("--locale", choices=["zh-CN", "en-US"], required=True)
    p.add_argument("--modes", required=True)
    p.add_argument("--source-sha", required=True)
    p.add_argument("--runner-sha", required=True)
    args = p.parse_args()
    modes = args.modes.split(",")
    if (len(modes) != len(set(modes)) or not set(modes) <= {"compact", "extended", "natural", "contacts"}
            or not all(re.fullmatch(r"[0-9a-f]{40}", s) for s in (args.source_sha, args.runner_sha))):
        raise ValueError("Explicit synthetic modes and full evidence SHAs required")
    result = audit(args.root, args.locale, modes, args.source_sha, args.runner_sha)
    (args.root / "matrix-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "cases"}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
