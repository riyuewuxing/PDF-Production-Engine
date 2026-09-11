from __future__ import annotations

from PIL import Image, ImageDraw

from pdf_production_engine.occupancy import page_occupancy


def _page() -> Image.Image:
    return Image.new('RGB', (1654, 2339), 'white')


def test_dense_top_block_with_large_lower_whitespace_warns() -> None:
    image = _page()
    draw = ImageDraw.Draw(image)
    # Synthetic analogue of a dense board/summary box occupying roughly the
    # upper third of a page, followed by a very large unused lower region.
    draw.rectangle((180, 250, 1470, 880), outline='black', width=4)
    for y in range(300, 820, 42):
        draw.rectangle((250, y, 1380, y + 12), fill='black')
    result = page_occupancy(image)
    assert result['bbox_height_fraction'] < 0.42
    assert result['active_row_fraction'] < 0.36
    assert 'LARGE_VERTICAL_WHITESPACE' in result['warnings']


def test_content_distributed_through_page_does_not_raise_vertical_whitespace_warning() -> None:
    image = _page()
    draw = ImageDraw.Draw(image)
    for y in range(280, 1980, 95):
        draw.rectangle((230, y, 1400, y + 16), fill='black')
    result = page_occupancy(image)
    assert result['bbox_height_fraction'] > 0.60
    assert 'LARGE_VERTICAL_WHITESPACE' not in result['warnings']
