from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

from .cli import preflight_and_render

REQUIRED_BINARIES = ["xelatex", "kpsewhich", "fc-match", "pdftotext", "pdftoppm"]
REQUIRED_TEX = [
    "ctex.sty",
    "tikz.sty",
    "pgfplots.sty",
    "circuitikz.sty",
    "tkz-euclide.sty",
    "tikz-3dplot.sty",
]

TEX = r"""\documentclass[UTF8,10pt]{ctexart}
\usepackage[a4paper,margin=18mm]{geometry}
\usepackage{xcolor}
\usepackage{tikz}
\usepackage{pgfplots}
\usepackage[american]{circuitikz}
\usepackage{tkz-euclide}
\usepackage{tikz-3dplot}
\usetikzlibrary{arrows.meta,positioning,calc,decorations.pathmorphing,patterns}
\pgfplotsset{compat=1.18}
\begin{document}
\section*{PDF Production Engine 资源构建运行时}
中文字体、TeX、科学图形、Poppler 与像素渲染的公开合成测试。

\subsection*{TikZ}
\begin{tikzpicture}
  \draw[-{Latex[length=2.5mm]}] (0,0)--(3,0) node[right] {$v$};
  \draw (0,0) circle (2pt);
\end{tikzpicture}

\subsection*{PGFPlots}
\begin{tikzpicture}
\begin{axis}[width=7cm,height=4cm,axis lines=middle,samples=30,xmin=0,xmax=2,ymin=0,ymax=4]
  \addplot[domain=0:2] {x^2};
\end{axis}
\end{tikzpicture}

\subsection*{CircuiTikZ}
\begin{circuitikz}
  \draw (0,0) to[battery1,l=$E$] (0,2) to[R,l=$R$] (3,2) -- (3,0) -- (0,0);
\end{circuitikz}

\subsection*{tkz-euclide}
\begin{tikzpicture}
  \tkzDefPoints{0/0/A,3/0/B,1.5/2/C}
  \tkzDrawPolygon(A,B,C)
\end{tikzpicture}

\subsection*{tikz-3dplot}
\tdplotsetmaincoords{65}{115}
\begin{tikzpicture}[tdplot_main_coords]
  \draw[-latex] (0,0,0)--(2,0,0);
  \draw[-latex] (0,0,0)--(0,2,0);
  \draw[-latex] (0,0,0)--(0,0,2);
\end{tikzpicture}
\end{document}
"""


def _run(argv: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def _contact_sheet(images: list[Path], output: Path) -> None:
    cards = []
    for path in images:
        with Image.open(path) as source:
            im = source.convert("RGB")
            width = 520
            height = max(1, round(im.height * width / im.width))
            im = im.resize((width, height))
            card = Image.new("RGB", (width + 20, height + 44), "white")
            card.paste(im, (10, 34))
            ImageDraw.Draw(card).text((10, 10), path.stem, fill="black")
            cards.append(card)
    if not cards:
        raise RuntimeError("no images for contact sheet")
    sheet = Image.new("RGB", (max(x.width for x in cards), sum(x.height for x in cards)), "white")
    y = 0
    for card in cards:
        sheet.paste(card, (0, y)); y += card.height
    sheet.save(output, quality=90)


def run_smoke(out: Path) -> dict:
    out = out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    missing = [name for name in REQUIRED_BINARIES if not shutil.which(name)]
    if missing:
        raise RuntimeError("missing runtime binaries: " + ", ".join(missing))

    tex_paths = {}
    for name in REQUIRED_TEX:
        proc = _run(["kpsewhich", name])
        value = (proc.stdout or "").strip()
        if proc.returncode or not value:
            raise RuntimeError(f"missing TeX package: {name}")
        tex_paths[name] = value

    font = (_run(["fc-match", "sans-serif", "-f", "%{file}"]).stdout or "").strip()
    if not font:
        raise RuntimeError("fontconfig returned no font")

    with tempfile.TemporaryDirectory(prefix="pdf-engine-runtime-") as tmp:
        work = Path(tmp)
        (work / "smoke.tex").write_text(TEX, encoding="utf-8")
        proc = _run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", "smoke.tex"], cwd=work)
        (out / "xelatex.log").write_text(proc.stdout or "", encoding="utf-8")
        pdf = work / "smoke.pdf"
        if proc.returncode or not pdf.is_file() or pdf.stat().st_size < 5000:
            raise RuntimeError("XeLaTeX synthetic figure compilation failed")
        target_pdf = out / "runtime-smoke.pdf"
        shutil.copy2(pdf, target_pdf)

        text_proc = _run(["pdftotext", str(target_pdf), "-"])
        if text_proc.returncode or "PDF Production Engine" not in text_proc.stdout:
            raise RuntimeError("pdftotext smoke failed")
        (out / "pdftotext.txt").write_text(text_proc.stdout, encoding="utf-8")

        prefix = out / "poppler-page"
        render_proc = _run(["pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-png", "-r", "120", str(target_pdf), str(prefix)])
        poppler_png = out / "poppler-page.png"
        if render_proc.returncode or not poppler_png.is_file():
            raise RuntimeError("pdftoppm smoke failed")
        with Image.open(poppler_png) as im:
            if im.width <= 0 or im.height <= 0:
                raise RuntimeError("invalid Poppler image geometry")

        qa = preflight_and_render(target_pdf, out / "pdfium-rendered", 120)
        renders = sorted((out / "pdfium-rendered").glob("page-*.png"))
        _contact_sheet(renders, out / "contact-sheet.jpg")

    report = {
        "status": "MACHINE_PASS",
        "runtime": {
            "binaries": {name: shutil.which(name) for name in REQUIRED_BINARIES},
            "tex_packages": tex_paths,
            "font_match": font,
        },
        "capabilities": [
            "CJK-font-runtime",
            "XeLaTeX",
            "TikZ",
            "PGFPlots",
            "CircuiTikZ",
            "tkz-euclide",
            "tikz-3dplot",
            "pdftotext",
            "pdftoppm",
            "PyMuPDF-preflight",
            "PDFium-render",
            "Pillow-contact-sheet",
        ],
        "pdf_qa": qa,
        "review_status": "REVIEW_REQUIRED",
    }
    (out / "runtime-smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("RESOURCE_RUNTIME_MACHINE_PASS")
    print("REVIEW_REQUIRED: inspect runtime-smoke PDF/contact sheet when changing the runtime")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-runtime-smoke")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        run_smoke(args.out)
        return 0
    except (OSError, RuntimeError) as exc:
        print(f"RESOURCE_RUNTIME_FAIL: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
