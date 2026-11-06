# Embedded asset licences

Every file in `assets/embed/` is inlined into the page by build.py as a data: URI on `window.FightAssets[name]`.
Most are CC0 1.0 (public domain dedication); the exceptions are marked in bold below: the board-shorts mesh (CC BY 2.5 SE, credit given) and the Mixamo motion clips (Adobe Mixamo terms).

- Body, shape targets, rig, skins, eyes, brows, lashes and hair: MakeHuman system assets and MPFB2 data (CC0), in the
  packed format of HumanForge (https://github.com/abdulrehman043/humanforge, `assets/human/`; asset licence in its
  `LICENSE.ASSETS.md`). The decoding and proxy-fitting code in `src/avatar3d.js` is ported from HumanForge's
  `src/human/runtime.ts` and `glb.ts`, which are MIT (c) abdulrehman043.
- Motion clips: Adobe Mixamo fight animations (see the table; not CC0). The earlier Mesh2Motion clip file (mh-clips.bin.gz) was replaced by them on Nov 6, 2026.

Not embedded: the Mixamo-derived three.js example characters (licence unclear) and anything in `assets/reference/`
(likeness reference photos, used only by eye to set face sliders and appearance text, and kept out of git).

| File | Bytes | Source | Author | Licence | Changes |
|---|---|---|---|---|---|
| `mh-body.glb.gz` | 298296 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/body.glb.gz | MakeHuman base mesh with the MPFB2 Mixamo-named game rig and weights, packed by HumanForge | CC0-1.0 | unchanged |
| `mh-eyebrows-eyebrow001.glb.gz` | 5317 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyebrows-eyebrow001.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyebrows-eyebrow001.webp` | 12328 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyebrows-eyebrow001.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded as WebP q82 |
| `mh-eyebrows-eyebrow010.glb.gz` | 5360 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyebrows-eyebrow010.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyebrows-eyebrow010.webp` | 12194 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyebrows-eyebrow010.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded as WebP q82 |
| `mh-eyelashes-eyelashes01.glb.gz` | 5663 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyelashes-eyelashes01.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyelashes-eyelashes01.webp` | 16126 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyelashes-eyelashes01.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded as WebP q82 |
| `mh-eyes-high-poly.glb.gz` | 36031 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/eyes-high-poly.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-eyes-high-poly.webp` | 7766 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/eyes-high-poly.webp | MakeHuman system assets (texture) | CC0-1.0 | re-encoded as WebP q82 |
| `mh-hair-afro01.glb.gz` | 73094 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-afro01.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-afro01.webp` | 198418 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-afro01.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px, re-encoded as WebP q82 |
| `mh-hair-ponytail01.glb.gz` | 170170 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-ponytail01.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-ponytail01.webp` | 94412 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-ponytail01.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px, re-encoded as WebP q82 |
| `mh-hair-short01.glb.gz` | 121409 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-short01.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-short01.webp` | 157362 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-short01.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px, re-encoded as WebP q82 |
| `mh-hair-short02.glb.gz` | 85736 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-short02.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-short02.webp` | 48344 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-short02.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px, WebP q80, alpha q90 |
| `mh-hair-short04.glb.gz` | 40140 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/proxies/hair-short04.glb.gz | MakeHuman system assets (proxy mesh), fitting data by HumanForge | CC0-1.0 | unchanged |
| `mh-hair-short04.webp` | 96190 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/textures/hair-short04.webp | MakeHuman system assets (texture) | CC0-1.0 | resized to 512 px, WebP q80, alpha q90 |
| `mh-iris-blue.webp` | 11282 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/blue.webp | MakeHuman system assets (eye texture) | CC0-1.0 | unchanged |
| `mh-iris-brown.webp` | 8488 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/brown.webp | MakeHuman system assets (eye texture) | CC0-1.0 | unchanged |
| `mh-iris-brownlight.webp` | 12514 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/brownlight.webp | MakeHuman system assets (eye texture) | CC0-1.0 | unchanged |
| `mh-iris-green.webp` | 10196 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/green.webp | MakeHuman system assets (eye texture) | CC0-1.0 | unchanged |
| `mh-iris-grey.webp` | 10602 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/eyes/grey.webp | MakeHuman system assets (eye texture) | CC0-1.0 | unchanged |
| `mh-manifest.json` | 29228 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/manifest.json | HumanForge build of MakeHuman / MPFB2 data | CC0-1.0 | trimmed to the bones, morph table, proxies and skins used here; skin swatches re-measured on the re-toned textures; short02/short04 textureSize 512 |
| `mh-shapes.bin.gz` | 1082309 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/shapes.bin.gz | MakeHuman / MPFB2 targets, packed by HumanForge | CC0-1.0 | repacked subset: 32 macro bases, face and body detail targets, 6 expression units (ear, dimple and chin-cleft targets and most expressions dropped) |
| `mh-skin-middleage_african_male.webp` | 97554 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/middleage_african_male_2k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-skin-middleage_asian_male.webp` | 56094 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/middleage_asian_male_1k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-skin-middleage_caucasian_male.webp` | 145818 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/middleage_caucasian_male_2k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-skin-old_caucasian_male.webp` | 94034 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/old_caucasian_male_1k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-skin-young_african_female.webp` | 32634 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_african_female_1k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-skin-young_african_male.webp` | 81498 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_african_male_2k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-skin-young_caucasian_female.webp` | 54816 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_caucasian_female_1k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-skin-young_caucasian_male.webp` | 128074 | https://raw.githubusercontent.com/abdulrehman043/humanforge/main/assets/human/skins/young_caucasian_male_2k.webp | MakeHuman system assets (skin) | CC0-1.0 | island tones evened out (each UV island divided by its low-pass colour and brought to the torso mean, so the head no longer reads darker and redder than the body; detail kept), re-encoded as WebP q82/85 (scratchpad avatar2/tools/flatskin.py) |
| `mh-shapes-x.bin.gz` | 106406 | https://github.com/makehumancommunity/mpfb2 (src/mpfb/data/targets: ears, chin, nose, mouth, eyes, head, forehead, neck, torso, arms, legs, stomach, cheek, asym) and https://files2.makehumancommunity.org/asset_packs/{ears01,nose01,cheek01}/ (community targets elvs_flap_ears_1-3, elvs_ear_flap_bottom_out, rehmanpolanski_ear_flatten, mindfront_ear_details, elvs_nose_widening_1, elvs_bulbous_nose_1, elvs_sunken_cheeks_1, elvs_jowls_1) | MakeHuman / MPFB2 team; community target authors Elvaerwyn, RehmanPolanski, Mindfront | CC0-1.0 (MPFB2 LICENSE.md: targets are CC0; community packs listed as CC0 on the pack pages) | 204 targets the likeness sheets and the athletic build use, decimetres to metres, sparse indices, 8-bit (16-bit above 3 cm) per-target scale, byte-planed, gzipped (avatar2/tools/packshapes.py) |
| `mh-proxies-x.json` | 1369 | HumanForge-format proxy entries for the two clothing proxies below | this project | CC0-1.0 | written by avatar2/tools/packproxies.py |
| `mh-clothes-learning_mma_fighting_gloves.glb.gz` | 134654 | https://files2.makehumancommunity.org/asset_packs/gloves01/ (learning_mma_fighting_gloves; page http://www.makehumancommunity.org/node/95) | learning | CC0-1.0 | converted to the HumanForge proxy format (fitting refs, offsets, weights), gzipped; tinted per kit in code |
| `mh-clothes-learning_mma_fighting_gloves.webp` | 18102 | https://files2.makehumancommunity.org/asset_packs/gloves01/ (texture of the same proxy) | learning | CC0-1.0 | resized to 512 px, WebP q82 (used as greyscale detail under the kit colour) |
| `mh-clothes-elvs_male_swim_shorts1.glb.gz` | 28032 | https://files2.makehumancommunity.org/asset_packs/pants03/ (elvs_male_swim_shorts1; page http://www.makehumancommunity.org/node/1321) | Elvaerwyn | **CC BY 2.5 SE** (pack page "CC-BY"; MakeHuman asset FAQ links https://creativecommons.org/licenses/by/2.5/se/deed.en). Credit: "Board shorts mesh: elvs_male_swim_shorts1 by Elvaerwyn, CC BY 2.5 SE"; the credit also sits in the src/avatar3d.js header, which ships inside the page | converted to the HumanForge proxy format, gzipped; its print texture is not used (kit colours and panels are drawn in code) |
| `mh-skin-athletic-n.jpg` | 198277 | derived: Mindfront "Aksel" skin normal map (https://files2.makehumancommunity.org/asset_packs/skins02/, http://www.makehumancommunity.org/node/850) combined with generated vein detail (assets_wide tools/characters/generate.py) | Mindfront; this project | CC0-1.0 | resized 2048 to 1024 px, JPEG q88 4:4:4; head island masked out in the shader |
| `mh-skin-pores-n.jpg` | 39650 | generated tileable pore and micro-crease normal (assets_wide tools/characters/generate.py) | this project | CC0-1.0 | resized to 256 px, JPEG q90 4:4:4, tiled 46x over the UV |
| `mh-skin-spec.jpg` | 24715 | https://files2.makehumancommunity.org/asset_packs/skins02/ (mindfront_aksel_skin, Aksel_Skin_SPEC) | Mindfront | CC0-1.0 | greyscale 512 px JPEG q85, read as a roughness map |
| `mh-mask-hair.png` | 52454 | generated scalp coverage maps (buzz cut, skin fade, receding buzz) on the MakeHuman hm08 UV (assets_wide tools/characters/generate.py, from the MPFB2 CC0 base mesh) | this project | CC0-1.0 | dilated, blurred, cropped to the head island (u 0.6-0.9, v 0.03-0.87), 200x560 RGB, 64 levels |
| `mh-mask-hair2.png` | 41040 | as above (horseshoe balding, shaved-scalp shadow) | this project | CC0-1.0 | as above |
| `mh-mask-beard.png` | 24795 | generated facial-hair coverage maps (3-day stubble, heavy stubble, goatee and moustache) on the hm08 UV (same generator) | this project | CC0-1.0 | blurred, 512x512 RGB, 64 levels |
| `mh-mocap.bin.gz` | 335516 | Adobe Mixamo animation library (FBX re-host https://huggingface.co/datasets/Linzhan/Mixamo-Animations-Characters, converted to animation-only GLB in assets_wide): Bouncing_Fight_Idle, Lead_Jab, Punching, Hook_3, Right_Hook, Boxing_7, Hook_4, Body_Jab_Cross_3, Boxing_4, Elbow_Punch, Mma_Kick_5, Mma_Kick_6, Mma_Kick_2, Illegal_Knee, Light/Medium/Big_Hit_To_Head, Head_Hit_2, Head_Hit_3, Receiving_An_Uppercut, Hit_To_Body, Big_Stomach_Hit, Dizzy_Idle, Knocked_Out, Knocked_Out_2, Falling_Back_Death, Falling_Flat_Impact, Dying_7, Stunned, Standing_React_Death_Left/Right, Getting_Up, Double_Leg_Takedown_-_Attacker (0.6-2.4 s), Intercepting, Victory_Idle, Disappointed, Sitting_Idle_3; added Nov 6 pass 3: Kicking_5 (teep), Block, Dodging_2, Dodging_3 (slips), Double_Leg_Takedown_-_Attacker 3.0-6.0 s (ground and pound), Victory_2, Defeat_2 | Adobe (Mixamo) | **Not CC0.** Adobe Mixamo terms: royalty-free use of the animations inside your own projects; standalone redistribution of the raw animation files is not allowed. Used here baked into this page's own compact format for a private build | 44 clips sampled at 20-30 fps, strikes trimmed around contact, world-delta quaternions per bone plus a pelvis offset, delta-coded int16 in byte planes, gzipped (avatar2/tools/bakemocap.js; pass 3: scratchpad av3/tools/bakemocap2.js); contact time and effector per strike |

Total for the avatar files (`mh-*`): 4344507 bytes (about 5.8 MB once base64-encoded in the page; pass 3 on Nov 6 added 54619 bytes of motion clips and nothing else). Arena and audio files have their own rows where those workstreams add them.

## Arena surfaces and environment (`arena-*`, read by src/arena3d.js)

All CC0 1.0. Each one is optional: the procedural stand-in stays when its image is missing or fails to decode.

| File | Bytes | Source | Author | Licence | Changes |
|---|---|---|---|---|---|
| `arena-env-circus.jpg` | 28552 | https://polyhaven.com/a/circus_arena (`circus_arena_1k.hdr`) | Oliksiy Yakovlyev (Poly Haven) | CC0-1.0 | box-filtered to 512x256, log-encoded into 8 bits (value = log2(1 + 16 x) / log2(1 + 8192), radiance clipped at 512), JPEG; decoded in a shader, the source venue's floor and seats dimmed, prefiltered by PMREM for image-based lighting (scratchpad arena2/hdr.py) |
| `arena-fence-opacity.webp` | 24686 | https://ambientcg.com/a/Fence003 (`Fence003_1K-JPG_Opacity.jpg`) | ambientCG (Lennart Demes) | CC0-1.0 | 512 px, WebP; the wire is thickened slightly and its round-wire normal map is derived from it at load time |
| `arena-mat-weave-normal.jpg` | 19296 | https://ambientcg.com/a/Fabric036 (`Fabric036_1K-JPG_NormalGL.jpg`) | ambientCG (Lennart Demes) | CC0-1.0 | a 128 px patch of the full-resolution 1K normal map, JPEG; tiled under the procedural canvas print |
| `arena-mat-slub.webp` | 23238 | https://ambientcg.com/a/Fabric036 (`Fabric036_1K-JPG_Color.jpg`) | ambientCG (Lennart Demes) | CC0-1.0 | the colour map reduced to 256 px greyscale and contrast-normalised (the fabric's slubs), WebP; modulates the print's brightness and roughness slightly |
| `arena-leather-normal.jpg` | 9828 | https://polyhaven.com/a/leather_white (`leather_white_nor_gl_1k.jpg`) | Rob Tuytel (Poly Haven) | CC0-1.0 | 256 px tile, grain amplified x4 (scaled back in the material), JPEG; on the fence pads, post pads and stools |

Arena total: 105600 bytes.

## Arena sound (`audio-*`, read by src/audio.js)

Re-encoded from the project's arena audio pack (scratchpad `assets_wide/audio/`, built by its `tools/audio/build_pack.py`;
each pack item's sources are listed in its `manifest_audio.json`): mono MP3, 64 kbps for effects, 48-56 kbps for crowd beds
and reactions, same lengths as the pack items. **Not all CC0**: three licences in this set carry conditions, and the
credits ship inside the page in the header of src/audio.js.

- **CC BY 4.0, attribution required**: Gregor Quendel, "Crowd Cheering Sounds", https://opengameart.org/content/free-crowd-cheering-sounds
  (gregorquendel.com). Credit: "Crowd sounds: Gregor Quendel, CC BY 4.0", in the src/audio.js header.
- **BBC RemArc licence, personal, educational or research use only, no commercial use** (copyright BBC):
  BBC Sound Effects archive items 07075056 (bell), 07052085 and 07047063 (boos), 07052086 and 07013092 (crowd pops),
  https://sound-effects.bbcrewind.co.uk. Fine for this private build; replace these three files before any commercial use.
- **CC BY-NC-SA 4.0** (non-commercial, share-alike, attribution): the referee's "stop", synthesised with the Piper TTS
  voice `en_US-ryan-high` (https://huggingface.co/rhasspy/piper-voices), which inherits the RyanSpeech corpus licence.
- Sonniss #GameAudioGDC bundle licence (royalty-free, commercial use allowed, no attribution required, no redistribution
  of the raw library files): 2015-2026 bundles, mirrored at https://archive.org/details/sonniss-gdc-20XX-game-audio-bundle-normalized
  (https://sonniss.com/gameaudiogdc).
- CC0 1.0: Kenney voiceover packs (https://opengameart.org/content/voiceover-pack-fighter-40-taunts, .../voiceover-pack-40-lines),
  rubberduck (https://opengameart.org/content/100-cc0-metal-and-wood-sfx), Iwan Gabovitch / qubodup
  (https://opengameart.org/content/40-wet-towel-clubpoundhitattack-sounds, .../12-...), independent.nu via qubodup
  (https://opengameart.org/content/37-hitspunches).

| File | Bytes | Pack item | Sources (author, licence) |
|---|---|---|---|
| `audio-crowd-bed.mp3` | 140478 | crowd_arena_loop | Gregor Quendel "10 - Ambience", **CC BY 4.0**; seamless 20.0 s loop |
| `audio-crowd-chant.mp3` | 45523 | crowd_chant_swell | Gregor Quendel, **CC BY 4.0** |
| `audio-crowd-roar.mp3` | 40037 | crowd_roar_rise | Gregor Quendel, **CC BY 4.0** |
| `audio-crowd-pop.mp3` | 39410 | crowd_pop_knockdown | **BBC RemArc** (07052086, 07013092) + 2496SoundEffects "Surround At The Show" (Sonniss 2019) |
| `audio-crowd-boo.mp3` | 36432 | crowd_boo_whistle | **BBC RemArc** (07047063, 07052085) + Sonic Bat "Soccer Stadium Ambience" (Sonniss 2020) |
| `audio-crowd-ooh.mp3` | 24521 | crowd_ooh | Sonic Bat "Soccer Stadium Ambience" (Sonniss 2020) |
| `audio-bell-x3.mp3` | 14463 | bell_x3 | **BBC RemArc** (07075056) |
| `audio-bell-ring.mp3` | 18852 | bell_ring | **BBC RemArc** (07075056) |
| `audio-clapper.mp3` | 6313 | clapper_10s | rubberduck, CC0 |
| `audio-ref-fight.mp3` | 6731 | ref_fight | Kenney, CC0 |
| `audio-ref-go.mp3` | 6104 | ref_go | Kenney, CC0 |
| `audio-ref-stop.mp3` | 4432 | ref_stop | Piper TTS en_US ryan, **CC BY-NC-SA 4.0** |
| `audio-punch-head-1.mp3` | 4223 | punch_head_1 | Gamemaster Audio "Punch Sound Pack" (Sonniss 2017) + The Chris Alan "Hand-to-Hand Combat" (Sonniss 2018) |
| `audio-punch-head-2.mp3` | 3805 | punch_head_2 | Shapeforms "Hit & Punch" (Sonniss 2020) + qubodup, CC0 |
| `audio-punch-head-3.mp3` | 3387 | punch_head_3 | The Chris Alan (Sonniss 2018) + qubodup, CC0 |
| `audio-punch-head-heavy.mp3` | 5268 | punch_head_heavy | Gamemaster Audio (Sonniss 2017) + PMSFX "Lethal Blow" (Sonniss 2020) |
| `audio-punch-body-1.mp3` | 4223 | punch_body_1 | Gamemaster Audio (Sonniss 2017) + qubodup, CC0 |
| `audio-punch-body-2.mp3` | 4641 | punch_body_2 | 344 Audio "Cinematic Fight Vol. 1" (Sonniss 2026) |
| `audio-punch-body-3.mp3` | 4641 | punch_body_3 | 344 Audio "Cinematic Fight Vol. 1" (Sonniss 2026) |
| `audio-kick-body-1.mp3` | 3387 | kick_body_1 | Borg Sound "Gym weights" (Sonniss 2017) + Shapeforms (Sonniss 2020), CC0 layer |
| `audio-kick-body-2.mp3` | 4641 | kick_body_2 | independent.nu via qubodup, CC0 + Gamemaster Audio (Sonniss 2017) |
| `audio-kick-leg-1.mp3` | 4641 | kick_leg_1 | qubodup, CC0 + The Chris Alan (Sonniss 2018) |
| `audio-kick-leg-2.mp3` | 5059 | kick_leg_2 | qubodup, CC0 + PMSFX "Lethal Blow" (Sonniss 2020) + The Chris Alan (Sonniss 2018) |
| `audio-blocked.mp3` | 4014 | strike_blocked | Gamemaster Audio (Sonniss 2017) |
| `audio-whoosh-punch-1.mp3` | 4223 | whoosh_punch_1 | Airborne Sound "Organic Whooshes" (Sonniss 2019) |
| `audio-whoosh-punch-2.mp3` | 5059 | whoosh_punch_2 | SoundBits "Just Whoosh 3" (Sonniss 2016) |
| `audio-whoosh-punch-3.mp3` | 5268 | whoosh_punch_3 | Soundholder "Swipes And Whooshes" (Sonniss 2019) |
| `audio-whoosh-kick.mp3` | 4641 | whoosh_kick | Mechanical Wave "Hits Whoosh" (Sonniss 2015) |
| `audio-takedown-1.mp3` | 7776 | takedown_thud_1 | The Chris Alan (Sonniss 2018) + qubodup, CC0 |
| `audio-takedown-2.mp3` | 8612 | takedown_thud_2 | Red Libraries "Bodyfall" (Sonniss 2019) + qubodup, CC0 + Shapeforms (Sonniss 2020) |
| `audio-cage-rattle.mp3` | 15717 | cage_rattle | Robert Cordova "Base" (Sonniss 2015) |
| `audio-cage-slam.mp3` | 13418 | cage_slam | Borg Sound "Gym weights" (Sonniss 2017) + Robert Cordova (Sonniss 2015) |
| `audio-walkout-boom.mp3` | 34107 | walkout_boom | 344 Audio "Low Frequency Elements" + Federico Soler Fernandez (Sonniss 2019) |

Sound total: 534047 bytes (about 0.71 MB once base64-encoded in the page).
