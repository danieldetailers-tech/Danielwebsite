"""
Remove white/light background from pricing illustration via edge flood-fill.
Reads assets/pricing-scale.jpg (or .jpeg) if present, else assets/pricing-scale.png.
Writes assets/pricing-scale.png with transparency (JPG cannot store alpha).
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


def is_near_white(r: int, g: int, b: int, thr: int = 248) -> bool:
    """Background-like: bright and fairly neutral (not strongly colored)."""
    if max(r, g, b) < thr - 5:
        return False
    return (max(r, g, b) - min(r, g, b)) <= 22


def flood_background_rgba(im: Image.Image, thr: int = 248) -> Image.Image:
    w, h = im.size
    rgb = im.convert("RGB")
    px = rgb.load()

    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_add(x: int, y: int) -> None:
        if not (0 <= x < w and 0 <= y < h) or visited[y][x]:
            return
        r, g, b = px[x, y]
        if is_near_white(r, g, b, thr):
            visited[y][x] = True
            q.append((x, y))

    for x in range(w):
        try_add(x, 0)
        try_add(x, h - 1)
    for y in range(h):
        try_add(0, y)
        try_add(w - 1, y)

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            try_add(nx, ny)

    out = Image.new("RGBA", (w, h))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if visited[y][x]:
                opx[x, y] = (0, 0, 0, 0)
            else:
                opx[x, y] = (r, g, b, 255)
    return out


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    assets = root / "assets"
    out_path = assets / "pricing-scale.png"

    candidates = [
        assets / "pricing-scale.jpg",
        assets / "pricing-scale.jpeg",
        assets / "pricing-source.jpg",
        assets / "pricing-source.jpeg",
        assets / "pricing-scale.png",
    ]
    src = next((p for p in candidates if p.exists()), None)
    if src is None:
        raise SystemExit(
            "No image found. Add one of:\n"
            "  assets/pricing-scale.jpg\n"
            "  assets/pricing-scale.jpeg\n"
            "  assets/pricing-scale.png"
        )

    im = Image.open(src)
    out = flood_background_rgba(im)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path, "PNG", optimize=True)
    print(f"OK: {src.name} -> {out_path} ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
