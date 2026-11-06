# 3D assets for the v3 fight scene: what to use, licences, sizes, exact URLs

Researched Friday, Nov 6, 2026. Everything below was downloaded and checked on this machine unless it is
marked "not downloaded". Candidates, previews, tools and `manifest.json` (file, source URL, licence,
licence-text location, bytes, sha256) live in
`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/assets_candidates/`.

How things were checked:

- GLB/glTF files: the JSON chunk was parsed with `tools/glbinfo.js` (meshes, vertices, triangles, skins,
  bone names, clips, extensions).
- Rendering: files were loaded in headless Chrome (SwiftShader) with the real three.js r128 loaders,
  `GLTFLoader` plus `MeshoptDecoder`. The newer three r186 was also tried for one case.
- Retargeting: measured on the CPU with `tools/skin_check.js`, which reports how far mesh edges stretch
  compared with the bind pose.

**Reachability.** From here only `raw.githubusercontent.com`, `github.com` over git, the npm registry and
PyPI could be reached. Poly Haven, ambientCG, quaternius.com, itch.io, cdnjs, jsDelivr, unpkg and
mocap.cs.cmu.edu could not, from either Bash or WebFetch. The session's web-search budget ran out partway
through, so some claims below rest on the searches already made. Each claim carries a confidence label.

## 1. Recommendation (short version)

1. **Fighters: generated MakeHuman bodies (CC0), rigged with MPFB2's `game_engine` skeleton.** These are
   realistic-ish male bodies.
   - The bones use Unreal-style names (`pelvis, spine_01..03, clavicle_l, upperarm_l, lowerarm_l, hand_l,
     thigh_l, calf_l, foot_l, ball_l ...`).
   - Each body has three material slots that recolour at runtime: `skin` (CC0 MakeHuman skin texture),
     `shorts` and `glove`.
   - Two builds were generated: short and stocky (1.61 m), and tall (1.89 m).
   - Each is 1.2 MB, or **280 KB after gltfpack**. Both verified in r128.
   - Body shape is set per fighter at build time (MakeHuman sliders for height, muscle, weight, age and
     proportions). That suits an engine meant to take any two fighters.
2. **Animation: 40 CC0 fight clips merged into one skeleton-only GLB (`ual_fight_clips.glb`).**
   - Size: 792 KB with no extensions, or 648 KB with gltfpack.
   - Source: the Quaternius Universal Animation Library and Mesh2Motion clips.
   - Clips include: guard idle, jab, cross, hook and its recovery, front, side and roundhouse kicks, head
     and chest hits, knockback, four deaths/falls, dizzy, hurt idle, tired, lay-to-idle (getting up),
     dodges, strafes, walking backwards, crawl, roll, victory and fist pump.
   - They play on the MakeHuman fighter through a ~90-line runtime retargeter (`tools/retarget.js`) that
     matches bones by name. It was checked visually and on the CPU (largest edge stretch 1–2 cm). Your
     own IK runs after the retargeter on every frame.
3. **Image-based lighting: no file at all.** Use three's `RoomEnvironment`, or better, a small arena
   environment scene: a dark box, a ring of overhead light panels and warm rim strips, fed through
   `PMREMGenerator.fromScene`. The code is in `assets_candidates/tools/env128.html`.
   - Optional CC0 file: `@pmndrs/assets` `studio.exr` (110 KB) or `warehouse.exr` (160 KB). Both decode
     with r128's `EXRLoader` plus fflate.
4. **Textures: keep the canvas mat, chain-link fence and padding procedural.**
   - I found no reachable, verifiably CC0 PBR set for canvas, chain-link or vinyl padding.
   - For skin, use the CC0 MakeHuman skin textures (1k WebP, 28–45 KB each; 30 variants by age,
     ethnicity and sex).
5. **three.js: upgrade to `three@0.186.1` (r186), shipped as one inlined esbuild bundle.** It is 856 KB
   minified (229 KB gzip) and includes GLTFLoader, MeshoptDecoder, RoomEnvironment, EXR and HDR loaders,
   EffectComposer, RenderPass, UnrealBloomPass, OutputPass and SkeletonUtils.
   - Verified: it loads and renders the retargeted fighter in Chrome.
   - The fallback is an import map pointing at jsDelivr; the URLs are in section 6.
   - Staying on r128 is possible: every asset above was verified there too. But r128 is from April 2021
     and lacks CapsuleGeometry, `OutputPass`, AgX/Neutral tone mapping and KTX2 PMREM.

Embedding budget, if everything is inlined as base64 (+33%):

| Item | Size inlined |
|---|---|
| Two gltfpack fighters | 0.76 MB |
| Clip pack | 0.88–1.08 MB |
| Optional EXR | 0.15–0.21 MB |
| r186 bundle | 0.86 MB as plain text |
| **Total** | **under 3 MB of the 16 MB page cap** |

## 2. Characters

### 2a. Candidates (all parsed; triangles are after triangulation)

| Candidate | Licence (where the text is) | Size | Verts / tris | Skeleton | Verdict |
|---|---|---|---|---|---|
| **MakeHuman male, MPFB2 `game_engine` rig, `--fighter` kit** (`characters/mpfb_generated/mh_fighter_*.glb`) | Inputs CC0: MPFB2 `LICENSE.md` §C "These assets have been released under CC0 1.0 Universal"; §D on output: "no limitation on what you can do with this combined output" ([MPFB2 LICENSE.md](https://raw.githubusercontent.com/makehumancommunity/mpfb2/6ff1eb358f6c1959ced77e79e6dd2406d9a71f49/LICENSE.md)). Skin texture CC0 ([humanforge LICENSE.ASSETS.md](https://raw.githubusercontent.com/abdulrehman043/humanforge/2226df1f50a04c5a8e1c02ea33780d28337dfbb1/LICENSE.ASSETS.md)). MPFB2 code is GPL-3.0 but only runs as a build tool and is not shipped. High confidence. | 1.20 MB each; 280 KB gltfpack | 18,212 / 33,080 (body 13,380 verts + glove shells) | 53 bones, Unreal-style (list below) | **Use** |
| Same body without the kit (`mh_male_ge.glb`) | as above | 0.97 MB | 14,517 / 26,756 | 53 | Base for other kits |
| **Quaternius UAL mannequin**, as shipped by Mesh2Motion (`characters/mesh2motion/model.glb`) | CC0: "The art assets (3d models, rigs, animations) are all licensed under CC0" ([Mesh2Motion README](https://raw.githubusercontent.com/scottpetrovic/mesh2motion-app/4f1316296660f2b9827ff46b4db10fb241ec2147/README.md), [LICENSE-CC0.MD](https://raw.githubusercontent.com/scottpetrovic/mesh2motion-app/4f1316296660f2b9827ff46b4db10fb241ec2147/LICENSE-CC0.MD)). The same mannequin is in Mesh2Motion's `Quaternius-human-packs.blend`, whose `License.txt` says CC0. High confidence. | 519 KB (one 499×500 palette PNG) | 7,399 / 13,757 | 66 bones, Unreal-style plus `_leaf` and `_04_leaf` bones | **Fallback and stylized option.** A wooden-mannequin look with no face; it is the native skeleton of the clips. |
| `skeleton.glb` (Mesh2Motion) | CC0 (as above) | 18 KB | none | 66 | Use as the retarget source |
| Mesh2Motion `mannequin-female.glb` | CC0 (as above) | 1.32 MB | 24,037 / 14,244 | 66 | Not needed |
| Mesh2Motion PSX characters (`psx-05/06/10/15/32.glb`) | CC0: "Characters PSX, Elbolilloduro … CC0" ([source.txt](https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-assets/935cfb82d14223d7631d04ba2bb14e2feb8ca517/CC0-packs/psx-lowpoly/source.txt)). Medium confidence (second-hand). | 322–382 KB | ~750 / ~900 | 66 | Too low-poly |
| Quaternius Modular Character Outfits, Fantasy (`Male_Peasant.gltf`, `Male_Ranger.gltf` + .bin + PNGs) | CC0 ([License_Standard.txt](https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-assets/935cfb82d14223d7631d04ba2bb14e2feb8ca517/CC0-packs/Quaternius/Modular%20Character%20Outfits%20-%20Fantasy%5BStandard%5D/License_Standard.txt)). High confidence. | 0.7–1.7 MB .bin + 1–14 MB PNGs | 8,855 / 12,894 and 24,873 / 26,982 | 65 bones (same as the mannequin, but `Head` is capitalised and there is no `head_leaf`) | No head: the Readme says "only the head of the model is required" from Universal Base Characters. Clothing doesn't fit MMA. |
| **Quaternius Universal Base Characters**: six base bodies with a humanoid rig, made to pair with the animation library | CC0 per [quaternius.com](https://quaternius.com/packs/universalbasecharacters.html) and [itch.io](https://quaternius.itch.io/universal-base-characters) (search results; medium confidence) | Standard zip 122 MB (itch.io) | unknown | Likely the same Unreal-style rig: the outfits above share it | **Not downloaded** (host unreachable). The best stylized-realistic CC0 option if someone fetches it by hand. |
| humanforge MakeHuman runtime (`body.glb` + `shapes.bin` + `manifest.json`) | Assets CC0, code MIT ([LICENSE.ASSETS.md](https://raw.githubusercontent.com/abdulrehman043/humanforge/2226df1f50a04c5a8e1c02ea33780d28337dfbb1/LICENSE.ASSETS.md)) | 513 KB body (298 KB gz) + 3.6 MB shapes (1.1 MB gz) | 14,517 / 26,756 | 52 bones, Mixamo names (MPFB2 `mixamo` rig) | Custom quantized format with sliders applied at runtime. v0.8.1 is from Oct 21, 2026 and has a single author. Possible later for in-browser body sliders, but too heavy and too new for now. |
| three.js `Xbot.glb` | **Mixamo, not CC0.** The example page credits "model from mixamo.com" ([webgl_animation_skinning_additive_blending.html](https://raw.githubusercontent.com/mrdoob/three.js/84fde13820dbccbb1f6688f44a20c59c9c740dc9/examples/webgl_animation_skinning_additive_blending.html)). Adobe's FAQ: you can't "distribute the raw character and animation files", while use inside a project is allowed ([Adobe community FAQ, 2022](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775); not the current terms page; medium confidence). A GLB shipped next to a public page can be downloaded as a raw file, which is a grey area. | 2.86 MB | 28,374 / 49,112 | 67 bones, `mixamorig:*` | Avoid |
| three.js `Soldier.glb` | Mixamo (same page credit, [webgl_animation_skinning_blending.html](https://raw.githubusercontent.com/mrdoob/three.js/84fde13820dbccbb1f6688f44a20c59c9c740dc9/examples/webgl_animation_skinning_blending.html)) | 2.11 MB | 7,434 / 11,376 | 49 bones, `mixamorig:*`; mesh in centimetres (Y −22..22) | Avoid |
| three.js `Michelle.glb` | Mixamo assumed: no licence file, but the material is named `Ch03_Body` and the bones are `mixamorig:*`. Low–medium confidence. | 3.20 MB | 16,340 / 28,106 | 65 | Avoid; female |
| three.js "Ybot" | **not in the three.js repo** (only `Xbot.glb` and `Xbot.blend` at commit 84fde13) | | | | |
| three.js `readyplayer.me.glb` | unknown (Ready Player Me avatar; no licence file) | 1.80 MB | 9,596 / 15,817 | 67 bones (Mixamo names, no prefix) | Avoid |
| three.js `kira.glb` | unclear: "Character model by Aki" (Unity Asset Store) "… CC0." ([webgl_animation_skinning_ik.html](https://raw.githubusercontent.com/mrdoob/three.js/84fde13820dbccbb1f6688f44a20c59c9c740dc9/examples/webgl_animation_skinning_ik.html)) | 0.96 MB | 55,486 / 51,601 (whole room) | 23 (upper body only); needs Draco and WebP | Avoid |
| three.js `RobotExpressive.glb` | CC0, "Model by Tomás Laulhé … CC0 1.0" ([README](https://raw.githubusercontent.com/mrdoob/three.js/84fde13820dbccbb1f6688f44a20c59c9c740dc9/examples/models/gltf/RobotExpressive/README.md)) | 453 KB | 7,214 / 3,237 | 43, Blender-style (`UpperArm.L` …) | A robot, not a fighter |
| Khronos `CesiumMan.glb` / `RiggedFigure.glb` | CC-BY-4.0, plus the Cesium trademark for CesiumMan ([LICENSE.md](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/LICENSE.md)) | 428 KB / 49 KB | 3,273 / 4,672; 370 / 256 | 19, non-standard | Rejected |
| Kenney / KayKit characters | CC0 by reputation; not checked here | | | | Blocky or chibi; not realistic |

### 2b. Bone lists

**MPFB2 `game_engine` (53 bones; the recommended fighter).**
`Root, pelvis, spine_01, spine_02, spine_03, clavicle_l, upperarm_l, lowerarm_l, hand_l, index_01..03_l,
middle_01..03_l, pinky_01..03_l, ring_01..03_l, thumb_01..03_l, clavicle_r, upperarm_r, lowerarm_r,
hand_r, (same fingers)_r, neck_01, head, thigh_l, calf_l, foot_l, ball_l, thigh_r, calf_r, foot_r, ball_r`.
The definition is
[rig.game_engine.json](https://raw.githubusercontent.com/makehumancommunity/mpfb2/6ff1eb358f6c1959ced77e79e6dd2406d9a71f49/src/mpfb/data/rigs/standard/rig.game_engine.json).

**Quaternius UAL / Mesh2Motion (66 bones; the clips' skeleton).** The same names, with these differences:

- lower-case `root`;
- extra leaf bones: `head_leaf`, `index_04_leaf_l` and the other `*_04_leaf_*`, and `ball_leaf_l/r`.

So every bone of the MakeHuman fighter has a same-named partner in the clips; only `root`/`Root` differ
in case. The retargeter ignores both and drives `pelvis` translation.

**Mixamo (`Xbot` 67, `Michelle` 65, `readyplayer.me` 67).** The names are:

- trunk: `Hips, Spine, Spine1, Spine2, Neck, Head, HeadTop_End`;
- arms: `LeftShoulder, LeftArm, LeftForeArm, LeftHand`, then `LeftHandThumb1..4`, `LeftHandIndex1..4`,
  `LeftHandMiddle1..4`, `LeftHandRing1..4`, `LeftHandPinky1..4`, mirrored for `Right*`;
- legs: `LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, LeftToe_End`, mirrored for `Right*`.

Xbot and readyplayer.me also have `LeftEye/RightEye`. Xbot and Michelle prefix every name with
`mixamorig:`.

### 2c. How the recommended fighters were made (reproducible, about 10 s per body)

```sh
S=/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad
uv venv --python /usr/bin/python3.13 $S/bpyenv && uv pip install --python $S/bpyenv/bin/python bpy==5.1.2   # Blender 5.1 as a module, 391 MB wheel from PyPI
git clone --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/mpfb2 && (cd mpfb2 && git sparse-checkout set src/mpfb)   # 80 MB
(cd mpfb2/src && python3 -m zipfile -c $S/mpfb_ext.zip mpfb/)
BLENDER_USER_RESOURCES=$S/blender_user $S/bpyenv/bin/python -I tools/mpfb_fighter.py $S/mpfb_ext.zip out.glb \
   --skin middleage_caucasian_male_1k.webp --fighter --muscle 0.85 --weight 0.55 --height 0.62 --age 0.6
npx gltfpack@0.25.0 -i out.glb -o out.gltfpack.glb -cc -kn -km      # 1.2 MB -> 280 KB; r128 decodes it
```

What `tools/mpfb_fighter.py` does, step by step:

1. Installs MPFB2 as a Blender extension, kept inside the scratchpad.
2. Calls `HumanService.create_human(macro_detail_dict=…)`, then `HumanService.add_builtin_rig(…, "game_engine")`.
3. Bakes the shape keys and applies the helper mask.
4. Assigns the skin texture.
5. With `--fighter`, adds a `shorts` material on hip and thigh faces, between 36% and 57.5% of body height,
   leaving out the arms.
6. Also with `--fighter`, adds `glove` shells: hand faces duplicated, pushed out 12 mm along the normals,
   keeping their skin weights.

`detailed_helpers` and `extra_vertex_groups` must stay True: the rig is fitted to the `joint-*` helper
groups. With them off, the bones came out 0.9 m too low and the skinning tore apart (first attempt, fixed).

Settings used:

| Build | Height | Settings |
|---|---|---|
| Short and stocky | 1.61 m | muscle 0.95, weight 0.6, height 0.3, age 0.6 |
| Tall | 1.89 m | muscle 0.85, weight 0.55, height 0.62, age 0.6 |

MakeHuman's age slider puts 25 years at 0.5 and 90 at 1.0, so 0.6 is about 38. That mapping comes from my
memory of MakeHuman, not something checked here; low confidence.

Known rough edges:

- The shorts border is face-stepped; a UV-based or smoothed selection would fix it.
- The gloves look like mittens.
- There is no hair or eyebrows: the MakeHuman system asset pack is hosted on files2.makehumancommunity.org,
  which wasn't tried. humanforge mirrors CC0 hair, but in its own custom format.
- The skin texture is light. Tint it with `material.color`, or swap in another of the 30 CC0 skin
  variants (`{young,middleage,old}_{african,asian,caucasian}_{male,female}[2]_{1k,2k}.webp` at
  `https://raw.githubusercontent.com/abdulrehman043/humanforge/2226df1f50a04c5a8e1c02ea33780d28337dfbb1/assets/human/skins/`).

Previews are in `assets_candidates/previews/`:

- `makehuman_fighters_kit_r128.png`: both builds, T-pose reference, guard, cross, roundhouse;
- `makehuman_retargeted_clips_r128.png`;
- `makehuman_r186_bundle.png`;
- `ual_mannequin_clips_r128.png`.

## 3. Animation clips

**Source.** The clips come from the Mesh2Motion app repo: `static/assets/human/animations/*.glb`, CC0,
listed in `static/assets/manifest.json` (generated Oct 31, 2026, 24 fps). Clips tagged `quaternius` are
from the Quaternius Universal Animation Library. Quaternius lists that library as CC0 with OBJ, FBX and
glTF downloads ([quaternius.com](https://quaternius.com/packs/universalanimationlibrary.html); a second
library, UAL2, came out in January 2026, [UAL2](https://quaternius.com/packs/universalanimationlibrary2.html);
both from search results, medium confidence). The other clips were made by Mesh2Motion.

**Format.** Each source file is a skeleton-only GLB (about 60 KB) with one clip of 198 channels
(translation, rotation and scale on 66 bones). Each requires `EXT_meshopt_compression`. r128's
`examples/js/libs/meshopt_decoder.js` (meshoptimizer 0.14) decoded every clip in Chrome.

**Merged pack.** `animations/ual_fight_clips.glb` holds 40 clips on one skeleton.

- Scale tracks were dropped; translation is kept for `root` and `pelvis` only; keys were resampled.
- It needs no extensions. 792 KB plain, 648 KB with gltfpack, 715 KB with glTF-Transform meshopt.
- The merge keeps plain bone names. Duplicate skeletons would be renamed `pelvis_1` and so on by
  GLTFLoader and would break the tracks.
- CPU check: retargeting from the merged pack gives the same pose as from the single-clip files.

| Group | Clips (seconds) |
|---|---|
| Stance and movement | Fighting Idle 1.63, Idle_A 3.08, Idle_ShakeOff 2.46, Strafe_left/right 0.96, Walk_Backwards 0.96, Walk 1.63, Dodge_back 1.0, Dodge_left/right 0.83, Defend 0.92, Crouch_Idle 3.63, Roll 1.83, Crawl 1.67 |
| Strikes | Punch_Jab 1.04 (Q), Punch_Cross 1.21 (Q), Fighting Left Jab 0.88, Fighting Right Jab 0.83, Melee_Hook 0.46 (Q), Melee_Hook_Rec 0.58 (Q), Kick Front 1.33, Kick Side 1.33, Kick Roundhouse 1.33 |
| Reactions | Hit_Head 0.5 (Q), Hit_Chest 0.38 (Q), Hit_Knockback 0.79 (Q), Dizzy 2.38, Idle Hurt 1.63, Tired Hunched 0.96, Kneeling Tired 0.75 |
| Down and finish | Death_A 4.5, Death_B 1.88, Death_C 2.21, Death_D 2.17 (Q), LayToIdle 1.54 (Q; getting up), Sit_Ground_Idle 2.96, Sitting_Idle 2.04 (Q) |
| After the fight | Victory 1.63, Victory Fist Pump 2.21, Rest Pose 0.33 |

(Q) = tagged `quaternius` in the Mesh2Motion manifest.

**Missing, so they stay procedural and IK-driven as in v2:** uppercut, elbow, knee, calf kick (use Kick
Side or Roundhouse low), double-leg and single-leg takedowns, sprawl, clinch, cage work, top and bottom
ground positions, ground-and-pound, submissions and referee motions.

**Retargeting** (`tools/retarget.js`, own code, works on r128 and r186):

1. Builds a reference pose by rotating each target bone so its direction to its main child matches the
   source rest pose. This turns MakeHuman's A-pose into the clips' T-pose.
2. On each frame computes `Qt_world = Qs_world · inv(Qs_rest_world) · Qt_ref_world`, converted to local.
3. Moves the pelvis by the source pelvis displacement times the ratio of pelvis heights.

Results:

| Check | Largest edge stretch |
|---|---|
| Ordinary joint skinning on the fixed MakeHuman body (Blender, upper arm rotated 46°) | 1.3 cm |
| Retargeted poses: Punch_Jab, Punch_Cross, Kick Roundhouse, Fighting Idle, Death_B (sampled at 45% of the clip) | 1.0–5.6 cm |

To layer your own IK, call `rt.update()`, then run the foot-lock and glove-target IK on the target bones.

**Other sources:**

| Source | Status |
|---|---|
| CMU Graphics Lab mocap boxing | Trials 13_17, 13_18 and 14_01–14_03 are labelled boxing in a Hugging Face mirror's metadata ([gbionics/cmu-fbx metadata.csv](https://huggingface.co/datasets/gbionics/cmu-fbx/blob/main/metadata.csv)). Licence: only a secondary page says "free for all uses"; mocap.cs.cmu.edu was unreachable. Not downloaded; would need a BVH-to-Unreal-skeleton mapping. Low confidence on licence. |
| Mixamo | Has many MMA clips, but redistributing raw files is restricted. Not used. |
| Mesh2Motion raw mocap BVH | Cheering, kick-breach, salute and others, in [mesh2motion-assets](https://github.com/Mesh2Motion/mesh2motion-assets) `motion-capture/raw captures/`. None are fight-relevant except kick-breach. |

## 4. Image-based lighting

| Option | Licence | Bytes | r128 status | Notes |
|---|---|---|---|---|
| `RoomEnvironment` (`examples/js/environments/RoomEnvironment.js`, 3,425 B in three@0.128.0) | MIT (three.js) | 0 asset bytes | Renders | Neutral and bright; good default |
| **Arena environment scene** (code in `assets_candidates/tools/env128.html`, `arenaScene()`) | own | 0 | Renders (`ibl_comparison_r128.png`, panel 2) | Moody top light, as in a real octagon. Needs an exposure tweak. **Recommended.** |
| `@pmndrs/assets@1.7.0` `hdri/studio.exr` / `warehouse.exr` / `hall.exr` (base64 JS modules, decoded here) | CC0-1.0: package `LICENSE`; README says "A selection of Polyhaven HDRIs, resized to 512x512 and converted to EXR with DWAB compression" | 110,735 / 160,000 / 191,590 B (512×256, DWAB) | Decodes with `EXRLoader` + `fflate.min.js` (both in three@0.128.0 `examples/js`) | Ready-made data URIs: `https://registry.npmjs.org/@pmndrs/assets/-/assets-1.7.0.tgz` → `package/hdri/studio.exr.js` |
| three.js repo `examples/textures/equirectangular/ferndale_studio_04_1k.hdr`, `monochrome_studio_02_1k.hdr` (also `venice_sunset_1k.hdr`, `moonless_golf_1k.hdr`) | Poly Haven originals, CC0 ([polyhaven.com/license](https://polyhaven.com/license)). The folder has no licence file. A sibling README credits `venice_sunset` to Poly Haven CC0 ([hdr-native/README.md](https://raw.githubusercontent.com/mrdoob/three.js/84fde13820dbccbb1f6688f44a20c59c9c740dc9/examples/textures/hdr-native/README.md)). Medium confidence for the two studio files. | 1.40–1.67 MB each | ferndale decoded (1024×512); colour artifacts in the 8-bit RGBE test path; monochrome inconclusive in software GL | Too big to inline |
| three.js repo `examples/textures/pmrem/studio_small_09_2k.pmrem.ktx2` (also `brown_photostudio_02`, `ballroom`) | CC0: "All source HDRIs are CC0, provided by Poly Haven" ([pmrem/README.md](https://raw.githubusercontent.com/mrdoob/three.js/84fde13820dbccbb1f6688f44a20c59c9c740dc9/examples/textures/pmrem/README.md)) | 1.64 / 1.77 / 1.83 MB | r18x only | Needs `KTX2Loader` and the Basis transcoder WASM worker (`examples/jsm/libs/basis/`). Risky under artifact CSP. Not downloaded. |

## 5. PBR textures (canvas mat, chain-link, padding, skin)

- **No verified CC0 set was reachable.** ambientCG and Poly Haven (the usual CC0 sources) are blocked
  from here. The three.js repo has only unrelated textures (`ambientcg/Ice00*`, `hardwood2_*`, `brick_*`).
  The `@pmndrs/assets` normals come from `emmelleppi/normal-maps`, which has **no licence file** (checked
  at commit faef0c8). Treat their licence as unknown and don't use them.
- **Recommended: procedural textures**, which the page already uses.
  - Canvas mat: a canvas-generated weave normal map and roughness noise, logo decals, and sweat/scuff
    decals that build up by round.
  - Chain-link fence: an alpha-tested diamond lattice drawn into a 512² canvas with mipmaps, on black
    vinyl-coated metal. For close shots, add an `InstancedMesh` wire grid.
  - Padding: `MeshPhysicalMaterial` with clearcoat 0.6 and noise roughness.
- **Skin:** CC0 MakeHuman diffuse textures (above) plus a small procedural pore normal map.
- **Optional:** if Poly Haven or ambientCG becomes reachable (allow `dl.polyhaven.org` and `ambientcg.com`),
  search for "fabric", "canvas", "leather" and "chainlink" there. No asset IDs were verified here, so none
  are listed.

## 6. three.js version: r128 vs r186

Versions and dates, from the npm registry:

| Version | Published | Use? |
|---|---|---|
| `0.128.0` | Apr 23, 2021 | Current page |
| `0.186.1` | Sep 24, 2026 | **Recommended** |
| `0.187.0` | Oct 30, 2026 | **Too new** (under two weeks old) |

cdnjs lists three.js up to 0.185.0, with `three.module.js` and `three.webgpu.js`
([cdnjs](https://cdnjs.com/libraries/three.js); search result, medium confidence). Whether cdnjs carries
`examples/jsm` addons is unknown, so use jsDelivr or a bundle for the addons.

| | r128 (stay) | r186 (upgrade) |
|---|---|---|
| Core | `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`, used by `src/page.src.html` today; identical to npm's `build/three.min.js` (603,445 B, 149 KB gzip; `vendor/three.min.js` is byte-identical) | Import map: `"three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js"` (663 KB), which imports `./three.core.js` (1.46 MB) from the same folder. **No minified builds in the 0.186.1 npm package** (`three.module.min.js` is absent). Or inline the esbuild bundle: 876,340 B minified, 228,788 B gzip |
| Addons, all confirmed in the npm tarballs | `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/` + `loaders/GLTFLoader.js` (96.6 KB), `libs/meshopt_decoder.js` (21.8 KB), `environments/RoomEnvironment.js` (3.4 KB), `loaders/EXRLoader.js` + `libs/fflate.min.js` (30 KB), `loaders/RGBELoader.js`, `utils/SkeletonUtils.js`, `postprocessing/{EffectComposer,RenderPass,ShaderPass,UnrealBloomPass,SAOPass,SSAOPass,SMAAPass,OutlinePass,BokehPass}.js`, `shaders/{CopyShader,LuminosityHighPassShader,FXAAShader,VignetteShader}.js`, `animation/CCDIKSolver.js`, `geometries/RoundedBoxGeometry.js`. **No `KTX2Loader` in `examples/js`.** | `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"` + `loaders/GLTFLoader.js` (imports `../utils/BufferGeometryUtils.js`, `../utils/SkeletonUtils.js`), `libs/meshopt_decoder.module.js`, `environments/RoomEnvironment.js`, `loaders/HDRLoader.js` (`RGBELoader.js` is now a 268-byte deprecation shim, "@deprecated, r180"), `loaders/EXRLoader.js` (imports `../libs/fflate.module.js`), `loaders/KTX2Loader.js`, `postprocessing/{EffectComposer,RenderPass,UnrealBloomPass,OutputPass,GTAOPass,SMAAPass,ShaderPass}.js`, `animation/CCDIKSolver.js`, `geometries/RoundedBoxGeometry.js` |
| Verified here | All assets load and animate (meshopt clips, gltfpack fighters, EXR) | Bundle loads the gltfpack/plain fighter and the retargeted clips (`previews/makehuman_r186_bundle.png`) |
| Pros | Zero migration; UMD globals | CapsuleGeometry, OutputPass, AgX/Neutral tone mapping, better shadows and colour management, maintained loaders |
| Cons | 5½ years old; `examples/js` was removed upstream in r148, so no fixes | Port work: `outputEncoding`/`sRGBEncoding` become `outputColorSpace`/`SRGBColorSpace`; physically based light units (legacy lights removed) mean re-tuning every light intensity; RGBELoader becomes HDRLoader; scripts must be modules or bundled |

**Recommendation: r186 as one inlined IIFE bundle.**

- Build: `npm i three@0.186.1 esbuild@0.25.10`, then
  `esbuild entry.js --bundle --minify --format=iife`. The entry file is `assets_candidates/tools/entry.js`; it
  sets `window.THREE` to core plus addons, so the existing UMD-style code needs few edits beyond the API
  renames.
- Why a bundle: it avoids two open questions about the artifact host, namely whether inline import maps
  are allowed and how the CSP treats chained module imports. Neither was verified; a quick test artifact
  would settle both.
- Fallback: the import map to jsDelivr with the URLs above.

## 7. Open risks

- **Supporting files vs inlining.** GLB as an artifact supporting file needs `model/gltf-binary`, which may
  or may not count as a "standard web media type"; untested. Base64 inlining plus `GLTFLoader.parse`
  always works and fits the budget.
- **MakeHuman look.** The MakeHuman fighters are anatomically plain: no hair, and mitten gloves. They are
  far more realistic than v2's capsule rig, but still not game-quality. Quaternius Universal Base
  Characters (CC0, not reachable here) would look better, and its rig appears to match the clips.
- **Retarget limits.** The retargeter doesn't correct twist or roll differences. Wrists may twist slightly
  under the gloves.
- **Asset sources.** Mesh2Motion records the PSX characters as CC0 second-hand, and humanforge is a new
  single-author project. Neither is used in the recommended set except humanforge's CC0 MakeHuman skin
  JPEG/WebP, whose upstream (the MakeHuman system assets) is CC0 per MakeHuman's 2020 licence change
  ([MakeHuman FAQ](https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html)).
