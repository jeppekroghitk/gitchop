import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
SS = 4
ANGLE = -28.0
PANEL = (0x14, 0x17, 0x1B)
EDGE = (0x2A, 0x2F, 0x36)
ACCENT = (0xD8, 0xDE, 0xE4)
HOT = (0xFF, 0xFF, 0xFF)


def write_png(path, w, h, pixels):
    raw = b"".join(b"\x00" + bytes(pixels[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    blob = b"\x89PNG\r\n\x1a\n"
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(raw, 9))
    blob += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(blob)


def rounded_inside(x, y, size, radius):
    for cx, cy in ((radius, radius), (size - radius, radius), (radius, size - radius), (size - radius, size - radius)):
        if (x < radius and cx == radius or x > size - radius and cx != radius) and (
            y < radius and cy == radius or y > size - radius and cy != radius
        ):
            return math.hypot(x - cx, y - cy) <= radius
    return True


def render(size):
    big = size * SS
    radius = big * 0.22
    slope = math.tan(math.radians(ANGLE))
    gap = big * 0.085
    band = big * 0.028
    buf = bytearray(big * big * 4)

    for y in range(big):
        for x in range(big):
            i = (y * big + x) * 4
            if not rounded_inside(x + 0.5, y + 0.5, big, radius):
                continue
            # Signed perpendicular distance to the cut through the centre.
            d = ((y + 0.5) - (big / 2 + slope * ((x + 0.5) - big / 2))) * math.cos(math.radians(ANGLE))
            a = abs(d)
            if a < band:
                t = a / band
                colour = tuple(round(HOT[k] + (ACCENT[k] - HOT[k]) * t) for k in range(3))
            elif a < gap:
                t = (a - band) / (gap - band)
                colour = tuple(round(ACCENT[k] + (PANEL[k] - ACCENT[k]) * (t ** 0.75)) for k in range(3))
            else:
                edge = min(x, y, big - 1 - x, big - 1 - y) < big * 0.055
                colour = EDGE if edge else PANEL
            buf[i:i + 4] = bytes(colour) + b"\xff"

    out = bytearray(size * size * 4)
    span = SS * SS
    for y in range(size):
        for x in range(size):
            sums = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    j = ((y * SS + sy) * big + (x * SS + sx)) * 4
                    alpha = buf[j + 3]
                    sums[0] += buf[j] * alpha
                    sums[1] += buf[j + 1] * alpha
                    sums[2] += buf[j + 2] * alpha
                    sums[3] += alpha
            i = (y * size + x) * 4
            if sums[3] == 0:
                continue
            out[i] = sums[0] // sums[3]
            out[i + 1] = sums[1] // sums[3]
            out[i + 2] = sums[2] // sums[3]
            out[i + 3] = sums[3] // span
    return out


os.makedirs(OUT, exist_ok=True)
for size in (16, 32, 48, 128):
    write_png(os.path.join(OUT, f"icon{size}.png"), size, size, render(size))
    print("wrote", f"icon{size}.png")
