# Asset provenance and visual decisions

- `public/assets/facade.png`: generated with the built-in image generation tool for Sumo World. Prompt: seamless orthographic dark graphite cyberpunk tower facade, realistic office windows, cyan/magenta and warm illuminated rooms, weathered panels; no sky, ground, perspective or text. Used as the runtime building texture.
- `public/assets/concept.png`: generated in the architecture task; visual reference only, not rendered as the game world.
- Car, characters, roads, buildings and props: original procedural Three.js geometry authored for this prototype. This is an intentional 3D prototype departure from the image-based asset workflow; flat sprites cannot substitute for the requested explorable geometry.
- Road microtexture, signs and light pools: original procedural textures. Sign names are fictional. No licensed car logos or third-party model assets are used.
- Engine audio: generated locally by Web Audio oscillators; no sampled music or sound packs.
- `public/models/sumo-gt.glb` (Sumo GT): original fastback GT coupe designed for Sumo World and generated reproducibly by `tools/car/build_car.py` in Blender 5.2 (headless). No real car brand, badge, logo or third-party model or texture is used; the file carries geometry and named materials only. The runtime replaces its materials with procedural ones (`src/game/vehicle/carMaterials.ts`), including a generated paint-flake normal map.
- `docs/screenshots/car-blender-*.png` and `docs/screenshots/car-game-*.png`: review renders of the Sumo GT (Blender EEVEE turntable and headless Chromium captures of the game).
- Inter and Barlow Condensed: self-hosted Fontsource packages; their licence files are retained in package dependencies.

Visual review ledger: retained graphite/cyan/magenta palette; retained night/rain atmosphere; retained third-person rear driving composition; added functional, code-native HUD with objective, map and speed; deliberately simplified architecture and vehicle detail; used inexpensive road light pools in place of photoreal reflections. The HUD is a necessary implementation extension of the original concept, which contained no UI. No screenshot UI is used.
