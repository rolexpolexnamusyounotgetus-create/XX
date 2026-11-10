#!/usr/bin/env python3
"""
Young Democrats of Seminole County: DEMO creator clips (video workstream, G-VIDEO round 1).

Builds the short vertical DEMO clips in assets/video/ and writes data/clips.js:
  <file>.mp4       720x1280 H.264, no audio, faststart, at most 1.5 MB
  <file>.jpg       540x960 progressive JPEG poster, at most 60 KB, with NO words in it
  <file>.en.vtt    WebVTT captions in English
  <file>.es.vtt    WebVTT captions in Spanish

  python3 assets/video/make_demo_clips.py [--cache DIR] [--only ID] [--no-data] [--keep-tmp]
  python3 assets/video/make_demo_clips.py --data-only     # rewrite data/clips.js + VTT from SPECS and the files on disk

What changed in round 1 (findings genz-brand-06, genz-brand-23 and the "English on Spanish posters" item)
  - Creator formats, not slideshows: a phone screen recording with tap dots, a green-screen style map with a
    facecam bubble, a POV with jump cuts and punch-ins, a listicle, a scoreboard reveal, a train-line map.
    Hard cuts every 1 to 2.5 seconds, a hook in the first 2 seconds, brand stickers (data/stickers.js art,
    white die-cut edge) popping in.
  - No burned-in titles or captions. Captions are WebVTT and data (EN and ES) that assets/js/reel.js draws
    as TikTok-style boxed captions in the page language, and the transcript is built from the same cues.
    The only word in the picture is a small "DEMO" bug in the video (the same word in both languages), so a
    clip saved on its own can't pass as real. Posters carry no words at all; the page draws the DEMO chip.
  - Every clip belongs to a named recurring format (SERIES below), shown as badges and shelves on the Reel.

How a clip is made
  1. Photos (all already credited on the site, Unsplash License) download from images.unsplash.com into --cache.
  2. assets/video/render_clips.js (Node + Playwright) renders every frame of the shot list with
     assets/video/stage.js and pipes it into ffmpeg as a near-lossless master, plus a poster frame.
  3. This script encodes the final MP4 (CRF stepped up until it fits MAX_BYTES), the poster JPEG (best
     quality that fits POSTER_MAX_BYTES), a tiny blurred placeholder (lqip) and the dominant colour, the two
     VTT files, and data/clips.js.

Facts said in captions were checked on Tue Nov 10, 2026; sources are listed per clip in `facts` and copied
into data/clips.js. Edit SPECS here (not data/clips.js) and re-run to change a clip.

Requires: Python 3.9+, Pillow, ffmpeg/ffprobe on PATH, Node 22 with Playwright (Chromium), network access
to images.unsplash.com.
"""
import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

from PIL import Image, ImageFilter, ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))          # youngsemdem/
DATA_FILE = os.path.join(SITE, 'data', 'clips.js')
RENDERER = os.path.join(HERE, 'render_clips.js')

W, H, FPS = 720, 1280, 30
MAX_BYTES = 1_500_000
POSTER_W, POSTER_H = 540, 960          # pages show posters at 469x836 CSS px at most
POSTER_MAX_BYTES = 60_000
LQIP_W, LQIP_H = 12, 21

# ------------------------------------------------------------------------------------- photos
# Every entry was opened on unsplash.com on 2026-11-09 and shows "Free to use under the Unsplash License"
# (none are Unsplash+). They are the photos the site already credits (CREDITS.md); no new photo was added
# because a credit could not be re-confirmed from this machine (unsplash.com pages sit behind a bot check).
PHOTOS = {
    'envelope': {
        'id': '1595265616362-0d9558d774db',
        'page': 'https://unsplash.com/photos/purple-envelope-on-white-table-9A5uvtrO1Vw',
        'photographer': 'Tiffany Tertipes', 'handle': '@tiffanytertipes',
        'description': 'Election mail return envelopes on a white table. Not a Florida envelope.',
    },
    'laptops': {
        'id': '1522202176988-66273c2fd55f',
        'page': 'https://unsplash.com/photos/three-people-sitting-in-front-of-table-laughing-together-g1Kr4Ozfoac',
        'photographer': 'Brooke Cagle', 'handle': '@brookecagle',
        'description': 'Three young people laughing at a cafe table with laptops (clips crop to faces, away from the table).',
    },
    'tracks': {
        'id': '1676304437086-ad9db3b3df66',
        'page': 'https://unsplash.com/photos/cs18eMhnmxI',
        'photographer': 'Komorebi Photo', 'handle': '@komophoto',
        'description': 'Railroad track running to the horizon at sunset (tagged California). Stand-in, not SunRail.',
    },
    'park': {
        # Replaced the rooftop-party selfie (1758272134088, drink in hand), banned by docs/BRIEF.md 0.
        'id': '1758275557330-cfd545444dc3',
        'page': 'https://unsplash.com/@silverkblack',  # photographer profile; the photo page slug is unconfirmed
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
        'description': 'People watching the sunset over a calm lake from a waterfront path. Stand-in, not Lake Monroe.',
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
        'description': 'Friends laughing around a wooden table during a card game (no drinks on the table).',
    },
    'crowd': {
        'id': '1529333166437-7750a6dd5a70',
        'page': 'https://unsplash.com/photos/photo-of-three-women-lifting-there-hands-tXiMrX3Gc-g',
        'photographer': 'Simon Maage', 'handle': '',
        'description': 'Three friends seen from behind, arms up, watching the sun set from a rooftop (also on the home page).',
    },
}

# ------------------------------------------------------------------------------------- series
# Named recurring formats (finding right-wing-shows). Cadences are DEMO: the chapter sets the real ones.
SERIES = [
    {'id': 'seminole-60', 'sticker': 'megaphone', 'color': 'sun',
     'name': {'en': 'Seminole in 60', 'es': 'Seminole en 60'},
     'blurb': {'en': 'One local thing, explained in a minute or less.', 'es': 'Una cosa local, explicada en un minuto o menos.'},
     'cadence': {'en': 'New on Thursdays (DEMO)', 'es': 'Nuevos los jueves (DEMO)'}},
    {'id': 'first-time', 'sticker': 'calendar', 'color': 'sky',
     'name': {'en': 'First Time?', 'es': '¿Primera vez?'},
     'blurb': {'en': 'First vote, first meetup, first anything. Perfect.', 'es': 'Primer voto, primer encuentro, primera vez en lo que sea. Perfecto.'},
     'cadence': {'en': 'New on Tuesdays (DEMO)', 'es': 'Nuevos los martes (DEMO)'}},
    {'id': 'crew-cam', 'sticker': 'camera', 'color': 'celery',
     'name': {'en': 'Crew Cam', 'es': 'Cámara del grupo'},
     'blurb': {'en': 'Filmed by whoever showed up: hangouts, shifts, rides.', 'es': 'Lo graba quien vino: encuentros, turnos, paseos.'},
     'cadence': {'en': 'After every hangout (DEMO)', 'es': 'Después de cada encuentro (DEMO)'}},
    {'id': 'en-espanol', 'sticker': 'bubbles', 'color': 'bubblegum',
     'name': {'en': 'En español', 'es': 'En español'},
     'blurb': {'en': 'Made in Spanish first, with English captions.', 'es': 'Hechos primero en español, con subtítulos en inglés.'},
     'cadence': {'en': 'New on Sundays (DEMO)', 'es': 'Nuevos los domingos (DEMO)'}},
    {'id': 'open-mic', 'sticker': 'heart', 'color': 'tangerine',
     'name': {'en': 'Open Mic', 'es': 'Micrófono abierto'},
     'blurb': {'en': 'Your take, 60 seconds, filmed vertical. The weekly prompt lives here.', 'es': 'Tu opinión, 60 segundos, en vertical. Aquí vive el tema de la semana.'},
     'cadence': {'en': 'New prompt every Monday (DEMO)', 'es': 'Tema nuevo cada lunes (DEMO)'}},
]

# ------------------------------------------------------------------------------------- clips
# cues: (start, end, en, es). `lang` is the language the creator made it in; the other is a translation.
# shots: render_clips.js / stage.js layers (coordinates in the 720x1280 frame). Keep the middle-low band
# (about y 700 to 880) clear: the page draws the captions there.
def P(photo, focus, zoom, **kw):
    d = {'type': 'photo', 'photo': photo, 'focus': focus if isinstance(focus[0], list) else [focus], 'zoom': zoom}
    d.update(kw)
    return d


def S(*items):
    return {'type': 'stickers', 'items': [dict(zip(('id', 'x', 'y', 't', 'size', 'rot'), it)) for it in items]}


SPECS = [
    {
        'id': 'demo-mail-ballot-renew', 'file': 'mail-ballot-renew', 'series': 'seminole-60', 'lang': 'en',
        'author': {'handle': '@demo.maria', 'name': 'Maria (DEMO creator)'},
        'title': {'en': 'Renew your mail ballot request', 'es': 'Renueva tu solicitud de boleta por correo'},
        'caption': {'en': 'PSA: Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set '
                          'through 2028. Check My Voter Record to be sure.',
                    'es': 'Aviso: ¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. '
                          'Pídela otra vez y debería cubrirte hasta 2028. Revisa tu registro de votante para confirmarlo.'},
        'tags': ['vote-by-mail', 'explainer', 'psa'],
        'likes': 412, 'views': 3870, 'createdAt': '2026-11-06T18:20:00-05:00',
        'showUntil': '2027-01-01T00:00:00-05:00',
        'posterAt': 2.9,
        'cues': [
            (0.0, 2.1, 'Asked for a mail ballot before Nov 3?', '¿Pediste la boleta por correo antes del 3 de noviembre?'),
            (2.1, 3.9, 'That request ends Dec 31.', 'Esa solicitud vence el 31 de diciembre.'),
            (3.9, 6.3, 'Ask again at voteseminole.gov', 'Pídela otra vez en voteseminole.gov'),
            (6.3, 8.3, 'and you should be set through 2028.', 'y debería cubrirte hasta 2028.'),
            (8.3, 10.4, 'Check My Voter Record to be sure.', 'Revisa tu registro de votante para confirmarlo.'),
        ],
        'shots': [
            {'seconds': 1.1, 'layers': [P('envelope', [0.46, 0.5], [1.12, 1.24], grade='cool'), S(('envelope', 540, 300, 0.12, 220, 10))]},
            {'seconds': 1.0, 'transition': 'punch', 'layers': [{'type': 'phone', 'views': [{'t': 0, 'view': 'home'}], 'taps': [{'t': 0.45, 'x': 360, 'y': 422}]}]},
            {'seconds': 1.8, 'transition': 'flash', 'layers': [{'type': 'date', 'num': '31', 'bg': '#FF8B3D', 'band': '#FF4FA3', 'rays': True, 'top': 250, 'rot': -5},
                                                              S(('envelope', 590, 250, 0.5, 170, 14))]},
            {'seconds': 2.4, 'transition': 'punch', 'layers': [{'type': 'phone', 'views': [{'t': 0, 'view': 'form'}, {'t': 2.05, 'view': 'done'}],
                                                              'taps': [{'t': 0.1, 'x': 360, 'y': 418}, {'t': 1.4, 'x': 56, 'y': 848}, {'t': 1.85, 'x': 360, 'y': 975}]}]},
            {'seconds': 2.0, 'transition': 'whip', 'layers': [{'type': 'date', 'num': '2028', 'size': 210, 'w': 560, 'bg': '#C8F03C', 'band': '#6A2BFF', 'rays': True, 'top': 260, 'rot': 4},
                                                             S(('calendar', 130, 230, 0.45, 170, -12))]},
            {'seconds': 2.1, 'transition': 'punch', 'layers': [{'type': 'phone', 'views': [{'t': 0, 'view': 'record'}], 'taps': [{'t': 0.55, 'x': 300, 'y': 589}]},
                                                              S(('heart', 600, 330, 1.2, 160, 12))]},
        ],
        'facts': [
            {'claim': 'One Florida vote-by-mail request covers elections "through the end of the calendar year of the next regularly '
                      'scheduled general election", so requests made before the Nov 3, 2026 general election end Dec 31, 2026, and one made '
                      'after it should run through Dec 31, 2028.',
             'source': 'https://www.flsenate.gov/Laws/Statutes/2025/101.62'},
            {'claim': 'Seminole voters request or renew online at voteseminole.gov or by phone at 407-585-8683.',
             'source': 'https://voteseminole.gov/how-to-vote/vote-by-mail/'},
        ],
    },
    {
        'id': 'demo-sunrail-rally', 'file': 'sunrail-rally', 'series': 'crew-cam', 'lang': 'en',
        'author': {'handle': '@demo.jordan', 'name': 'Jordan (DEMO creator)'},
        'title': {'en': 'The squad takes SunRail', 'es': 'El grupo se va en SunRail'},
        'caption': {'en': 'Took SunRail with the squad. No parking, no stress. Trains run weekdays only, so we made it a weeknight. '
                          'Who is riding next time?',
                    'es': 'Fuimos en SunRail con el grupo. Sin buscar estacionamiento, sin estrés. Los trenes solo pasan de lunes a '
                          'viernes, así que lo hicimos entre semana. ¿Quién viene la próxima vez?'},
        'tags': ['sunrail', 'transit', 'squad'],
        'likes': 287, 'views': 2410, 'createdAt': '2026-11-05T19:05:00-05:00',
        'posterAt': 0.7,
        'cues': [
            (0.0, 2.0, 'POV: the squad takes SunRail', 'POV: el grupo se va en SunRail'),
            (2.0, 3.8, 'No parking. No stress.', 'Sin buscar estacionamiento. Sin estrés.'),
            (3.8, 6.8, '4 stops in Seminole County', '4 paradas en el condado de Seminole'),
            (6.8, 8.6, 'Trains run weekdays only', 'Los trenes solo pasan de lunes a viernes'),
            (8.6, 10.6, "Who's riding next time?", '¿Quién viene la próxima vez?'),
        ],
        'shots': [
            {'seconds': 1.0, 'layers': [P('park', [0.5, 0.36], [1.0, 1.07]), S(('train', 575, 230, 0.12, 200, 10))]},
            {'seconds': 1.0, 'layers': [P('park', [0.27, 0.45], [1.62, 1.68], seed=2), S(('heart', 600, 240, 0.12, 150, -10))]},
            {'seconds': 1.8, 'transition': 'whip', 'layers': [P('tracks', [0.5, 0.62], [1.0, 1.38], grade='golden', ease='linear', shake=4)]},
            {'seconds': 3.0, 'transition': 'flash', 'layers': [{'type': 'route', 'stops': ['Sanford', 'Lake Mary', 'Longwood', 'Altamonte Springs'],
                                                              't0': 0.25, 't1': 2.6, 'top': 170, 'bottom': 660}]},
            {'seconds': 1.8, 'transition': 'punch', 'layers': [{'type': 'week', 'top': 470}]},
            {'seconds': 2.0, 'transition': 'punch', 'layers': [P('park', [0.5, 0.4], [1.22, 1.28], seed=3), S(('bubbles', 590, 250, 0.15, 170, 8), ('train', 140, 260, 0.35, 160, -12))]},
        ],
        'facts': [
            {'claim': 'SunRail stations in Seminole County: Sanford, Lake Mary, Longwood and Altamonte Springs.',
             'source': 'https://corporate.sunrail.com/stations-trains/phase-1-stations/'},
            {'claim': 'SunRail currently runs Monday to Friday only (checked Nov 10, 2026).',
             'source': 'https://sunrail.com/help-center/support/maps-schedules/how-often-does-sunrail-run/'},
        ],
    },
    {
        'id': 'demo-first-time-voter', 'file': 'first-time-voter', 'series': 'first-time', 'lang': 'en',
        'author': {'handle': '@demo.ava', 'name': 'Ava (DEMO creator)'},
        'title': {'en': 'POV: first time voting', 'es': 'POV: votas por primera vez'},
        'caption': {'en': 'POV: you just voted for the first time and the sticker is going on everything.',
                    'es': 'POV: acabas de votar por primera vez y el sticker va a ir en todo.'},
        'tags': ['first-time-voter', 'pov', 'how-to-vote'],
        'likes': 655, 'views': 5120, 'createdAt': '2026-11-03T16:42:00-05:00',
        'posterAt': 0.5,
        'cues': [
            (0.0, 2.2, 'POV: you just voted for the first time', 'POV: acabas de votar por primera vez'),
            (2.2, 4.6, "Step 1: check that you're registered", 'Paso 1: confirma que estás inscrito'),
            (4.6, 7.2, 'Step 2: bring a current photo ID with your signature', 'Paso 2: lleva una identificación vigente con foto y con tu firma'),
            (7.2, 10.4, 'Step 3: the sticker is going on everything', 'Paso 3: el sticker va a ir en todo'),
        ],
        'shots': [
            {'seconds': 1.1, 'layers': [P('sticker', [0.55, 0.44], [1.0, 1.06], shake=4), S(('sun', 170, 250, 0.2, 170, -10))]},
            {'seconds': 1.1, 'transition': 'punch', 'layers': [P('sticker', [0.62, 0.37], [1.5, 1.55], shake=5, seed=2)]},
            {'seconds': 2.4, 'transition': 'flash', 'layers': [{'type': 'phone', 'views': [{'t': 0, 'view': 'record'}], 'taps': [{'t': 0.4, 'x': 300, 'y': 589}]},
                                                              {'type': 'badge', 'n': 1, 'x': 600, 'y': 330, 'size': 170, 'at': 0.05}]},
            {'seconds': 2.6, 'transition': 'whip', 'layers': [{'type': 'solid', 'bg': '#4FD6FF', 'dots': 'rgba(23,11,51,.12)'}, {'type': 'ids', 'mode': 'one', 'ok': 1.5},
                                                             {'type': 'badge', 'n': 2, 'x': 130, 'y': 190, 'size': 160, 'at': 0.05, 'color': '#FFD23F'}]},
            {'seconds': 3.2, 'transition': 'flash', 'layers': [P('crowd', [0.5, 0.42], [1.0, 1.1], grade='golden'),
                                                              {'type': 'burst', 'ids': ['celery', 'gator', 'chicken', 'sun', 'heart', 'train', 'manatee', 'palm'], 'x': 360, 'y': 420, 'at': 0.3}]},
        ],
        'facts': [
            {'claim': 'Florida polls ask for a current, valid picture ID with a signature (more than one ID can cover both).',
             'source': 'https://www.flsenate.gov/Laws/Statutes/2025/101.043'},
            {'claim': 'Registration status lookup (Florida Division of Elections).',
             'source': 'https://registration.dos.fl.gov/CheckVoterStatus'},
        ],
    },
    {
        'id': 'demo-lake-monroe-canvass', 'file': 'lake-monroe-canvass', 'series': 'crew-cam', 'lang': 'en',
        'author': {'handle': '@demo.luis', 'name': 'Luis (DEMO creator)'},
        'title': {'en': 'My first canvass, ranked', 'es': 'Mi primer puerta a puerta'},
        'caption': {'en': 'Sunset canvass by Lake Monroe. Knocked doors, met neighbors, stayed for the sky.',
                    'es': 'Puerta a puerta al atardecer junto al lago Monroe. Tocamos puertas, conocimos vecinos y nos quedamos para ver el cielo.'},
        'tags': ['canvass', 'sanford', 'volunteer'],
        'likes': 198, 'views': 1640, 'createdAt': '2026-10-29T19:10:00-04:00',
        'posterAt': 0.6,
        'cues': [
            (0.0, 2.3, "Things I didn't expect at my first canvass:", 'Cosas que no esperaba en mi primer puerta a puerta:'),
            (2.3, 4.7, '1. People actually want to talk', '1. La gente sí quiere conversar'),
            (4.7, 7.1, '2. You never knock alone', '2. Nunca tocas puertas sin compañía'),
            (7.1, 10.2, '3. This sunset', '3. Este atardecer'),
        ],
        'shots': [
            {'seconds': 1.2, 'layers': [P('lake', [0.5, 0.42], [1.22, 1.28], grade='golden'), S(('gator', 590, 300, 0.15, 180, 8))]},
            {'seconds': 1.1, 'transition': 'punch', 'layers': [P('street', [0.72, 0.55], [1.12, 1.2], seed=2), S(('palm', 150, 280, 0.1, 170, -10))]},
            {'seconds': 2.4, 'layers': [P('street', [0.36, 0.6], [1.35, 1.44], seed=3), {'type': 'badge', 'n': 1, 'x': 160, 'y': 300, 'size': 180, 'at': 0.05},
                                        S(('bubbles', 570, 430, 0.5, 190, 10))]},
            {'seconds': 2.4, 'transition': 'whip', 'layers': [P('park', [0.28, 0.46], [1.34, 1.4], seed=4), {'type': 'badge', 'n': 2, 'x': 570, 'y': 300, 'size': 180, 'at': 0.05, 'color': '#FF7AC6'},
                                                             S(('heart', 150, 430, 0.55, 160, -12))]},
            {'seconds': 3.1, 'transition': 'flash', 'layers': [P('lake', [0.47, 0.4], [1.0, 1.12], grade='golden', ease='linear'),
                                                              {'type': 'badge', 'n': 3, 'x': 160, 'y': 300, 'size': 180, 'at': 0.05, 'color': '#FFD23F'},
                                                              S(('sun', 570, 250, 0.5, 190, 10), ('lake', 590, 600, 0.9, 150, -8))]},
        ],
        'facts': [],
    },
    {
        'id': 'demo-precinct-captain', 'file': 'precinct-captain', 'series': 'seminole-60', 'lang': 'en',
        'author': {'handle': '@demo.priya', 'name': 'Priya (DEMO creator)'},
        'title': {'en': "What's a precinct captain?", 'es': '¿Qué es un capitán de precinto?'},
        'caption': {'en': "What's a precinct captain? An official Democratic Party rep for your precinct who organizes neighbors and "
                          'does voter outreach. Could be you.',
                    'es': '¿Qué es un capitán de precinto? Representa oficialmente al Partido Demócrata en tu precinto, organiza a sus '
                          'vecinos y habla con los votantes. Podrías ser tú.'},
        'tags': ['precinct-captain', 'explainer', 'organizing'],
        'likes': 341, 'views': 2980, 'createdAt': '2026-11-07T10:30:00-05:00',
        'posterAt': 0.6,
        'cues': [
            (0.0, 2.2, "What's a precinct captain?", '¿Qué es un capitán de precinto?'),
            (2.2, 5.0, 'An official Democratic Party rep for your precinct', 'Representa oficialmente al Partido Demócrata en tu precinto'),
            (5.0, 7.9, 'They organize neighbors and do voter outreach', 'Organiza a sus vecinos y habla con los votantes'),
            (7.9, 10.6, 'Could be you.', 'Podrías ser tú.'),
        ],
        'shots': [
            {'seconds': 1.2, 'layers': [P('laptops', [0.55, 0.25], [2.0, 2.05], shake=3), S(('megaphone', 570, 300, 0.15, 190, 10))]},
            {'seconds': 1.0, 'transition': 'punch', 'layers': [P('laptops', [0.555, 0.27], [2.25, 2.3], shake=3, seed=2)]},
            {'seconds': 2.8, 'transition': 'flash', 'layers': [{'type': 'map', 'bg': '#4FD6FF', 'top': 360,
                                                              'pins': [{'x': 0.44, 'y': 0.16, 't': 0.5}, {'x': 0.14, 'y': 0.40, 't': 0.75}, {'x': 0.62, 'y': 0.36, 't': 1.0},
                                                                       {'x': 0.86, 'y': 0.52, 't': 1.25}, {'x': 0.22, 'y': 0.79, 't': 1.5}, {'x': 0.70, 'y': 0.90, 't': 1.75}],
                                                              'facecam': {'photo': 'laptops', 'fx': 0.55, 'fy': 0.26, 'span': 0.13, 'x': 34, 'y': 60, 'size': 260}}]},
            {'seconds': 2.9, 'transition': 'punch', 'layers': [{'type': 'map', 'bg': '#FF7AC6', 'top': 360,
                                                              'pins': [{'x': 0.74, 'y': 0.30, 't': 0.2, 'color': '#C8F03C'}, {'x': 0.10, 'y': 0.58, 't': 0.4, 'color': '#C8F03C'},
                                                                       {'x': 0.62, 'y': 0.70, 't': 0.6, 'color': '#C8F03C'}, {'x': 0.90, 'y': 0.88, 't': 0.8, 'color': '#C8F03C'}],
                                                              'facecam': {'photo': 'laptops', 'fx': 0.555, 'fy': 0.27, 'span': 0.11, 'x': 34, 'y': 60, 'size': 260}},
                                                             S(('bubbles', 580, 200, 1.1, 170, 10), ('chicken', 600, 1000, 1.5, 150, -8))]},
            {'seconds': 2.7, 'transition': 'flash', 'layers': [P('laptops', [0.55, 0.26], [1.8, 1.88], shake=3, seed=3),
                                                              S(('heart', 160, 300, 0.2, 170, -10), ('megaphone', 580, 330, 0.45, 180, 12))]},
        ],
        'facts': [
            {'claim': 'Seminole County Democratic Party: precinct captains "are the people power behind the scenes, as well as the '
                      'front-facing voter outreach teams in their communities. As official Democratic Party representatives they '
                      'organize activities to help get Democrats elected up and down the ballot."',
             'source': 'https://form.jotform.com/250016464253045'},
        ],
    },
    {
        'id': 'demo-trivia-night-recap', 'file': 'trivia-night-recap', 'series': 'first-time', 'lang': 'en',
        'author': {'handle': '@demo.sam', 'name': 'Sam (DEMO creator)'},
        'title': {'en': 'POV: your first trivia night', 'es': 'POV: tu primera noche de trivia'},
        'caption': {'en': 'Trivia night recap: new friends, questionable team names, one very loud tiebreaker.',
                    'es': 'Resumen de la noche de trivia: amistades nuevas, nombres de equipo cuestionables y un desempate muy ruidoso.'},
        'tags': ['trivia', 'social', 'meetup'],
        'likes': 233, 'views': 1990, 'createdAt': '2026-11-08T21:15:00-05:00',
        'posterAt': 0.5,
        'cues': [
            (0.0, 2.0, 'POV: your first trivia night', 'POV: tu primera noche de trivia'),
            (2.0, 4.4, 'You came alone. You left with a team.', 'Llegaste sin conocer a nadie. Te fuiste con un equipo.'),
            (4.4, 7.4, 'Final round: one very loud tiebreaker', 'Última ronda: un desempate muy ruidoso'),
            (7.4, 10.0, 'See you at the next one', 'Nos vemos en la próxima'),
        ],
        'shots': [
            {'seconds': 1.0, 'layers': [P('cards', [0.5, 0.7], [1.5, 1.58], shake=4), S(('celery', 580, 300, 0.12, 190, 10))]},
            {'seconds': 1.0, 'transition': 'punch', 'layers': [P('cards', [0.45, 0.62], [2.0, 2.05], shake=4, seed=2), S(('library', 150, 290, 0.15, 160, -10))]},
            {'seconds': 2.4, 'transition': 'whip', 'layers': [P('cards', [0.5, 0.45], [1.0, 1.06], grade='golden', seed=3)]},
            {'seconds': 3.0, 'transition': 'flash', 'layers': [P('cards', [0.5, 0.5], [1.1, 1.1], filter='blur(10px)', grade='dim', shake=0),
                                                              {'type': 'score', 'top': 150, 'max': 10, 'rows': [
                                                                  {'sticker': 'gator', 'score': 8, 'color': '#C8F03C'},
                                                                  {'sticker': 'chicken', 'score': 9, 'color': '#FF7AC6', 'bump': 1.9},
                                                                  {'sticker': 'manatee', 'score': 6, 'color': '#4FD6FF'},
                                                                  {'sticker': 'celery', 'score': 9, 'color': '#FF8B3D'}]},
                                                              {'type': 'burst', 'ids': ['chicken', 'heart', 'sun', 'heart'], 'x': 600, 'y': 190, 'at': 2.0, 'radius': 70, 'size': 90}]},
            {'seconds': 2.6, 'transition': 'flash', 'layers': [P('cards', [0.62, 0.42], [1.16, 1.22], seed=4), S(('heart', 150, 280, 0.2, 170, -10), ('calendar', 590, 300, 0.5, 170, 10))]},
        ],
        'facts': [],
    },
    {
        'id': 'demo-student-id-2027', 'file': 'student-id-2027', 'series': 'en-espanol', 'lang': 'es',
        'author': {'handle': '@demo.vale', 'name': 'Vale (DEMO creator)'},
        'title': {'en': 'Student IDs stop counting Jan 1', 'es': 'La ID de estudiante deja de servir el 1 de enero'},
        'caption': {'es': '¿Votas con tu ID de estudiante? Desde el 1 de enero de 2027, Florida deja de aceptarla para votar (la medida '
                          'está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y '
                          'revisa voteseminole.gov antes de ir.',
                    'en': "Do you vote with your student ID? Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's "
                          "being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go."},
        'tags': ['student-id', 'explainer', 'how-to-vote', 'en-espanol'],
        'likes': 389, 'views': 3015, 'createdAt': '2026-11-09T12:10:00-05:00',
        'posterAt': 0.6,
        'cues': [
            (0.0, 2.4, 'Do you vote with your student ID?', '¿Votas con tu ID de estudiante?'),
            (2.4, 5.2, 'Starting Jan 1, 2027, Florida stops accepting it at the polls', 'Desde el 1 de enero de 2027, Florida deja de aceptarla para votar'),
            (5.2, 6.8, "(it's being challenged in court)", '(la medida está impugnada en los tribunales)'),
            (6.8, 9.4, "Bring a driver's license, state ID, or passport", 'Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte'),
            (9.4, 11.6, 'and check voteseminole.gov before you go', 'y revisa voteseminole.gov antes de ir'),
        ],
        'shots': [
            {'seconds': 1.2, 'layers': [P('laptops', [0.76, 0.27], [1.85, 1.9], shake=3), S(('library', 160, 300, 0.15, 180, -10))]},
            {'seconds': 1.2, 'transition': 'punch', 'layers': [{'type': 'solid', 'bg': '#6A2BFF', 'dots': 'rgba(255,246,234,.14)'}, {'type': 'ids', 'mode': 'student', 'x': 0.55}]},
            {'seconds': 2.8, 'transition': 'flash', 'layers': [{'type': 'date', 'num': '1', 'sub': '2027', 'bg': '#FFD23F', 'band': '#2236C9', 'rays': True, 'top': 200, 'size': 280, 'rot': -4},
                                                              S(('calendar', 590, 230, 0.6, 160, 12))]},
            {'seconds': 1.6, 'transition': 'punch', 'layers': [P('laptops', [0.765, 0.29], [2.2, 2.25], shake=3, seed=2), S(('bubbles', 580, 300, 0.15, 170, 10))]},
            {'seconds': 2.6, 'transition': 'whip', 'layers': [{'type': 'solid', 'bg': '#7EE081', 'dots': 'rgba(23,11,51,.12)'}, {'type': 'ids', 'mode': 'others'}]},
            {'seconds': 2.2, 'transition': 'punch', 'layers': [{'type': 'phone', 'views': [{'t': 0, 'view': 'home'}], 'taps': [{'t': 0.5, 'x': 360, 'y': 422}]},
                                                              S(('calendar', 600, 560, 0.4, 150, 10))]},
        ],
        'facts': [
            {'claim': 'HB 991 (Ch. 2026-26), signed Apr 1, 2026, removes student IDs (and some others) from the photo IDs accepted at '
                      'the polls in s. 101.043, starting Jan 1, 2027.',
             'source': 'https://flsenate.gov/Committees/BillSummaries/2026/html/991'},
            {'claim': 'A federal lawsuit filed Oct 16, 2026 challenges the student-ID change.',
             'source': 'https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf'},
        ],
    },
    {
        'id': 'demo-why-i-showed-up', 'file': 'why-i-showed-up', 'series': 'open-mic', 'lang': 'en',
        'author': {'handle': '@demo.nia', 'name': 'Nia (DEMO creator)'},
        'title': {'en': 'Why I showed up', 'es': 'Por qué participé'},
        'caption': {'en': 'Why I showed up: someone saved me a seat. Now I save one for someone else. Your turn.',
                    'es': 'Por qué participé: alguien me guardó un lugar. Ahora yo le guardo uno a alguien más. Te toca.'},
        'tags': ['why-i-showed-up', 'open-mic', 'social'],
        'likes': 506, 'views': 4210, 'createdAt': '2026-11-09T20:40:00-05:00',
        'posterAt': 0.55,
        'cues': [
            (0.0, 2.0, '60 seconds on why I showed up:', '60 segundos sobre por qué participé:'),
            (2.0, 4.4, "At my first meetup, I didn't know anyone", 'En mi primer encuentro no conocía a nadie'),
            (4.4, 6.6, 'Someone saved me a seat', 'Alguien me guardó un lugar'),
            (6.6, 9.0, 'Now I save one for someone else', 'Ahora yo le guardo uno a alguien más'),
            (9.0, 11.0, 'Your turn: why did you show up?', 'Te toca: ¿por qué participaste tú?'),
        ],
        'shots': [
            {'seconds': 1.0, 'layers': [P('park', [0.62, 0.24], [2.0, 2.05], shake=3), S(('megaphone', 160, 300, 0.12, 180, -10))]},
            {'seconds': 1.0, 'transition': 'punch', 'layers': [P('park', [0.625, 0.26], [2.3, 2.35], shake=3, seed=2)]},
            {'seconds': 2.4, 'transition': 'whip', 'layers': [P('crowd', [0.32, 0.5], [1.3, 1.36], grade='cool', seed=3)]},
            {'seconds': 2.2, 'transition': 'flash', 'layers': [{'type': 'solid', 'bg': '#4FD6FF', 'dots': 'rgba(23,11,51,.12)'}, {'type': 'seats', 'top': 330, 'saved': 2, 'heart': 0.7}]},
            {'seconds': 2.4, 'transition': 'punch', 'layers': [P('park', [0.55, 0.36], [1.3, 1.38], grade='golden', seed=4), S(('heart', 160, 300, 0.25, 170, -10), ('calendar', 590, 330, 0.55, 170, 10))]},
            {'seconds': 2.0, 'transition': 'flash', 'layers': [P('park', [0.62, 0.24], [1.85, 1.9], shake=3, seed=5), S(('camera', 590, 290, 0.15, 180, 10))]},
        ],
        'facts': [],
    },
]


# ------------------------------------------------------------------------------------- helpers
def photo_url(pid, width=3200):
    return 'https://images.unsplash.com/photo-%s?w=%d&q=85&fm=jpg' % (pid, width)


def download(key, cache):
    info = PHOTOS[key]
    path = os.path.join(cache, '%s-w3200.jpg' % info['id'])
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return path
    url = photo_url(info['id'])
    with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as r:
        status = getattr(r, 'status', r.getcode())
        ctype = r.headers.get('Content-Type', '')
        body = r.read()
    if status != 200 or not ctype.startswith('image/'):
        raise SystemExit('download failed for %s: HTTP %s %s' % (url, status, ctype))
    with open(path, 'wb') as f:
        f.write(body)
    print('  downloaded %s (HTTP %s, %s, %d KB)' % (key, status, ctype, len(body) // 1024))
    return path


def photos_used(spec):
    keys = []
    for sh in spec['shots']:
        for L in sh['layers']:
            for k in (L.get('photo'), (L.get('facecam') or {}).get('photo')):
                if k and k not in keys:
                    keys.append(k)
    return keys


def duration_of(spec):
    return round(sum(sh['seconds'] for sh in spec['shots']), 3)


def check_spec(spec):
    d = duration_of(spec)
    cues = spec['cues']
    assert 6 <= d <= 12, '%s: duration %.2f outside 6-12 s' % (spec['id'], d)
    assert abs(cues[-1][1] - d) < 0.05, '%s: last cue ends at %.2f but the clip is %.2f s' % (spec['id'], cues[-1][1], d)
    assert cues[0][0] == 0 and cues[0][1] <= 2.5, '%s: the hook must be in the first 2.5 seconds' % spec['id']
    for a, b in zip(cues, cues[1:]):
        assert abs(a[1] - b[0]) < 1e-6, '%s: cue gap at %.2f' % (spec['id'], a[1])
    assert spec['series'] in [s['id'] for s in SERIES], spec['id'] + ': unknown series'
    assert len(spec['caption']['en']) <= 300 and len(spec['caption']['es']) <= 300, spec['id'] + ': caption over 300'


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def encode(master, out, title, crf):
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', master,
           '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-maxrate', '1250k', '-bufsize', '2500k',
           '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-g', str(FPS * 2), '-movflags', '+faststart', '-an',
           '-metadata', 'title=%s (DEMO)' % title,
           '-metadata', 'comment=Young Democrats of Seminole County DEMO clip; photos under the Unsplash License', out]
    subprocess.run(cmd, check=True)
    return os.path.getsize(out)


def save_poster(png, path):
    """540x960 progressive JPEG, the best quality that fits POSTER_MAX_BYTES. Returns (quality, bytes, image)."""
    img = Image.open(png).convert('RGB').resize((POSTER_W, POSTER_H), Image.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=0.7, percent=30, threshold=3))
    for blur in (0, 0.5, 0.8):
        src = img.filter(ImageFilter.GaussianBlur(blur)) if blur else img
        for q in range(90, 55, -2):
            buf = io.BytesIO()
            src.save(buf, 'JPEG', quality=q, optimize=True, progressive=True, subsampling='4:2:0')
            if buf.tell() <= POSTER_MAX_BYTES:
                with open(path, 'wb') as f:
                    f.write(buf.getvalue())
                return q, buf.tell(), img
    raise SystemExit('poster %s does not fit %d bytes' % (path, POSTER_MAX_BYTES))


def placeholder(img):
    """A tiny blurred JPEG as a data: URL (the card shows it until the poster arrives) and the dominant colour."""
    small = img.resize((LQIP_W, LQIP_H), Image.BOX).filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    small.save(buf, 'JPEG', quality=42, optimize=True)
    mean = ImageStat.Stat(img.resize((24, 42), Image.BOX)).mean
    color = '#%02X%02X%02X' % tuple(int(round(c * 0.8)) for c in mean[:3])   # a little darker, so white chips sit well
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('ascii'), color


def vtt_time(s):
    ms = int(round(s * 1000))
    return '%02d:%02d:%02d.%03d' % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def write_vtt(spec, lang):
    idx = 2 if lang == 'en' else 3
    lines = ['WEBVTT', '', 'NOTE %s · DEMO clip by %s · %s captions%s' % (
        spec['id'], spec['author']['handle'], 'English' if lang == 'en' else 'Spanish',
        '' if spec['lang'] == lang else ' (translated)'), '']
    for n, c in enumerate(spec['cues'], 1):
        lines += [str(n), '%s --> %s line:62%% align:center' % (vtt_time(c[0]), vtt_time(c[1])), c[idx], '']
    path = os.path.join(HERE, '%s.%s.vtt' % (spec['file'], lang))
    body = '\n'.join(lines)
    old = open(path, encoding='utf-8').read() if os.path.exists(path) else None
    if old != body:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(body)
    return 'assets/video/%s.%s.vtt' % (spec['file'], lang)


def render(specs, cache, tmp):
    job = {'fps': FPS, 'tmp': tmp, 'photos': {}, 'clips': []}
    for spec in specs:
        for k in photos_used(spec):
            p = download(k, cache)
            with Image.open(p) as im:
                job['photos'][k] = {'path': p, 'w': im.size[0], 'h': im.size[1]}
        job['clips'].append({'id': spec['id'], 'file': spec['file'], 'posterAt': spec.get('posterAt', 0.5),
                             'duration': duration_of(spec), 'shots': spec['shots']})
    jf = os.path.join(tmp, 'job.json')
    with open(jf, 'w') as f:
        json.dump(job, f)
    out = subprocess.run(['node', RENDERER, jf], capture_output=True, text=True, cwd=SITE)
    if out.returncode != 0:
        sys.stderr.write(out.stderr)
        raise SystemExit('render_clips.js failed')
    if out.stderr.strip():
        sys.stderr.write(out.stderr)
    return {r['id']: r for r in (json.loads(l) for l in out.stdout.splitlines() if l.strip().startswith('{'))}


def finish(spec, res):
    mp4 = os.path.join(HERE, spec['file'] + '.mp4')
    crf = 26
    while True:
        size = encode(res['master'], mp4, spec['title']['en'], crf)
        if size <= MAX_BYTES or crf >= 36:
            break
        crf += 1
    q, psize, img = save_poster(res['poster'], os.path.join(HERE, spec['file'] + '.jpg'))
    print('  %s: %d KB at crf %d, poster q%d %d KB' % (spec['file'], size // 1024, crf, q, psize // 1024))


def entry(spec):
    mp4 = os.path.join(HERE, spec['file'] + '.mp4')
    poster = os.path.join(HERE, spec['file'] + '.jpg')
    info = probe(mp4)
    v = [s for s in info['streams'] if s['codec_type'] == 'video'][0]
    with Image.open(poster) as im:
        pw, ph = im.size
        lqip, color = placeholder(im.convert('RGB'))
    photos = []
    for k in photos_used(spec):
        p = PHOTOS[k]
        photos.append({'url': 'https://images.unsplash.com/photo-' + p['id'], 'downloadUrl': photo_url(p['id']), 'page': p['page'],
                       'photographer': p['photographer'], 'photographerHandle': p['handle'], 'license': 'Unsplash License',
                       'licenseUrl': 'https://unsplash.com/license', 'description': p['description']})
    tracks = {lang: {'src': write_vtt(spec, lang), 'label': 'English' if lang == 'en' else 'Español',
                     'translated': spec['lang'] != lang,
                     'cues': [[c[0], c[1], c[2 if lang == 'en' else 3]] for c in spec['cues']]} for lang in ('en', 'es')}
    e = {
        'id': spec['id'], 'demo': True,
        'src': 'assets/video/%s.mp4' % spec['file'], 'poster': 'assets/video/%s.jpg' % spec['file'], 'type': 'video/mp4',
        'width': v['width'], 'height': v['height'], 'orientation': 'vertical' if v['height'] > v['width'] else 'horizontal',
        'duration': round(float(info['format']['duration']), 2), 'bytes': int(info['format']['size']),
        'posterBytes': os.path.getsize(poster), 'posterWidth': pw, 'posterHeight': ph,
        'color': color, 'lqip': lqip,
        'audio': any(s['codec_type'] == 'audio' for s in info['streams']),
        'burnedIn': ['DEMO'],
        'lang': spec['lang'],
        'series': spec['series'],
        'title': spec['title'],
        'caption': spec['caption'][spec['lang']],
        'captionI18n': spec['caption'],
        'captions': tracks,
        'author': spec['author'], 'tags': spec['tags'], 'likes': spec['likes'], 'views': spec['views'], 'createdAt': spec['createdAt'],
        'facts': spec['facts'], 'photos': photos,
    }
    if spec.get('showUntil'):
        e['showUntil'] = spec['showUntil']
    return e


def write_data(entries):
    payload = {
        'demo': True, 'version': 2, 'generated': '2026-11-10', 'generator': 'assets/video/make_demo_clips.py',
        'note': 'DEMO CONTENT. Fake creator handles (@demo.*), invented like/view counts (never shown) and staged captions for the '
                'demo site only. Photos are Unsplash stand-ins (people shown are not members and do not endorse anything). '
                'Captions are data and WebVTT, not burned in: the only word in a video is a small DEMO bug. Hidden automatically '
                'when YSD_CONFIG.demo is false.',
        'license': 'Photos: Unsplash License (https://unsplash.com/license). Clips: derived works made for this demo.',
        'series': SERIES,
        'items': entries,
    }
    body = json.dumps(payload, indent=2, ensure_ascii=False)
    header = (
        '/*!\n'
        ' * Young Democrats of Seminole County: demo video clips (DEMO DATA, flagged demo:true).\n'
        ' * GENERATED by assets/video/make_demo_clips.py: edit SPECS there and re-run instead of editing this file.\n'
        ' * Paths are relative to the site root (YSD.clips resolves them). Each item records its series (a named\n'
        ' * recurring format, listed in `series`), its captions in EN and ES (cues + a .vtt file; `lang` is the\n'
        ' * language it was made in), a tiny placeholder (lqip) and colour for the card before the poster loads,\n'
        ' * the Unsplash photos it was built from and the sources for any facts in its captions (checked Nov 10, 2026).\n'
        ' */\n'
    )
    js = header + 'window.YSD_DATA = window.YSD_DATA || {};\nwindow.YSD_DATA.clips = ' + body + ';\n'
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        f.write(js)
    print('wrote', os.path.relpath(DATA_FILE, SITE))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'ysd-demo-photos'), help='downloaded photos, kept between runs')
    ap.add_argument('--only', help='render a single clip id (comma list allowed)')
    ap.add_argument('--no-data', action='store_true', help='do not rewrite data/clips.js')
    ap.add_argument('--data-only', action='store_true', help='skip rendering: rewrite VTT files and data/clips.js from SPECS and the files on disk')
    ap.add_argument('--keep-tmp', action='store_true', help='keep the masters and poster frames')
    args = ap.parse_args()
    for spec in SPECS:
        check_spec(spec)
    os.makedirs(args.cache, exist_ok=True)
    if not args.data_only:
        only = set(args.only.split(',')) if args.only else None
        todo = [s for s in SPECS if not only or s['id'] in only]
        tmp = tempfile.mkdtemp(prefix='ysd-clips-')
        try:
            print('rendering %d clip(s) in %s' % (len(todo), tmp))
            results = render(todo, args.cache, tmp)
            for spec in todo:
                finish(spec, results[spec['id']])
        finally:
            if not args.keep_tmp:
                shutil.rmtree(tmp, ignore_errors=True)
    if not args.no_data:
        entries = [entry(s) for s in SPECS if os.path.exists(os.path.join(HERE, s['file'] + '.mp4'))]
        write_data(entries)
        keep = {s['file'] for s in SPECS}
        for f in os.listdir(HERE):
            base = f.split('.')[0]
            if f.endswith(('.mp4', '.jpg', '.vtt')) and base not in keep:
                print('  stale file (not in SPECS):', f)


if __name__ == '__main__':
    main()
