# Asset provenance and visual decisions

- `public/assets/facade.png`: generated with the built-in image generation tool for Sumo World. Prompt: seamless orthographic dark graphite cyberpunk tower facade, realistic office windows, cyan/magenta and warm illuminated rooms, weathered panels; no sky, ground, perspective or text. Used as the runtime building texture.
- `public/assets/concept.png`: generated in the architecture task; visual reference only, not rendered as the game world.
- Car, characters, roads, buildings and props: original procedural Three.js geometry authored for this prototype. This is an intentional 3D prototype departure from the image-based asset workflow; flat sprites cannot substitute for the requested explorable geometry.
- Road microtexture, signs and light pools: original procedural textures. Sign names are fictional. No licensed car logos or third-party model assets are used.
- Engine audio: generated locally by Web Audio oscillators; no sampled music or sound packs.
- Weather (rain streaks, ground splashes, lens drops, tyre-spray puff, lightning flash) and thunder audio: original procedural shaders, generated textures and Web Audio filtered noise authored in `src/game/weather/`; no image, model or sound assets are used.
- Inter and Barlow Condensed: self-hosted Fontsource packages; their licence files are retained in package dependencies.

Visual review ledger: retained graphite/cyan/magenta palette; retained night/rain atmosphere; retained third-person rear driving composition; added functional, code-native HUD with objective, map and speed; deliberately simplified architecture and vehicle detail; used inexpensive road light pools in place of photoreal reflections. The HUD is a necessary implementation extension of the original concept, which contained no UI. No screenshot UI is used.
