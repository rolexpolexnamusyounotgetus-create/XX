#!/usr/bin/env python3
"""
Young Seminole Democrats: demo clip generator (video workstream).

Builds the short vertical DEMO creator clips in assets/video/ (720x1280 H.264 MP4, no audio track,
plus a JPEG poster per clip) from Unsplash photos, and writes data/clips.js with their metadata.

  python3 assets/video/make_demo_clips.py [--cache DIR] [--only ID] [--no-data]

How a clip is made
  - Each photo is downloaded from images.unsplash.com (the script checks for HTTP 200 and an image
    content type; it stops otherwise). Every photo used here is under the Unsplash License, which
    allows copying and modifying without permission; see the per-photo credits in data/clips.js.
  - Slow Ken Burns pans/zooms are rendered frame by frame with sub-pixel affine sampling (smooth,
    no zoompan jitter), with a brand-neutral colour tint, legibility scrims, bold burned-in
    captions that pop in, a "@demo.handle" line and a DEMO tag so a clip can never pass as real.
  - Frames are piped to ffmpeg (libx264, CRF tuned per clip so each file stays under ~1.5 MB).

Facts burned into clips were checked on Mon Nov 9, 2026; sources are listed per clip in `facts`
and copied into data/clips.js. Edit SPECS below (not data/clips.js) and re-run to change a clip.

Requires: Python 3.9+, Pillow, ffmpeg on PATH, network access to images.unsplash.com.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import urllib.request

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))          # youngsemdem/
DATA_FILE = os.path.join(SITE, 'data', 'clips.js')

W, H, FPS = 720, 1280, 30
MAX_BYTES = 1_500_000
FONT_DIRS = ['/usr/share/fonts/opentype/inter', '/usr/share/fonts/truetype/inter',
             os.path.expanduser('~/.fonts'), '/Library/Fonts', 'C:/Windows/Fonts']

# ------------------------------------------------------------------------------------- photos
# Every entry was opened on unsplash.com on 2026-11-09 and shows "Free to use under the Unsplash
# License" (none are Unsplash+). `focus` = start/end crop centres as fractions of the photo.
PHOTOS = {
    'envelope': {
        'id': '1595265616362-0d9558d774db',
        'page': 'https://unsplash.com/photos/purple-envelope-on-white-table-9A5uvtrO1Vw',
        'photographer': 'Tiffany Tertipes', 'handle': '@tiffanytertipes',
        'description': 'Election mail return envelopes on a white table (photographer caption: '
                       '"Election mail envelopes"). Not a Florida envelope.',
    },
    'laptops': {
        'id': '1522202176988-66273c2fd55f',
        'page': 'https://unsplash.com/photos/three-people-sitting-in-front-of-table-laughing-together-g1Kr4Ozfoac',
        'photographer': 'Brooke Cagle', 'handle': '@brookecagle',
        'description': 'Three young people laughing at a cafe table with laptops.',
    },
    'tracks': {
        'id': '1676304437086-ad9db3b3df66',
        'page': 'https://unsplash.com/photos/cs18eMhnmxI',
        'photographer': 'Komorebi Photo', 'handle': '@komophoto',
        'description': 'Railroad track running to the horizon at sunset (tagged California). '
                       'Stand-in, not SunRail.',
    },
    'park': {
        # Replaced the rooftop-party selfie (1758272134088, drink in hand), banned by docs/BRIEF.md 0.
        'id': '1758275557330-cfd545444dc3',
        'page': 'https://images.unsplash.com/photo-1758275557330-cfd545444dc3',
        'photographer': 'Vitaly Gariev', 'handle': '@silverkblack',
        'description': 'A diverse group of friends taking a selfie together in a sunny park.',
    },
    'sticker': {
        'id': '1787091331480-c1e2b98e0140',
        'page': 'https://unsplash.com/photos/hand-holding-i-voted-sticker-wL4VWySngoc',
        'photographer': 'Ashley Diane Worsham', 'handle': '@worsham',
        'description': 'A hand holding an "I VOTED" sticker; photographed in Sarasota, FL.',
    },
    'lake': {
        'id': '1783676056910-e5f3b27bdcbd',
        'page': 'https://unsplash.com/photos/people-watching-sunset-over-a-calm-lake-I1-hVKIchQo',
        'photographer': 'Richard Burlton', 'handle': '@richardworks',
        'description': 'People watching the sunset over a calm lake from a waterfront path. '
                       'Location not stated; stand-in, not Lake Monroe.',
    },
    'street': {
        'id': '1555636222-cae831e670b3',
        'page': 'https://unsplash.com/photos/suburban-street-with-houses-and-palms-4T4AcGJvARQ',
        'photographer': 'FilterGrade', 'handle': '@filtergrade',
        'description': 'A quiet suburban street with houses, palm trees and lawns (tagged Florida).',
    },
    'cards': {
        'id': '1646934280686-768a69c444eb',
        'page': 'https://unsplash.com/photos/a-group-of-people-sitting-around-a-wooden-table-WciYmqSwNAA',
        'photographer': 'Jametlene Reskp', 'handle': '@reskp',
        'description': 'Friends laughing around a wooden table during a card game.',
    },
}

# ------------------------------------------------------------------------------------- clips
# segments: photo, seconds, focus [(fx, fy), (fx, fy)], zoom (start, end)
# lines: (text, start, end, style)   styles: light (white box), dark (black box), pop (yellow box)
# linesY: optional vertical centre of the caption lines (default 760)
SPECS = [
    {
        'id': 'demo-mail-ballot-renew',
        'file': 'mail-ballot-renew',
        'author': {'handle': '@demo.maria', 'name': 'Maria (DEMO creator)'},
        'caption': 'PSA: Asked for a Florida mail ballot before Nov 3? That request ends Dec 31. '
                   'Ask again and you should be set through 2028. Check My Voter Record to be sure.',
        'tags': ['vote-by-mail', 'explainer', 'psa'],
        'likes': 412, 'views': 3870, 'createdAt': '2026-11-06T18:20:00-05:00',
        'tint': (106, 92, 214, 34),
        'title': 'Mail ballot PSA',
        'segments': [
            {'photo': 'envelope', 'seconds': 5.2, 'focus': [(0.40, 0.52), (0.56, 0.48)], 'zoom': (1.0, 1.12)},
            {'photo': 'laptops', 'seconds': 5.2, 'focus': [(0.52, 0.42), (0.66, 0.40)], 'zoom': (1.08, 1.0)},
        ],
        'lines': [
            ('Asked for a mail ballot\nbefore Nov 3?', 0.7, 4.9, 'light'),
            ('That request ends\nDec 31, 2026', 5.0, 7.5, 'pop'),
            ('Ask again: voteseminole.gov\nShould last through 2028', 7.6, 10.0, 'light'),
        ],
        'facts': [
            {'claim': 'One Florida vote-by-mail request covers elections "through the end of the calendar '
                      'year of the next regularly scheduled general election" (so requests made before the Nov 3, 2026 '
                      'general election end Dec 31, 2026, and one made after it should run through Dec 31, 2028).',
             'source': 'https://www.flsenate.gov/Laws/Statutes/2025/101.62'},
            {'claim': 'Seminole voters request/renew online or by phone at 407-585-8683.',
             'source': 'https://voteseminole.gov/how-to-vote/vote-by-mail/'},
        ],
    },
    {
        'id': 'demo-sunrail-rally',
        'file': 'sunrail-rally',
        'author': {'handle': '@demo.jordan', 'name': 'Jordan (DEMO creator)'},
        'caption': 'Took SunRail to the rally. No parking, no stress. Who is riding next time?',
        'tags': ['sunrail', 'rally', 'transit', 'squad'],
        'likes': 287, 'views': 2410, 'createdAt': '2026-11-01T12:05:00-04:00',
        'tint': (255, 140, 60, 22),
        'title': 'SunRail to the rally',
        'segments': [
            {'photo': 'tracks', 'seconds': 5.4, 'focus': [(0.50, 0.58), (0.50, 0.62)], 'zoom': (1.0, 1.22)},
            {'photo': 'park', 'seconds': 5.0, 'focus': [(0.46, 0.46), (0.58, 0.44)], 'zoom': (1.0, 1.06)},
        ],
        'lines': [
            ('4 Seminole stops:\nSanford, Lake Mary,\nLongwood, Altamonte Springs', 0.8, 5.0, 'light'),
            ('Squad: assembled', 5.4, 10.0, 'pop'),
        ],
        'facts': [
            {'claim': 'SunRail stations in Seminole County: Sanford, Lake Mary, Longwood, Altamonte Springs.',
             'source': 'https://corporate.sunrail.com/stations-trains/phase-1-stations/'},
        ],
    },
    {
        'id': 'demo-first-time-voter',
        'file': 'first-time-voter',
        'author': {'handle': '@demo.ava', 'name': 'Ava (DEMO creator)'},
        'caption': 'POV: you just voted for the first time and the sticker hits different.',
        'tags': ['first-time-voter', 'pov', 'how-to-vote'],
        'likes': 655, 'views': 5120, 'createdAt': '2026-11-03T16:42:00-05:00',
        'tint': (255, 214, 120, 14),
        'title': 'POV: first time voter',
        'linesY': 930,
        'segments': [
            {'photo': 'sticker', 'seconds': 9.0, 'focus': [(0.55, 0.50), (0.60, 0.46)], 'zoom': (1.0, 1.16)},
        ],
        'lines': [
            ('Step 1: check that\nyou are registered', 0.8, 3.5, 'light'),
            ('Step 2: bring a current\nphoto ID with your signature', 3.6, 6.3, 'light'),
            ('Step 3: get the sticker', 6.4, 9.0, 'pop'),
        ],
        'facts': [
            {'claim': 'Florida polls ask for a current, valid picture ID, and the signature is compared.',
             'source': 'https://www.flsenate.gov/Laws/Statutes/2025/101.043'},
            {'claim': 'Registration status lookup (Florida Division of Elections).',
             'source': 'https://registration.dos.fl.gov/CheckVoterStatus'},
        ],
    },
    {
        'id': 'demo-lake-monroe-canvass',
        'file': 'lake-monroe-canvass',
        'author': {'handle': '@demo.luis', 'name': 'Luis (DEMO creator)'},
        'caption': 'Sunset canvass by Lake Monroe. Knocked doors, met neighbors, caught the sky.',
        'tags': ['canvass', 'sanford', 'volunteer'],
        'likes': 198, 'views': 1640, 'createdAt': '2026-10-29T19:10:00-04:00',
        'tint': (230, 90, 140, 26),
        'title': 'Lake Monroe sunset canvass',
        'segments': [
            {'photo': 'lake', 'seconds': 10.0, 'focus': [(0.47, 0.46), (0.53, 0.40)], 'zoom': (1.14, 1.0)},
        ],
        'lines': [
            ('Knock doors. Meet neighbors.', 1.0, 5.4, 'light'),
            ('Stay for the sunset.', 5.5, 10.0, 'pop'),
        ],
        'facts': [],
    },
    {
        'id': 'demo-precinct-captain',
        'file': 'precinct-captain',
        'author': {'handle': '@demo.priya', 'name': 'Priya (DEMO creator)'},
        'caption': 'What is a precinct captain? Your neighborhood Dem who organizes, informs and gets out the vote.',
        'tags': ['precinct-captain', 'explainer', 'organizing'],
        'likes': 341, 'views': 2980, 'createdAt': '2026-11-07T10:30:00-05:00',
        'tint': (40, 170, 160, 22),
        'title': "What's a precinct captain?",
        'segments': [
            {'photo': 'street', 'seconds': 10.0, 'focus': [(0.76, 0.55), (0.62, 0.52)], 'zoom': (1.0, 1.1)},
        ],
        'lines': [
            ('Official Democratic Party\nreps for your precinct', 0.9, 4.6, 'light'),
            ('Front-facing voter outreach\nin your neighborhood', 4.7, 7.6, 'light'),
            ('Could be you', 7.7, 10.0, 'pop'),
        ],
        'facts': [
            {'claim': 'Seminole County Democratic Party: precinct captains "are the people power behind the scenes, '
                      'as well as the front-facing voter outreach teams in their communities. As official Democratic '
                      'Party representatives they organize activities to help get Democrats elected up and down the ballot."',
             'source': 'https://form.jotform.com/250016464253045'},
        ],
    },
    {
        'id': 'demo-trivia-night-recap',
        'file': 'trivia-night-recap',
        'author': {'handle': '@demo.sam', 'name': 'Sam (DEMO creator)'},
        'caption': 'Trivia night recap: new friends, questionable team names, zero regrets.',
        'tags': ['trivia', 'social', 'meetup'],
        'likes': 233, 'views': 1990, 'createdAt': '2026-11-08T21:15:00-05:00',
        'tint': (140, 90, 230, 20),
        'title': 'Trivia night recap',
        'segments': [
            {'photo': 'cards', 'seconds': 9.0, 'focus': [(0.28, 0.45), (0.74, 0.42)], 'zoom': (1.04, 1.04)},
        ],
        'lines': [
            ('New friends.\nQuestionable team names.', 1.0, 5.0, 'light'),
            ('See you at the next one', 5.1, 9.0, 'pop'),
        ],
        'facts': [],
    },
]

STYLES = {
    'light': {'box': (255, 255, 255, 240), 'text': (17, 17, 20, 255)},
    'dark': {'box': (12, 12, 16, 210), 'text': (255, 255, 255, 255)},
    'pop': {'box': (255, 225, 77, 245), 'text': (17, 17, 20, 255)},
}


# ------------------------------------------------------------------------------------- helpers
def find_font(name):
    for d in FONT_DIRS:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    raise SystemExit('font not found: %s (install Inter: https://rsms.me/inter/)' % name)


FONT_BLACK = find_font('Inter-Black.otf')
FONT_XBOLD = find_font('Inter-ExtraBold.otf')
FONT_BOLD = find_font('Inter-Bold.otf')


def photo_url(pid, width=2400):
    return 'https://images.unsplash.com/photo-%s?w=%d&q=85&fm=jpg' % (pid, width)


def download(key, cache):
    info = PHOTOS[key]
    path = os.path.join(cache, '%s.jpg' % info['id'])
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return path
    url = photo_url(info['id'])
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=60) as r:
        status = getattr(r, 'status', r.getcode())
        ctype = r.headers.get('Content-Type', '')
        body = r.read()
    if status != 200 or not ctype.startswith('image/'):
        raise SystemExit('download failed for %s: HTTP %s %s' % (url, status, ctype))
    with open(path, 'wb') as f:
        f.write(body)
    print('  downloaded %s (HTTP %s, %s, %d KB)' % (key, status, ctype, len(body) // 1024))
    return path


def ease_in_out(t):
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, t)))


def ease_out_back(t, s=1.70158):
    t = max(0.0, min(1.0, t)) - 1
    return t * t * ((s + 1) * t + s) + 1


def wrap(draw, text, font, max_w):
    """Greedy word wrap; an explicit newline in `text` always breaks."""
    lines = []
    for para in text.split('\n'):
        cur = ''
        for wd in para.split():
            trial = (cur + ' ' + wd).strip()
            if draw.textlength(trial, font=font) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = wd
        if cur:
            lines.append(cur)
    return lines


def text_sprite(text, font_path, size, style, max_w=664, pad=(22, 12), radius=16, gap=6):
    """TikTok-style caption: each wrapped line in its own rounded box, centred."""
    font = ImageFont.truetype(font_path, size)
    probe = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    lines = wrap(probe, text, font, max_w - 2 * pad[0])
    asc, desc = font.getmetrics()
    lh = asc + desc
    widths = [probe.textlength(l, font=font) for l in lines]
    box_w = int(max(widths) + 2 * pad[0])
    total_h = int(len(lines) * (lh + 2 * pad[1]) + (len(lines) - 1) * gap)
    im = Image.new('RGBA', (box_w + 8, total_h + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    st = STYLES[style]
    y = 4
    for line, lw in zip(lines, widths):
        bw = int(lw + 2 * pad[0])
        x = 4 + (box_w - bw) // 2
        d.rounded_rectangle([x, y, x + bw, y + lh + 2 * pad[1]], radius=radius, fill=st['box'])
        d.text((x + pad[0], y + pad[1]), line, font=font, fill=st['text'])
        y += lh + 2 * pad[1] + gap
    return im


def title_sprite(text):
    """Big white title with a soft dark outline (sits on the top scrim)."""
    font = ImageFont.truetype(FONT_BLACK, 62)
    probe = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    lines = wrap(probe, text, font, 620)
    asc, desc = font.getmetrics()
    lh = asc + desc
    wmax = int(max(probe.textlength(l, font=font) for l in lines))
    im = Image.new('RGBA', (wmax + 24, len(lines) * (lh + 4) + 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y = 12
    for l in lines:
        lw = probe.textlength(l, font=font)
        x = 12 + (wmax - lw) / 2
        d.text((x, y), l, font=font, fill=(255, 255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0, 150))
        y += lh + 4
    return im


def chrome_layer(handle, tint):
    """Static layer: tint, top/bottom scrims, @handle and DEMO tag."""
    layer = Image.new('RGBA', (W, H), tint)
    grad = Image.new('L', (1, H))
    for y in range(H):
        a = 0
        if y < 330:
            a = int(120 * (1 - y / 330) ** 1.6)
        elif y > 860:
            a = int(150 * ((y - 860) / (H - 860)) ** 1.4)
        grad.putpixel((0, y), a)
    scrim = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    scrim.putalpha(grad.resize((W, H)))
    layer = Image.alpha_composite(layer, scrim)
    d = ImageDraw.Draw(layer)
    f = ImageFont.truetype(FONT_BOLD, 26)
    d.text((36, 44), handle, font=f, fill=(255, 255, 255, 235), stroke_width=2, stroke_fill=(0, 0, 0, 110))
    tag = 'DEMO CLIP'
    ft = ImageFont.truetype(FONT_XBOLD, 20)
    tw = d.textlength(tag, font=ft)
    x1 = W - 36
    x0 = x1 - tw - 28
    d.rounded_rectangle([x0, 40, x1, 78], radius=19, fill=(0, 0, 0, 120), outline=(255, 255, 255, 200), width=2)
    d.text((x0 + 14, 47), tag, font=ft, fill=(255, 255, 255, 240))
    return layer


class Segment:
    def __init__(self, img, seconds, focus, zoom):
        self.img = img.convert('RGB')
        self.seconds = seconds
        self.focus = focus
        self.zoom = zoom
        iw, ih = self.img.size
        # largest 9:16 box that fits the photo
        if iw / ih > W / H:
            self.base_h = ih
            self.base_w = ih * W / H
        else:
            self.base_w = iw
            self.base_h = iw * H / W

    def frame(self, t):
        p = ease_in_out(t / self.seconds)
        z = self.zoom[0] + (self.zoom[1] - self.zoom[0]) * p
        fx = self.focus[0][0] + (self.focus[1][0] - self.focus[0][0]) * p
        fy = self.focus[0][1] + (self.focus[1][1] - self.focus[0][1]) * p
        iw, ih = self.img.size
        bw, bh = self.base_w / z, self.base_h / z
        cx = min(max(fx * iw, bw / 2), iw - bw / 2)
        cy = min(max(fy * ih, bh / 2), ih - bh / 2)
        x0, y0 = cx - bw / 2, cy - bh / 2
        s = bw / W
        return self.img.transform((W, H), Image.AFFINE, (s, 0, x0, 0, s, y0), resample=Image.BICUBIC)


def faded(sprite, alpha, scale=1.0):
    if scale != 1.0:
        sw, sh = sprite.size
        sprite = sprite.resize((max(1, int(sw * scale)), max(1, int(sh * scale))), Image.BILINEAR)
    if alpha < 1.0:
        a = sprite.getchannel('A').point(lambda v: int(v * alpha))
        sprite = sprite.copy()
        sprite.putalpha(a)
    return sprite


def render_clip(spec, cache, outdir, crf=27):
    segs = []
    for sg in spec['segments']:
        img = Image.open(download(sg['photo'], cache))
        segs.append(Segment(img, sg['seconds'], sg['focus'], sg['zoom']))
    xfade = 0.5
    duration = sum(s.seconds for s in segs) - xfade * (len(segs) - 1)
    nframes = int(round(duration * FPS))
    chrome = chrome_layer(spec['author']['handle'], spec['tint'])
    title = title_sprite(spec['title'])
    title_pos = ((W - title.size[0]) // 2, 108)
    sprites = []
    for text, a, b, style in spec['lines']:
        sp = text_sprite(text, FONT_XBOLD, 40, style)
        cy = spec.get('linesY', 760)
        sprites.append((sp, a, min(b, duration), ((W - sp.size[0]) // 2, cy - sp.size[1] // 2)))

    mp4 = os.path.join(outdir, spec['file'] + '.mp4')
    poster = os.path.join(outdir, spec['file'] + '.jpg')
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
           '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', '-',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-maxrate', '1300k', '-bufsize', '2600k',
           '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-g', str(FPS * 2),
           '-movflags', '+faststart', '-an', '-metadata', 'title=%s (DEMO)' % spec['title'],
           '-metadata', 'comment=Young Seminole Democrats demo clip; photos under the Unsplash License', mp4]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    starts, acc = [], 0.0
    for s in segs:
        starts.append(acc)
        acc += s.seconds - xfade
    for n in range(nframes):
        t = n / FPS
        # photo layer (with crossfade)
        idx = max(i for i, st in enumerate(starts) if st <= t + 1e-9)
        frame = segs[idx].frame(min(t - starts[idx], segs[idx].seconds))
        # crossfade window: the first `xfade` seconds of every segment after the first
        if idx > 0 and t - starts[idx] < xfade:
            prev = segs[idx - 1].frame(min(t - starts[idx - 1], segs[idx - 1].seconds))
            frame = Image.blend(prev, frame, ease_in_out((t - starts[idx]) / xfade))
        im = frame.convert('RGBA')
        im.alpha_composite(chrome)
        im.alpha_composite(title, dest=title_pos)
        for sp, a, b, (x, y) in sprites:
            if t < a or t > b:
                continue
            k_in = (t - a) / 0.28
            k_out = (b - t) / 0.2 if b < duration - 0.01 else 1.0
            alpha = max(0.0, min(1.0, k_in / 0.65, k_out))
            scale = 0.86 + 0.14 * ease_out_back(k_in) if k_in < 1 else 1.0
            s2 = faded(sp, alpha, scale)
            dx = x + (sp.size[0] - s2.size[0]) // 2
            dy = y + (sp.size[1] - s2.size[1]) // 2
            im.alpha_composite(s2, dest=(max(0, dx), max(0, dy)))
        rgb = im.convert('RGB')
        if n == 0:
            rgb.save(poster, 'JPEG', quality=82, optimize=True, progressive=True)
        proc.stdin.write(rgb.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit('ffmpeg failed for ' + spec['id'])
    return mp4, poster, duration


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                          'format=duration,size:stream=codec_type,codec_name,width,height',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def write_data(entries):
    payload = {
        'demo': True,
        'version': 1,
        'generated': '2026-11-09',
        'generator': 'assets/video/make_demo_clips.py',
        'note': 'DEMO CONTENT. Fake creator handles (@demo.*), invented like/view counts and staged captions '
                'for the demo site only. Photos are Unsplash stand-ins (people shown are not members and do '
                'not endorse anything). Hidden automatically when YSD_CONFIG.demo is false.',
        'license': 'Photos: Unsplash License (https://unsplash.com/license). Clips: derived works made for this demo.',
        'items': entries,
    }
    body = json.dumps(payload, indent=2, ensure_ascii=False)
    header = (
        '/*!\n'
        ' * Young Seminole Democrats: demo video clips (DEMO DATA, flagged demo:true).\n'
        ' * GENERATED by assets/video/make_demo_clips.py: edit SPECS there and re-run instead of\n'
        ' * editing this file by hand. Paths are relative to the site root (YSD.clips resolves them).\n'
        ' * Each item records the Unsplash photo URLs it was built from and the sources for any facts\n'
        ' * burned into the clip (checked Mon Nov 9, 2026).\n'
        ' */\n'
    )
    js = header + 'window.YSD_DATA = window.YSD_DATA || {};\nwindow.YSD_DATA.clips = ' + body + ';\n'
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        f.write(js)
    print('wrote', os.path.relpath(DATA_FILE, SITE))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'ysd-demo-photos'),
                    help='where downloaded photos are kept between runs')
    ap.add_argument('--only', help='render a single clip id')
    ap.add_argument('--no-data', action='store_true', help='do not rewrite data/clips.js')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    entries = []
    for spec in SPECS:
        mp4 = os.path.join(HERE, spec['file'] + '.mp4')
        if not args.only or args.only == spec['id']:
            print('rendering', spec['id'])
            crf = 27
            while True:
                mp4, poster, _ = render_clip(spec, args.cache, HERE, crf)
                size = os.path.getsize(mp4)
                if size <= MAX_BYTES or crf >= 34:
                    break
                crf += 2
                print('  %d bytes > %d, retrying at crf %d' % (size, MAX_BYTES, crf))
        if not os.path.exists(mp4):
            print('  skipping %s (not rendered yet)' % spec['id'])
            continue
        info = probe(mp4)
        v = [s for s in info['streams'] if s['codec_type'] == 'video'][0]
        has_audio = any(s['codec_type'] == 'audio' for s in info['streams'])
        dur = round(float(info['format']['duration']), 2)
        poster_path = os.path.join(HERE, spec['file'] + '.jpg')
        print('  %s: %dx%d %s %.2fs %d KB audio=%s poster %d KB' % (
            spec['file'], v['width'], v['height'], v['codec_name'], dur, int(info['format']['size']) // 1024,
            has_audio, os.path.getsize(poster_path) // 1024))
        photos = []
        for sg in spec['segments']:
            p = PHOTOS[sg['photo']]
            photos.append({
                'url': 'https://images.unsplash.com/photo-' + p['id'],
                'downloadUrl': photo_url(p['id']),
                'page': p['page'],
                'photographer': p['photographer'],
                'photographerHandle': p['handle'],
                'license': 'Unsplash License',
                'licenseUrl': 'https://unsplash.com/license',
                'description': p['description'],
            })
        entries.append({
            'id': spec['id'],
            'demo': True,
            'src': 'assets/video/%s.mp4' % spec['file'],
            'poster': 'assets/video/%s.jpg' % spec['file'],
            'type': 'video/mp4',
            'width': v['width'], 'height': v['height'],
            'orientation': 'vertical' if v['height'] > v['width'] else ('square' if v['height'] == v['width'] else 'horizontal'),
            'duration': dur,
            'bytes': int(info['format']['size']),
            'audio': has_audio,
            'caption': spec['caption'],
            'author': spec['author'],
            'tags': spec['tags'],
            'likes': spec['likes'],
            'views': spec['views'],
            'createdAt': spec['createdAt'],
            'burnedInText': [spec['title']] + [l[0].replace('\n', ' ') for l in spec['lines']],
            'facts': spec['facts'],
            'photos': photos,
        })
    if not args.no_data:
        write_data(entries)


if __name__ == '__main__':
    main()
