# Bricks

A small, tactile 3D construction playground. Pick up a brick, line up its studs, press it into place, and build something that behaves as a connected physical object.

Built with TypeScript, Three.js, and Rapier. Runs entirely in the browser and builds to static files for GitHub Pages. No backend, accounts, or API keys.

## What's in the MVP

- Three classic rectangular bricks: **1×2, 2×2, and 2×4**, with six colors.
- A fully 3D scene with orbit controls, shadows, hollow brick shells, studs, and visible underside support tubes.
- Dynamic gravity, friction, collision response, tumbling, and continuous collision detection.
- A collapsible library on the right. New bricks appear held above the work surface.
- Free movement rather than world-grid placement. Connector alignment is checked in the target brick's local coordinates.
- Explicit press-to-connect: correct positioning alone never creates a joint. Click **Press to connect** or hold **Space**; a short downward stroke ends with recorded LEGO audio.
- Connected bricks move together. Separating a seam releases connections crossing that interface and preserves connections on either side, including a five-brick stack splitting into groups of three and two.
- A wide brick can attach to multiple supports in one press.
- English and Turkish interfaces, remembered locally.
- JSON save/open, a physics pause button, and an interactive connection example.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. A current browser with WebGL2 and WebAssembly is required. The controls are designed primarily for a desktop mouse and keyboard.

```sh
npm test         # connector rules, graph cuts, actual Rapier integration
npm run build   # TypeScript validation and production build
npm run preview # serve the production build locally
```

## Controls

| Action                      | Control                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| Add a brick                 | Choose a color and click a library card                                      |
| Select                      | Click a brick                                                                |
| Pick up and move            | Drag a brick, or click **Pick up** then drag                                 |
| Raise / lower               | **E / Q**, or the + / − buttons                                              |
| Rotate around vertical axis | **R** or Rotate                                                              |
| Tilt                        | **X / Z**                                                                    |
| Stand upright               | **U** or Upright; lift first if space is tight                               |
| Connect                     | Green alignment indicator, then click **Press to connect** or hold **Space** |
| Cancel a keyboard press     | Release Space before the stroke completes                                    |
| Release to physics          | **Escape** or Release                                                        |
| Separate                    | Select a connected brick, choose a seam, click **Separate**                  |
| Orbit                       | Drag empty space                                                             |
| Pan                         | Right-drag                                                                   |
| Zoom                        | Mouse wheel                                                                  |

A held object remains in your hand when you stop dragging. This lets you adjust height and rotation before releasing it. Lift above nearby bricks before moving across them. The connection example starts with two aligned bricks so you can try pressing immediately.

Audio starts after a user gesture, in accordance with browser autoplay rules. Use the music-note button to mute it. No audio is streamed at runtime.

## Deploy to GitHub Pages

Run `npm run build` to generate `dist/`. Publish the contents of that directory using your preferred GitHub Pages setup. No deployment workflow is bundled; publishing is managed by the repository owner.

Relative asset URLs work at a repository subpath such as `/lego-bricks/` and at a domain root. `dist/` can also be uploaded to any static web host. Opening `index.html` directly through `file://` is not supported.

## Engine structure

| Module                      | Responsibility                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `src/engine/catalog.ts`     | Dimensions, colors, and shared stud/socket lattice                                  |
| `src/engine/geometry.ts`    | Procedural hollow shells, studs, and support tubes                                  |
| `src/engine/connections.ts` | Local-space mating checks and connected-component traversal                         |
| `src/engine/world.ts`       | Rapier bodies, compound colliders, joints, held assemblies, separation, persistence |
| `src/engine/audio.ts`       | Cached recording playback and small pitch/gain variation                            |
| `src/i18n.ts`               | Both interface languages                                                            |
| `src/main.ts`               | Scene, input, pressure animation, and interface integration                         |

Each brick is a dynamic rigid body with a compound set of wall, roof, and cylindrical stud colliders. Engaged bricks use fixed joints; collisions within an engaged pair are disabled. Simulation advances at a fixed 120 Hz with bounded catch-up. Held connected components temporarily become kinematic and return to dynamic bodies on release.

Mating requires compatible surface normals, a quarter-turn relative orientation, matching stud pitch, a small horizontal tolerance, and a limited approach distance. Alignment previews are permissive only within those tolerances. Pressing checks clearance and creates joints only after the downward stroke. A connection graph records which bricks actually engage.

Separation uses the selected connection's interface plane. Connections crossing that plane are removed together after checking the extraction path, while internal connections remain intact. The lifted component stays in your hand. An obstructed separation is rejected.

### Add another rectangular brick

Add an entry to `catalog`:

```ts
{ id: '2x6', cols: 6, rows: 2, height: 1.2, label: '2 × 6' }
```

The mesh, collider layout, connector lattice, UI card, and save format use that definition. One world unit is one stud pitch; proportions are approximately 8 mm pitch / 9.6 mm body height.

Slopes, clips, hinges, axles, and nonrectangular elements need additional geometry, collider, and connector implementations. They should not be represented by merely changing rectangular dimensions. The rendering, connectivity, and physics modules are separate so these can be extended independently.

## Scope and current limitations

This is a construction-oriented rigid-body approximation, not a material simulation of ABS plastic. Gravity and masses are tuned for an interactive tabletop. Stud grip is represented by explicit joints rather than elastic deformation or a calibrated clutch-force model. Connections do not automatically break under load.

Manual movement uses conservative oriented body bounds to reject intersections; these bounds do not model every underside recess. Underside tubes are visual geometry; wall, roof, and stud shapes handle collision. Continuous physics still uses the detailed compound colliders. Extremely tight arrangements may require lifting a brick before repositioning it. Orientation buttons turn by 90 degrees; free bodies may tumble at any angle.

Separation currently supports straight extraction along the chosen interface normal, not peeling or twisting. Save files store geometry and connections, not instantaneous velocities. There is a 250-brick creation/import cap, but practical performance depends on device and assembly complexity. Touch layouts are available, but desktop controls are the primary MVP target.

The JavaScript payload contains Three.js and Rapier's WebAssembly runtime (roughly 1 MB compressed). The optional Google Fonts stylesheet falls back to installed sans-serif fonts if unavailable. All geometry and sounds are local assets.

## Sound credits

Real recordings are included under **CC0 1.0**:

- [Lego Click (short) — ImmergoMedia](https://freesound.org/people/ImmergoMedia/sounds/670000/): two LEGO pieces tapped together. Bundled as `public/audio/lego-tap.mp3` from the high-quality preview; used for impacts.
- [Connecting two LEGO Bricks — LauraWebdev](https://freesound.org/people/LauraWebdev/sounds/257245/): actual connection recordings. Three excerpts from the high-quality preview are bundled as `connect-1.wav`, `connect-2.wav`, and `connect-3.wav`, with short fade-outs. Used for engagement and, at a slightly lower playback rate, separation. Separation is an adaptation, not a separate pull-apart recording.

[CC0 license](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is retained here for provenance even though CC0 does not require it.

This is an independent fan-made experiment and is not affiliated with or endorsed by the LEGO Group. LEGO is a trademark of the LEGO Group. No official logos or product photographs are bundled.
