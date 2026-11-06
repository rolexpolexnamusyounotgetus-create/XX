"""Build the arena and audio embeds (assets/embed/arena-* and audio-*) from the staged source assets.

    python3 -I tools/arena_assets.py <staged-root>

<staged-root> holds the downloads described in assets/LICENSES.md (Poly Haven HDRI, ambientCG textures,
the arena audio pack): assets_net/hdri, assets_net/fence, assets_net/textures, assets_wide/audio.
Needs Pillow, numpy and ffmpeg (libmp3lame).

What it writes and why (sizes are what the page pays, before base64):
- arena-env-circus.jpg: Poly Haven circus_arena (1k .hdr) box-filtered to 512x256 and stored log-encoded in an
  8-bit JPEG (4:4:4): v = log2(1 + x * 16) / log2(1 + 512 * 16). arena3d.js decodes it in a shader (ENV_LOG_*),
  dims the floor and the seats, and blends it with the procedural truss lights before PMREM.
- arena-fence-opacity.webp: ambientCG Fence003 opacity, cleaned of JPEG noise, 512 px, 8 grey levels, lossless.
  The wire normal is derived from it at load time (the source normal map costs 90-125 KB and adds little).
- arena-mat-weave-normal.jpg: ambientCG Fabric036 normal, a 128 px crop at full resolution (the weave period is
  8 px, so a 128 crop tiles), high-passed so the crop seams vanish.
- arena-mat-slub.webp: ambientCG Fabric036 colour, grey, 256 px, normalised: slubs and print grain under the print.
- arena-leather-normal.jpg: Poly Haven leather_white normal (256 px, grain amplified x4 so JPEG keeps it) for the
  post, rail and cap pads. Its roughness map is flat (0.60-0.63) and is left out.
- audio-*.mp3: the arena audio pack re-encoded for the page (mono; crowd 48-56 kbps, one-shots 64 kbps).
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "embed")

ENV_PEAK, ENV_K = 512.0, 16.0


def read_hdr(path):
    with open(path, "rb") as f:
        data = f.read()
    i = 0
    while True:
        j = data.index(b"\n", i)
        line = data[i:j]
        i = j + 1
        if line.startswith(b"-Y") or line.startswith(b"+Y"):
            parts = line.split()
            h, w = int(parts[1]), int(parts[3])
            break
    out = np.zeros((h, w, 4), np.uint8)
    p = i
    for y in range(h):
        if data[p] == 2 and data[p + 1] == 2 and (data[p + 2] << 8 | data[p + 3]) == w:
            p += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = data[p]
                    p += 1
                    if n > 128:
                        n -= 128
                        out[y, x:x + n, c] = data[p]
                        p += 1
                    else:
                        out[y, x:x + n, c] = np.frombuffer(data[p:p + n], np.uint8)
                        p += n
                    x += n
        else:
            out[y] = np.frombuffer(data[p:p + w * 4], np.uint8).reshape(w, 4)
            p += w * 4
    e = out[..., 3].astype(np.float64)
    scale = np.where(e > 0, np.ldexp(1.0, (e - 136).astype(np.int32)), 0.0)
    return (out[..., :3].astype(np.float64) * scale[..., None]).astype(np.float32)


def env_map(src, dst):
    img = read_hdr(src)
    H, W, _ = img.shape
    w, h = 512, 256
    small = img[:h * (H // h), :w * (W // w)].reshape(h, H // h, w, W // w, 3).mean(axis=(1, 3))
    v = np.log2(1 + np.clip(small, 0, ENV_PEAK) * ENV_K) / np.log2(1 + ENV_PEAK * ENV_K)
    Image.fromarray((np.clip(v, 0, 1) * 255 + 0.5).astype(np.uint8)).save(dst, quality=90, subsampling=0)


def fence_opacity(src, dst):
    a = np.asarray(Image.open(src).convert("L")).astype(np.float64) / 255
    a = np.clip((a - 0.12) / (0.8 - 0.12), 0, 1)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8)).resize((512, 512), Image.LANCZOS)
    q = np.round(np.asarray(im).astype(np.float64) / 255 * 7) / 7
    Image.fromarray((q * 255 + 0.5).astype(np.uint8)).save(dst, lossless=True, method=6)


def weave_normal(src, dst):
    n = np.asarray(Image.open(src).convert("RGB")).astype(np.float64) / 255 * 2 - 1
    crop = n[448:576, 448:576, :2]
    # high-pass x and y so the slow variation (which does not tile) goes; the 8 px weave stays
    lo = np.stack([np.asarray(Image.fromarray(((crop[..., c] + 1) * 127.5).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float64) / 127.5 - 1 for c in range(2)], -1)
    hp = (crop - lo) * 1.15
    z = np.sqrt(np.clip(1 - (hp ** 2).sum(-1), 0.05, 1))
    out = np.dstack([hp[..., 0], hp[..., 1], z])
    Image.fromarray(np.clip((out * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)).save(dst, quality=88, subsampling=0)


def slub(src, dst):
    g = np.asarray(Image.open(src).convert("L").resize((256, 256), Image.LANCZOS)).astype(np.float64)
    g = (g - g.mean()) / (g.std() + 1e-6)
    g = np.clip(128 + g * 38, 0, 255)
    Image.fromarray(g.astype(np.uint8)).save(dst, quality=72, method=6)


def leather(src_n, dst_n):
    # the grain is shallow (xy std ~0.01): store it amplified x4 so JPEG keeps it; arena3d.js scales it back
    n = np.asarray(Image.open(src_n).convert("RGB").resize((256, 256), Image.LANCZOS)).astype(np.float64) / 255 * 2 - 1
    xy = (n[..., :2] - n[..., :2].mean(axis=(0, 1))) * 4.0
    z = np.sqrt(np.clip(1 - (xy ** 2).sum(-1), 0.05, 1))
    out = np.dstack([xy[..., 0], xy[..., 1], z])
    Image.fromarray(np.clip((out * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)).save(dst_n, quality=85, subsampling=0)


# name in the pack -> (source file, kbps). All mono.
AUDIO = {
    "crowd_bed": ("crowd_arena_loop.ogg", 56),
    "crowd_roar": ("crowd_roar_rise.mp3", 48),
    "crowd_pop": ("crowd_pop_knockdown.mp3", 48),
    "crowd_ooh": ("crowd_ooh.mp3", 48),
    "crowd_chant": ("crowd_chant_swell.mp3", 48),
    "crowd_boo": ("crowd_boo_whistle.mp3", 48),
    "bell_x3": ("bell_x3.mp3", 64),
    "bell_ring": ("bell_ring.mp3", 64),
    "clapper": ("clapper_10s.mp3", 64),
    "ref_fight": ("ref_fight.mp3", 64),
    "ref_go": ("ref_go.mp3", 64),
    "ref_stop": ("ref_stop.mp3", 64),
    "punch_head_1": ("punch_head_1.mp3", 64),
    "punch_head_2": ("punch_head_2.mp3", 64),
    "punch_head_3": ("punch_head_3.mp3", 64),
    "punch_head_heavy": ("punch_head_heavy.mp3", 64),
    "punch_body_1": ("punch_body_1.mp3", 64),
    "punch_body_2": ("punch_body_2.mp3", 64),
    "punch_body_3": ("punch_body_3.mp3", 64),
    "kick_body_1": ("kick_body_1.mp3", 64),
    "kick_body_2": ("kick_body_2.mp3", 64),
    "kick_leg_1": ("kick_leg_1.mp3", 64),
    "kick_leg_2": ("kick_leg_2.mp3", 64),
    "blocked": ("strike_blocked.mp3", 64),
    "whoosh_punch_1": ("whoosh_punch_1.mp3", 64),
    "whoosh_punch_2": ("whoosh_punch_2.mp3", 64),
    "whoosh_punch_3": ("whoosh_punch_3.mp3", 64),
    "whoosh_kick": ("whoosh_kick.mp3", 64),
    "takedown_1": ("takedown_thud_1.mp3", 64),
    "takedown_2": ("takedown_thud_2.mp3", 64),
    "cage_rattle": ("cage_rattle.mp3", 64),
    "cage_slam": ("cage_slam.mp3", 64),
    "walkout_boom": ("walkout_boom.mp3", 64),
}


def audio(src_dir):
    for name, (src, kbps) in AUDIO.items():
        dst = os.path.join(OUT, "audio-" + name.replace("_", "-") + ".mp3")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(src_dir, src), "-ac", "1", "-ar", "44100",
                        "-c:a", "libmp3lame", "-b:a", "%dk" % kbps, "-map_metadata", "-1", dst], check=True)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    S = sys.argv[1]
    net, wide = os.path.join(S, "assets_net"), os.path.join(S, "assets_wide")
    os.makedirs(OUT, exist_ok=True)
    env_map(os.path.join(net, "hdri", "circus_arena_1k.hdr"), os.path.join(OUT, "arena-env-circus.jpg"))
    fence_opacity(os.path.join(net, "fence", "Fence003", "Fence003_1K-JPG_Opacity.jpg"), os.path.join(OUT, "arena-fence-opacity.webp"))
    fab = os.path.join(net, "textures", "mat_canvas", "Fabric036")
    weave_normal(os.path.join(fab, "Fabric036_1K-JPG_NormalGL.jpg"), os.path.join(OUT, "arena-mat-weave-normal.jpg"))
    slub(os.path.join(fab, "Fabric036_1K-JPG_Color.jpg"), os.path.join(OUT, "arena-mat-slub.webp"))
    lw = os.path.join(net, "textures", "leather", "leather_white")
    leather(os.path.join(lw, "leather_white_nor_gl_1k.jpg"), os.path.join(OUT, "arena-leather-normal.jpg"))
    audio(os.path.join(wide, "audio"))
    total = 0
    for name in sorted(os.listdir(OUT)):
        if name.startswith("arena-") or name.startswith("audio-"):
            sz = os.path.getsize(os.path.join(OUT, name))
            total += sz
            print("%-34s %8d" % (name, sz))
    print("total %d bytes raw, %d embedded" % (total, total * 4 // 3))


if __name__ == "__main__":
    main()
