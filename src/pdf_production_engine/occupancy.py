from __future__ import annotations

from PIL import Image


def page_occupancy(image: Image.Image) -> dict:
    """Return generic page-occupancy metrics and warnings.

    Warnings are navigation aids for human review, never acceptance decisions.
    The inner crop intentionally ignores common edge/header/footer regions.
    """
    gray = image.convert('L')
    width, height = gray.size
    crop = gray.crop((int(width * 0.05), int(height * 0.08), int(width * 0.95), int(height * 0.92)))
    crop.thumbnail((256, 256), Image.Resampling.LANCZOS)
    w, h = crop.size
    hist = crop.histogram()
    total = max(1, sum(hist))
    ink_fraction = sum(hist[:245]) / total

    mask = crop.point(lambda p: 255 if p < 245 else 0)
    bbox = mask.getbbox()
    if bbox:
        left, top, right, bottom = bbox
        bbox_area_fraction = ((right - left) * (bottom - top)) / max(1, w * h)
        bbox_height_fraction = (bottom - top) / max(1, h)
        bbox_width_fraction = (right - left) / max(1, w)
    else:
        bbox_area_fraction = 0.0
        bbox_height_fraction = 0.0
        bbox_width_fraction = 0.0

    pixels = mask.load()
    active_rows = 0
    for y in range(h):
        dark = sum(1 for x in range(w) if pixels[x, y])
        if dark >= max(1, int(w * 0.01)):
            active_rows += 1
    active_cols = 0
    for x in range(w):
        dark = sum(1 for y in range(h) if pixels[x, y])
        if dark >= max(1, int(h * 0.01)):
            active_cols += 1
    active_row_fraction = active_rows / max(1, h)
    active_col_fraction = active_cols / max(1, w)

    warnings: list[str] = []
    if ink_fraction < 0.003:
        warnings.append('NEAR_EMPTY_PAGE')
    elif ink_fraction < 0.018 and active_row_fraction < 0.11:
        warnings.append('LOW_PAGE_OCCUPANCY')
    elif ink_fraction < 0.028 and active_row_fraction < 0.075:
        warnings.append('ISOLATED_CONTENT_BAND')

    # Dense content can still be wasteful if it occupies only the top third of
    # the printable area. This catches the recurring "isolated block + huge
    # lower whitespace" failure class that ink density alone cannot see.
    if bbox_height_fraction < 0.42 and active_row_fraction < 0.36:
        warnings.append('LARGE_VERTICAL_WHITESPACE')

    return {
        'analysis_region': '5%-95% width, 8%-92% height',
        'ink_threshold_gray_lt': 245,
        'ink_fraction': round(ink_fraction, 5),
        'bbox_area_fraction': round(bbox_area_fraction, 5),
        'bbox_height_fraction': round(bbox_height_fraction, 5),
        'bbox_width_fraction': round(bbox_width_fraction, 5),
        'active_row_fraction': round(active_row_fraction, 5),
        'active_col_fraction': round(active_col_fraction, 5),
        'warnings': list(dict.fromkeys(warnings)),
    }
