# Bricks

A small, tactile 3D construction playground. Pick up a brick, line up its studs, press it into place, and build something that behaves as a connected physical object.

Built with TypeScript, Three.js, and Rapier. Runs entirely in the browser and builds to static files for GitHub Pages. No backend, accounts, or API keys.

## What's in the MVP

- **13 part types** across bricks, plates, tiles, slopes, round pieces, a corner plate and an arch, with six colors and category filters.
- A fully 3D scene with orbit controls, shadows, hollow brick shells, studs, and visible underside support tubes.
- Dynamic gravity, friction, collision response, tumbling, and continuous collision detection.
- A collapsible library on the right. New bricks appear held above the work surface.
- Free movement rather than world-grid placement. Connector alignment is checked in the target brick's local coordinates.
- Explicit press-to-connect remains the default. Click **Press to connect** or hold **Space**; a short press stroke toward the mating surface ends with recorded LEGO audio.
- Optional **Snap** mode previews a nearby, valid connection as a translucent cyan hologram of the entire held assembly. Release the drag or movement controls while it is visible to connect at that exact pose. Snap starts off on every page load.
- Subtle horizontal resistance over usable stud alignments helps you feel when a held brick can be lowered into place, independently of Snap mode.
- Connected bricks move together. Separating a seam releases connections crossing that interface and preserves connections on either side, including a five-brick stack splitting into groups of three and two.
- A wide brick can attach to multiple supports in one press.
- English and Turkish interfaces, remembered locally.
- JSON save/open, a physics pause button, and an interactive connection example.

## Parts

The three original bricks (1×2, 2×2 and 2×4) are joined by these ten additions:

| Family | Added parts |
| --- | --- |
| Plates | 1×2, 2×4 |
| Smooth tiles | 1×2, 2×2 |
| Round | 1×1 brick, 1×1 plate |
| Slopes | 2×2 slope with a studded rear ledge, 1×1 cheese slope |
| Corner | L-shaped 2×2 plate with three studs |
| Arch | 1×4 arch with a curved opening |

These are simplified representations of familiar families in [LEGO Pick a Brick](https://www.lego.com/en-us/pick-and-build/pick-a-brick), not a measured ranking of the ten most-used moulds or manufacturing CAD replicas. Plates and tiles use one-third brick height. Smooth tiles and cheese slopes have no upper studs; the larger slope only connects on its rear ledge. The arch attaches underneath at its two feet. Its opening and the missing corner of the L plate are empty in both rendering and collision. Library thumbnails use the actual scene geometry.

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

The browser interaction suite checks mouse dragging and real touch/joystick release behavior in Chromium, including both orders of simultaneous joystick and height input:

```sh
npx playwright install chromium
npm run test:ui
```

CI runs this suite in addition to the engine tests and production build. Screenshots of the hologram and any failed browser checks are available in the browser-test-results artifact.

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
| Snap preview                | Toggle **Snap**; release a moved drag or movement controls while the cyan hologram is visible |
| Cancel a keyboard press     | Release Space before the stroke completes                                    |
| Release to physics          | **Escape** or Release                                                        |
| Separate                    | Select a connected brick, then double-click a highlighted seam; or choose a seam and click **Separate**                  |
| Orbit                       | Drag empty space                                                             |
| Pan                         | Right-drag                                                                   |
| Zoom                        | Mouse wheel                                                                  |

With Snap off, or with no valid hologram, a held object remains in your hand when you stop dragging. This lets you adjust height and rotation before releasing it. With Snap on, a normal movement release accepts the displayed connection; the Release button also accepts an available hologram. Escape always releases to physics without snapping. Selecting a brick, cancelling a gesture, switching to camera controls, or losing focus never creates a connection. When using the joystick and height buttons together, only releasing the last movement control can accept the snap.

The soft alignment resistance works with Snap on or off. It slows horizontal dragging, joystick movement, and directional nudges near a usable stud alignment. It never changes height or rotation, never creates a connection, and can be overcome by continuing to move. Real connector shapes and the whole assembly's downward clearance are checked, including when held well above the short snap range. Lift above nearby bricks before moving across them. The connection example in the help dialog starts with two aligned bricks so you can try pressing immediately.

Choose Ivory, Sand, Slate, or Grass from the ground selector in the library. This visual preference is remembered in your browser; changing it keeps your bricks and physics intact. Grass uses a locally generated texture and requires no downloads.

Audio starts after a user gesture, in accordance with browser autoplay rules. Use the speaker button to mute it. No audio is streamed at runtime.

## Engine structure

| Module                      | Responsibility                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `src/engine/catalog.ts`     | Dimensions, colors, and shared stud/socket lattice                                  |
| `src/engine/solids.ts` | Shared convex bodies for special geometry, colliders and manual clearance |
| `src/engine/geometry.ts`    | Procedural hollow shells, studs, and support tubes                                  |
| `src/engine/connections.ts` | Local-space mating checks and connected-component traversal                         |
| `src/engine/alignment.ts` | Connector projection for a valid downward approach at any height |
| `src/engine/alignment-motion.ts` | Finite horizontal resistance with stable absolute-pointer motion |
| `src/engine/world.ts`       | Rapier bodies, compound colliders, joints, held assemblies, separation, persistence |
| `src/engine/audio.ts`       | Cached recording playback and small pitch/gain variation                            |
| `src/i18n.ts`               | Both interface languages                                                            |
| `src/main.ts`               | Scene, input, pressure animation, and interface integration                         |
| `src/input/movement.ts` | Shared movement session and final release across simultaneous controls |
| `src/scene/snap-preview.ts` | Cached, non-interactive hologram of the complete target assembly |

Each brick is a dynamic rigid body with a compound set of wall, roof, and cylindrical stud colliders. Engaged bricks use fixed joints; collisions within an engaged pair are disabled. Simulation advances at a fixed 120 Hz with bounded catch-up. Held connected components temporarily become kinematic and return to dynamic bodies on release.

Mating requires compatible surface normals, a quarter-turn relative orientation (single round studs/sockets allow free yaw), matching stud pitch, a small horizontal tolerance, and a limited approach distance. Alignment previews are permissive only within those tolerances. Pressing checks clearance and creates joints only after the press stroke. Either side can be held: a lower brick can press upward into an existing assembly’s underside, or an upper brick can press downward onto its studs. A connection graph records which bricks actually engage.

Snap uses a separate, wider candidate query; the existing manual press tolerances remain unchanged. The hologram stores immutable final poses for all held members. Release revalidates the displayed pair, held assembly, stationary anchor, exact contacts, and swept path before changing any body or creating any joint. A stale or blocked preview is rejected rather than replaced with another target. Holograms have no colliders, shadows, raycast targets, or serialized state. Both modes still build to static files for GitHub Pages.

Separation uses the selected connection's interface plane. Connections crossing that plane are removed together after checking the extraction path, while internal connections remain intact. The lifted component stays in your hand. An obstructed separation is rejected.

### Add another rectangular brick

Add an entry to `catalog`:

```ts
{ id: '2x6', cols: 6, rows: 2, height: 1.2, label: '2 × 6' }
```

The mesh, collider layout, connector lattice, UI card, and save format use that definition. One world unit is one stud pitch; proportions are approximately 8 mm pitch / 9.6 mm body height.

Use `family` for library filtering and `labelTr` for Turkish names. `height: 0.4` defines a plate; `top: "none"` defines a smooth upper surface. `shape` selects the round, slope, corner or arch implementation. `connectors(spec, "top" | "bottom")` describes each surface independently. Add custom shapes in `solids.ts` and their connector masks in `catalog.ts`; the shared convex solids feed geometry and physics, while library previews render the same mesh. Add engagement, clearance, separation and save/restore tests for each new family. Clips, hinges, axles and side-facing connectors still need their own joint/connector implementations.

## Scope and current limitations

This is a construction-oriented rigid-body approximation, not a material simulation of ABS plastic. Gravity and masses are tuned for an interactive tabletop. Stud grip is represented by explicit joints rather than elastic deformation or a calibrated clutch-force model. Connections do not automatically break under load.

Manual movement uses conservative oriented body bounds for rectangular parts, followed by convex-shape checks for special parts so their openings remain usable. These checks do not model every underside recess. Underside tubes are visual geometry; wall, roof, and stud shapes handle collision. Continuous physics still uses the detailed compound colliders. Extremely tight arrangements may require lifting a brick before repositioning it. Orientation buttons turn by 90 degrees; free bodies may tumble at any angle.

Separation currently supports straight extraction along the chosen interface normal, not peeling or twisting. Save files store geometry and connections, not instantaneous velocities. There is a 250-brick creation/import cap, but practical performance depends on device and assembly complexity. Touch layouts are available, but desktop controls are the primary MVP target.

The JavaScript payload contains Three.js and Rapier's WebAssembly runtime (roughly 1 MB compressed). The optional Google Fonts stylesheet falls back to installed sans-serif fonts if unavailable. All geometry and sounds are local assets.

## Sound credits

Real recordings are included under **CC0 1.0**:

- [Lego Click (short) — ImmergoMedia](https://freesound.org/people/ImmergoMedia/sounds/670000/): two LEGO pieces tapped together. Bundled as `public/audio/lego-tap.mp3` from the high-quality preview; used for impacts.
- [Connecting two LEGO Bricks — LauraWebdev](https://freesound.org/people/LauraWebdev/sounds/257245/): actual connection recordings. Three excerpts from the high-quality preview are bundled as `connect-1.wav`, `connect-2.wav`, and `connect-3.wav`, with peak normalization and short edge fades. Used for engagement and, at a slightly lower playback rate, separation. Separation is an adaptation, not a separate pull-apart recording.

[CC0 license](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is retained here for provenance even though CC0 does not require it.

This is an independent fan-made experiment and is not affiliated with or endorsed by the LEGO Group. LEGO is a trademark of the LEGO Group. No official logos or product photographs are bundled.

Audio signal inspection and playback regression results: [audio verification](docs/audio-analysis.md).
