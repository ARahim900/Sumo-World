# Asset provenance and visual decisions

- `public/assets/facade.png`: generated with the built-in image generation tool for Sumo World. Prompt: seamless orthographic dark graphite cyberpunk tower facade, realistic office windows, cyan/magenta and warm illuminated rooms, weathered panels; no sky, ground, perspective or text. Used as the runtime building texture.
- `public/assets/facade.webp`: lossy WebP (quality 82, `cwebp -q 82 -m 6`, libwebp 1.6.0) made from `facade.png` by the production team; 2.9 MB to 0.3 MB at the same 1536 × 1024 size. Same artwork and provenance as `facade.png`. The PNG stays until the world team points the loader in `src/game/world/city.ts` at the WebP.
- `docs/reference/concept.png` (moved from `public/assets/concept.png` so it is no longer deployed): generated in the architecture task; visual reference only, not rendered as the game world.
- `src/app/icon.svg`: original browser-tab icon drawn by the production team (diamond and dot in the HUD palette). No third-party artwork.
- `docs/screenshots/production-*.png`: captured from the local production build with headless Chrome (software WebGL), so frame rate and anti-aliasing are lower than on a GPU.
- Car, characters, roads, buildings and props: original procedural Three.js geometry authored for this prototype. This is an intentional 3D prototype departure from the image-based asset workflow; flat sprites cannot substitute for the requested explorable geometry.
- Road microtexture, signs and light pools: original procedural textures. Sign names are fictional. No licensed car logos or third-party model assets are used.
- Engine audio: generated locally by Web Audio oscillators; no sampled music or sound packs.
- Inter and Barlow Condensed: self-hosted Fontsource packages; their licence files are retained in package dependencies.

Visual review ledger: retained graphite/cyan/magenta palette; retained night/rain atmosphere; retained third-person rear driving composition; added functional, code-native HUD with objective, map and speed; deliberately simplified architecture and vehicle detail; used inexpensive road light pools in place of photoreal reflections. The HUD is a necessary implementation extension of the original concept, which contained no UI. No screenshot UI is used.
