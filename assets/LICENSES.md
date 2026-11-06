# Embedded asset licences

Every file in `assets/embed/` is inlined into the page by build.py as a data: URI on `window.FightAssets[name]`.
All of them are CC0 1.0 (public domain dedication). The decoding code in `src/avatar3d.js` is ported from
HumanForge (MIT, (c) abdulrehman043, https://github.com/abdulrehman043/humanforge); its asset package is CC0
(`LICENSE.ASSETS.md` in that repo: MakeHuman system assets and MPFB2 data). Mesh2Motion's art assets are CC0
(https://github.com/scottpetrovic/mesh2motion-app, `LICENSE-CC0.MD`); its code is MIT and none of it is used.

Not embedded: the Mixamo-derived three.js example characters (licence unclear) and anything from `assets/reference/`
(likeness reference photos, used only by eye to set face sliders and appearance text).

| File | Bytes | Source | Author | Licence | Changes |
|---|---|---|---|---|---|
| `mh-body.glb.gz` | 298296 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/body.glb.gz | MakeHuman base mesh, MPFB2 Mixamo-named game rig and weights, packed by HumanForge | CC0-1.0 | unchanged |
| `mh-clips.bin.gz` | 125058 | https://raw.githubusercontent.com/scottpetrovic/mesh2motion-app/4f1316296660f2b9827ff46b4db10fb241ec2147/static/assets/human/animations/ (Death_A, Death_C, Death_D, Hit_Knockback, Dizzy, Idle Hurt, Victory, Victory Fist Pump, LayToIdle, Crawl, Sit_Ground_Idle, Kneeling Tired, Hit_Head, Hit_Chest, Tired Hunched, Idle_ShakeOff, Fighting Idle) | Mesh2Motion (Scott Petrovic) / Quaternius Universal Animation Library | CC0-1.0 (LICENSE-CC0.MD and README "Licenses" in the mesh2motion-app repo, checked Nov 6, 2026) | baked here by sampling at 30 fps into world-delta quaternions per bone plus pelvis offset (tools in the session scratchpad: av/bakeclips.js) |
| `mh-eyebrows-eyebrow001.glb.gz` | 5317 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyebrows-eyebrow001.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyebrows-eyebrow001.webp` | 12328 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyebrows-eyebrow001.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded (WebP q82) |
| `mh-eyebrows-eyebrow010.glb.gz` | 5360 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyebrows-eyebrow010.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyebrows-eyebrow010.webp` | 12194 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyebrows-eyebrow010.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded (WebP q82) |
| `mh-eyelashes-eyelashes01.glb.gz` | 5663 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyelashes-eyelashes01.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyelashes-eyelashes01.webp` | 16126 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyelashes-eyelashes01.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded (WebP q82) |
| `mh-eyes-high-poly.glb.gz` | 36031 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyes-high-poly.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyes-high-poly.webp` | 7766 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyes-high-poly.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded (WebP q82) |
| `mh-hair-afro01.glb.gz` | 73094 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-afro01.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-afro01.webp` | 198418 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-afro01.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px and re-encoded (WebP q82) |
| `mh-hair-ponytail01.glb.gz` | 170170 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-ponytail01.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-ponytail01.webp` | 94412 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-ponytail01.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px and re-encoded (WebP q82) |
| `mh-hair-short01.glb.gz` | 121409 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-short01.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-short01.webp` | 157362 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-short01.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px and re-encoded (WebP q82) |
| `mh-hair-short02.glb.gz` | 85736 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-short02.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-short02.webp` | 185994 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-short02.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded (WebP q82) |
| `mh-hair-short04.glb.gz` | 40140 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-short04.glb.gz | MakeHuman system assets (proxy), fitted data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-short04.webp` | 283794 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-short04.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded (WebP q82) |
| `mh-iris-blue.webp` | 11282 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/blue.webp | MakeHuman system assets (eyes) | CC0-1.0 | unchanged |
| `mh-iris-brown.webp` | 8488 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/brown.webp | MakeHuman system assets (eyes) | CC0-1.0 | unchanged |
| `mh-iris-brownlight.webp` | 12514 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/brownlight.webp | MakeHuman system assets (eyes) | CC0-1.0 | unchanged |
| `mh-iris-green.webp` | 10196 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/green.webp | MakeHuman system assets (eyes) | CC0-1.0 | unchanged |
| `mh-iris-grey.webp` | 10602 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/grey.webp | MakeHuman system assets (eyes) | CC0-1.0 | unchanged |
| `mh-manifest.json` | 29230 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/manifest.json | HumanForge build of MakeHuman/MPFB2 data | CC0-1.0 | trimmed: only the bones, morph table, proxies and skins used here |
| `mh-shapes.bin.gz` | 1082309 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/shapes.bin.gz | MakeHuman / MPFB2 targets, packed by HumanForge | CC0-1.0 | repacked subset: 32 macro bases, face and body detail targets, 6 expressions (ear, dimple, cleft and most expression targets dropped) |
| `mh-skin-middleage_african_male.webp` | 84452 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/middleage_african_male_2k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |
| `mh-skin-middleage_asian_male.webp` | 48668 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/middleage_asian_male_1k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |
| `mh-skin-middleage_caucasian_male.webp` | 132304 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/middleage_caucasian_male_1k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |
| `mh-skin-old_caucasian_male.webp` | 84214 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/old_caucasian_male_1k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |
| `mh-skin-young_african_female.webp` | 26212 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_african_female_1k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |
| `mh-skin-young_african_male.webp` | 74600 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_african_male_2k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |
| `mh-skin-young_caucasian_female.webp` | 50850 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_caucasian_female_1k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |
| `mh-skin-young_caucasian_male.webp` | 127734 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_caucasian_male_1k.webp | MakeHuman system assets (skins) | CC0-1.0 | unchanged |

Total: 3728323 bytes (about 4971097 bytes once base64-encoded in the page).

## Arena (src/arena3d.js)

The arena embeds no files and adds nothing to `assets/embed/`. Every arena texture is generated at runtime in the
browser by our own code: the 2048 px canvas (mat) print and fabric grain, the plain-weave normal map, the chain-link
alpha and normal maps, the canvas wear map (scuffs, sweat, blood), the LED ring and ribbon boards, the video
boards, the post pads and the flash sprite. The lighting environment is a small procedural scene run through
three.js's PMREMGenerator (RoomEnvironment from the r128 examples is an optional alternative). All branding is our
own ("FIGHT LAB", the matchup names, the division and weight); there are no UFC or sponsor marks. Fonts come from
the page's Google Fonts link (Big Shoulders Display and Archivo, SIL Open Font License 1.1); the dev page
`tests/dev_arena.html` can use local copies served at `/fonts/` and is not part of the published build.
