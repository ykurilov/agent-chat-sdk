#!/usr/bin/env python3
"""Measure native fixture screenshots (iPhone 16 Pro, 402pt @3x).
Usage: python3 measure-composer-insets.py <exported screenshot.png> [...]
Requires Pillow. Uses visible pixels, not accessibility hit rectangles.
The fixture puts the composer 12pt from each screen edge; its actions are
bottom anchored. Coordinates correspond to the printed INSET_FRAMES values.
"""
import json
import sys
from PIL import Image

for path in sys.argv[1:]:
    image = Image.open(path).convert('RGB')
    assert image.size == (1206, 2622), 'Use the 402pt iPhone 16 Pro fixture'
    scale = 3
    plus_y, send_y = 802 * scale, 804 * scale
    background = image.getpixel((50 * scale, send_y))
    row = [image.getpixel((x, send_y)) for x in range(image.width)]
    # Both straight container edges at the control center, away from corner curves.
    left = next(x for x in range(100) if row[x] == background)
    right = next(x for x in range(image.width - 1, 1100, -1) if row[x] == background)
    plus = next(x for x in range(left + 1, 50 * scale)
                if image.getpixel((x, plus_y)) != background)
    send = next(x for x in range(right - 1, 320 * scale, -1) if row[x] != background)
    result = dict(path=path, leftInsetPx=plus-left, rightInsetPx=right-send,
                  differencePt=abs((plus-left)-(right-send))/scale)
    print(json.dumps(result, ensure_ascii=False))
    assert result['differencePt'] <= 1, result
