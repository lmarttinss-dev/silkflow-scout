#!/usr/bin/env python3
"""Generates ML Scout PNG icons for the Chrome extension."""
import struct
import zlib

def create_png(width, height, pixels):
    """Creates a minimal valid PNG from a pixel array (RGBA tuples)."""
    def chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        return c + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)

    signature = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)

    # Build raw image data (RGB, filter byte = 0 per scanline)
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type: None
        for x in range(width):
            r, g, b = pixels[y * width + x]
            raw += bytes([r, g, b])

    compressed = zlib.compress(raw, 9)
    idat = chunk(b'IDAT', compressed)
    iend = chunk(b'IEND', b'')

    return signature + ihdr + idat + iend


def draw_icon(size):
    """Draw the ML Scout icon: dark background + magnifying glass + yellow accent."""
    pixels = []
    cx, cy = size // 2, size // 2
    r = size * 0.35
    stroke = max(2, size // 10)
    handle_len = size * 0.22
    handle_w = max(2, size // 12)

    # Colors
    BG      = (13, 17, 23)      # #0D1117 dark background
    RING    = (255, 230, 0)     # #FFE600 yellow ring
    HANDLE  = (255, 214, 0)     # slightly darker yellow handle
    LENS    = (22, 27, 34)      # #161B22 lens interior
    ACCENT  = (0, 200, 83)      # #00C853 green dot (activity)

    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5

            # Ring
            if abs(dist - r) <= stroke:
                pixels.append(RING)
            # Lens fill
            elif dist < r - stroke:
                # Small green dot in center of lens
                if dist < size * 0.08:
                    pixels.append(ACCENT)
                else:
                    pixels.append(LENS)
            else:
                # Handle: bottom-right diagonal from circle edge
                hx = cx + r * 0.65
                hy = cy + r * 0.65
                # Line from (hx, hy) going at 45 degrees
                px, py = x - hx, y - hy
                along = (px + py) / (2 ** 0.5)
                perp  = abs(px - py) / (2 ** 0.5)
                if 0 <= along <= handle_len and perp <= handle_w:
                    pixels.append(HANDLE)
                else:
                    pixels.append(BG)

    return pixels


for size, name in [(16, 'icon16.png'), (48, 'icon48.png'), (128, 'icon128.png')]:
    pixels = draw_icon(size)
    data = create_png(size, size, pixels)
    path = name
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Created {name} ({size}x{size})')

print('Done!')
