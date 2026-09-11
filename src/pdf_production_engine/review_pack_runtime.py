from __future__ import annotations

# Compatibility shim while review_pack.py remains the stable v1 implementation.
# The CLI/programmatic entrypoint installs the shared generic occupancy analyzer
# before delegating, so existing review-pack behavior stays unchanged except for
# stronger whitespace warnings.
from . import review_pack as _base
from .occupancy import page_occupancy

_base._page_occupancy = page_occupancy

build_review_pack = _base.build_review_pack
review_pdf = _base.review_pdf
ReviewPackError = _base.ReviewPackError


def main(argv: list[str] | None = None) -> int:
    return _base.main(argv)
