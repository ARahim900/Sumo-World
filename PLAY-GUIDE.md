# Sumo World — playable prototype

Open http://127.0.0.1:3000 while the local server is running, or double-click `Launch-Sumo-World.command` on this Mac. Keep its Terminal window open while playing. The launcher uses Node.js/npm already installed on this machine and restores dependencies with `npm ci` if needed.

1. Choose **Enter Sumo World**.
2. You start beside the silver Sumo GT. Press **F** within two metres of the driver's door.
3. Hold **W** to accelerate. Follow the cyan road arrows to the transit terminal.
4. Hold **S** to brake inside the green destination ring. Remain stopped for one second to complete the mission.
5. Keep exploring, or press **Escape → Restart mission**.

| Control | Action |
|---|---|
| WASD / arrow keys | Walk; accelerate, brake and steer while driving |
| Mouse | Click the scene to capture the pointer, then look around on foot |
| F | Enter the nearby car / exit when stopped with a clear space |
| Shift | Sprint on foot |
| Space | Jump on foot / rear-wheel handbrake while driving |
| V | First-person / third-person walking camera |
| C | Look behind while driving |
| S, released then pressed again after stopping | Reverse |
| R | Recover at the starting garage |
| Escape | Pause and resume once the drive has started |

The start and pause menus share a settings panel: **Quality** (Low, Medium, High, Ultra), **Auto resolution**, **Weather** (Auto, Clear, Drizzle, Storm, Fog), **Low motion** and **Engine audio**. Choices are saved in the browser and restored on the next visit; engine audio is restored when you press **Enter Sumo World**, because browsers only start sound after a click. The pause menu also offers recovery and mission restart. Losing window focus pauses the simulation and clears held controls.

While driving, the HUD shows speed, a rev counter with redline, the current gear (R, N, 1) and the weather. Add `?debug` to the address for frame rate and renderer counters. Phones and tablets without a mouse see a desktop-only notice; touch controls are not implemented.

Standard gamepad bindings: left stick move/steer, right stick look, right trigger accelerate, left trigger brake/reverse, west face button enter/exit, south jump, east handbrake, left-stick click sprint, right-stick click walking camera, menu pause. Keyboard/browser workflow was verified; a physical controller was not available for device testing.

## Implemented

- A bounded, explorable modular 3D neon district with generated facade artwork, illuminated signage, road markings, rain, fog, bloom, headlights and ambient walking figures.
- Rapier rigid-body car, suspension wheel rays, speed-sensitive steering, service brakes, reverse guard, handbrake traction change and contact-based spray/smoke.
- Capsule-based walking, jumping, collision with buildings, first/third-person views, camera obstruction checks, guarded vehicle entry and safe exits.
- Destination mission with possession, distance, height, speed and continuous-stop checks; progress HUD, speedometer, map, route markers, pause, restart and recovery.

## Prototype boundaries

This is a gameplay prototype with original procedural 3D models, not the photorealistic concept image. Road light pools approximate wet reflections. The district is loaded as one scene; streaming, saved progress, traffic driving AI, interactive NPC missions, lightning and detailed damage are not implemented. Pedestrians are ambient visual figures. Camera obstruction uses a ray rather than the specification's future swept volume. No mobile touch controls or native packaging. Driving is physically simulated and tuned for this fictional car; real-vehicle calibration and motorsport-grade tyre modelling are not claimed.

The first prototype uses a direct Three.js renderer inside a Next.js/React shell and a direct Rapier adapter. This keeps one explicit fixed-step owner; React Three Fiber was not necessary for this slice. CSS styles the HUD; no database is required.

## Verification / Review Notes

- Production Next.js build and strict TypeScript checks passed.
- Nine physics/mission integration tests passed: entry/exit, proximity/occlusion, acceleration/braking, moving-exit rejection, wall collision, arrival predicates/hold, brake-to-reverse guard, walking collision, blocked exits and steering stability.
- In-app browser: start → enter → drive approximately 128 m → brake → mission complete, then exit, first-person walking, pause and restart verified.
- Main view inspected at 1672 × 941, matching the concept image dimensions; narrow viewport inspected separately. Concept and implementation differ intentionally in model detail, city composition and reflection techniques. No pixel-faithful or photorealistic claim.
- No hardware-wide frame-rate guarantee. Runtime development telemetry is instantaneous and is not a benchmark.
- Rapier's bundled WASM loader emits a deprecation warning during initialisation; it did not prevent the tests or browser workflow.
- Local self-review addressed quaternion interpolation, held-brake reverse behaviour, input clearing and collision/mission guards. No external CodeRabbit review was sent.

Developer commands: `npm run dev`, `npm run check`, `npm test`, `npm run build`, `npm start`, `npm run test:e2e` (after a build). Exact dependencies are locked in `package-lock.json`. See README.md for architecture, deployment and CI.
