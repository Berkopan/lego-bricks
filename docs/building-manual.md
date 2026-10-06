# Building manuals

Choose **Download manual** (**Manual’i indir** in Turkish; **PDF** on narrow screens) in the footer. The app captures the scene immediately, prepares the PDF in the background, and starts a download. A progress panel offers cancellation. A **Download PDF** link remains available for another download and for browsers that require a fresh tap after asynchronous work. Closing the panel or starting another export releases the previous download URL.

The exported snapshot does not modify physics, selected/held pieces, positions, colors, rotations, or saved connections. If the world continues moving while pages render, the manual still uses the snapshot from the original click. An empty scene produces a short message rather than a blank PDF.

## Document layout

1. **Parts inventory first.** Counts are grouped by the exact catalog part and color, with a part illustration, translated part/color names, and the exact hexadecimal color. Long inventories continue onto more pages at readable print sizes.
2. **Build plan and any relevant notes.** The complete scene, drawing legend, and coordinate conventions introduce the instructions. The document flags detected overlaps, unsupported starts, invalid links, and access constraints instead of silently changing the scene.
3. **One clear addition per step.** Each landscape A4 page shows the needed part, a large cumulative assembly view, a close-up of the connection, and a top view. Earlier pieces are lightened; the new piece retains its color and has an amber outline. The connection inset lifts the new piece and draws an insertion arrow. The large and top views always show its actual final position.
4. **Finished scene and placement tables.** These preserve the original spacing and orientation of separate structures and loose pieces. Crowded scenes use multiple numbered placement sheets.

The main camera angle and scale stay fixed within each assembly. Close-ups can use a clearer angle and omit surrounding pieces to expose the support. Every view uses the same `brickMesh` geometry as the world, including hollow bodies, slopes, tiles, round pieces, corners, and arches. Continuous shape outlines avoid drawing the internal seams of convex collider decomposition.

## Construction order

The planner validates saved connections and also detects near-exact stud/socket contact using the engine's connector rules. This includes extra supports under a bridge even if the scene saved only one connection. It creates a directed dependency from every lower support to the part above it. Smooth tiles, the front of a slope, the empty arch opening, and the missing corner cell do not invent connectors.

Connected components become numbered assemblies. Within an assembly, all lower supports must be present before the part above them. Ready pieces are selected from the lowest construction layer, then by spatial proximity and footprint. Input-array order, insertion history, and arbitrary piece IDs do not choose the build order. Each source brick appears once in the steps and once in inventory accounting.

An assembly's construction frame follows its stud direction, so a tilted or inverted complete model can be illustrated upright for building and returned to its original pose in the final layout. Source positions and quaternions are cloned and retained; only the independent illustration scene is transformed.

## Positions and orientation

On step pages, `X / H / Z` gives the new part's **center** relative to the assembly origin, in stud pitches. The origin is the center of the completed assembly's footprint at its lowest local solid plane, marked `0` in the large view. Positive X points right and positive Z down in the top view. One pitch corresponds to approximately 8 mm; a plate is 0.4 pitch high. Coordinates use up to three decimal places to retain imported offsets.

The rotation triplet is the part's XYZ Euler orientation in degrees in the same construction frame. Illustrations preserve the source quaternion directly; the displayed angles use up to two decimal places. The final placement table gives each assembly origin and frame rotation in the original world coordinates. Use the numbered world map to position separate models. If an access note applies to an enclosed assembly, consult that final placement map **before** constructing the enclosure.

## Practical boundaries

The scene editor can contain geometry that cannot stand on its own or be reproduced exactly with solid physical pieces. The planner checks occupied convex solids, including special-shape openings, for obvious overlaps and ground penetration. Elevated separate components or raised construction roots are flagged where temporary support may be required. These checks do not constitute a full load/stability simulation or a general insertion-path solver; some arrangements still require holding, reorienting, or assembling subgroups by hand. The manual never “repairs” the user's model by moving or dropping pieces.

## Implementation and verification

- `src/manual/plan.ts`: pure, deterministic inventory, support graph, assembly frames and diagnostics.
- `src/manual/render.ts`: one isolated reusable Three.js renderer, shared geometry, camera fitting, outlines, and projected annotation anchors.
- `src/manual/pdf.ts`: paginated A4 layout, insertion diagrams, vector text, locally bundled Unicode fonts, progress and cancellation checkpoints.
- `src/manual/ui.ts`: download lifecycle, localized status, cancellation and mobile-friendly controls. The PDF code is dynamically imported only when requested.

PDF generation requires no server, API key, or external font service. Font and JavaScript URLs go through Vite so relative GitHub Pages deployment paths work. The bundled DejaVu subsets retain Latin/Turkish text and their original license in `src/manual/fonts/LICENSE.txt`.

Planner tests cover bridge dependencies, rotated components, exact snapshot preservation, inventory accounting, special connectors and collision diagnostics. Camera tests cover wide/tall models, arbitrary rotations, clipping and translation invariance. Browser tests download real PDFs on desktop and touch layouts, check that export leaves the scene and JSON save unchanged, and exercise cancellation, retries, empty scenes, and Turkish controls.
