import { type BrickSpec } from "./catalog";
/** Convex pieces shared by rendering, dynamic colliders and manual clearance. */
export type Solid =
  | { kind: "box"; center: number[]; half: number[] }
  | { kind: "hull"; vertices: number[] };
const box = (
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
): Solid => ({ kind: "box", center: [x, y, z], half: [hx, hy, hz] });
const prism = (
  polygon: number[][],
  lo: number,
  hi: number,
  axis: "x" | "z",
): Solid => ({
  kind: "hull",
  vertices: [lo, hi].flatMap((v) =>
    polygon.flatMap(([a, b]) => (axis === "x" ? [v, a, b] : [a, b, v])),
  ),
});
function shell(w: number, d: number, h: number, x = 0, z = 0): Solid[] {
  const t = 0.14;
  return [
    box(x, h / 2 - 0.08, z, w / 2, 0.08, d / 2),
    ...[-1, 1].flatMap((k) => [
      box(x + (k * (w - t)) / 2, -0.08, z, t / 2, (h - 0.16) / 2, d / 2),
      box(
        x,
        -0.08,
        z + (k * (d - t)) / 2,
        (w - 2 * t) / 2,
        (h - 0.16) / 2,
        t / 2,
      ),
    ]),
  ];
}
export function solids(s: BrickSpec, roundSegments = 12): Solid[] {
  const w = s.cols - 0.04,
    d = s.rows - 0.04,
    h = s.height;
  if (!s.shape) return shell(w, d, h);
  if (s.shape === "corner") {
    // Continuous L-shaped roof and perimeter walls, with a hollow underside.
    const outline = [
      [-0.98, -0.98],
      [0.98, -0.98],
      [0.98, 0],
      [0, 0],
      [0, 0.98],
      [-0.98, 0.98],
    ];
    const parts: Solid[] = [
      box(0, h / 2 - 0.08, -0.49, 0.98, 0.08, 0.49),
      box(-0.49, h / 2 - 0.08, 0.49, 0.49, 0.08, 0.49),
    ];
    outline.forEach(([x, z], i) => {
      const [nx, nz] = outline[(i + 1) % outline.length];
      const dx = nx - x,
        dz = nz - z,
        length = Math.hypot(dx, dz);
      parts.push(
        box(
          (x + nx) / 2 - (dz / length) * 0.07,
          -0.08,
          (z + nz) / 2 + (dx / length) * 0.07,
          dx === 0 ? 0.07 : length / 2,
          (h - 0.16) / 2,
          dz === 0 ? 0.07 : length / 2,
        ),
      );
    });
    return parts;
  }
  if (s.shape === "round") {
    const parts: Solid[] = [];
    for (let i = 0; i < roundSegments; i++) {
      const a = (i * Math.PI * 2) / roundSegments,
        b = ((i + 1) * Math.PI * 2) / roundSegments;
      const points = [a, b].flatMap((t) =>
        [0.48, 0.33].map((r) => [Math.cos(t) * r, Math.sin(t) * r]),
      );
      parts.push({
        kind: "hull",
        vertices: [-h / 2, h / 2 - 0.16].flatMap((y) =>
          points.flatMap(([x, z]) => [x, y, z]),
        ),
      });
    }
    const rim = Array.from({ length: roundSegments }, (_, i) => [
      Math.cos((i * Math.PI * 2) / roundSegments) * 0.48,
      Math.sin((i * Math.PI * 2) / roundSegments) * 0.48,
    ]);
    parts.push({
      kind: "hull",
      vertices: [h / 2 - 0.16, h / 2].flatMap((y) =>
        rim.flatMap(([x, z]) => [x, y, z]),
      ),
    });
    return parts;
  }
  if (s.shape === "slope") {
    const back = -d / 2,
      front = d / 2,
      plateau = s.top === "back" ? back + 0.94 : back;
    const profile = [
      [h / 2, back],
      [h / 2, plateau],
      [-h / 2 + 0.4, front],
    ];
    const roof = [
      ...profile,
      ...[...profile].reverse().map(([y, z]) => [y - 0.14, z]),
    ];
    const sides = [[-h / 2, back], ...profile, [-h / 2, front]];
    return [
      prism(roof, -w / 2, w / 2, "x"),
      prism(sides, -w / 2, -w / 2 + 0.14, "x"),
      prism(sides, w / 2 - 0.14, w / 2, "x"),
      box(0, 0, back + 0.07, w / 2, h / 2, 0.07),
      box(0, -h / 2 + 0.2, front - 0.07, w / 2, 0.2, 0.07),
    ];
  }
  const parts = [...shell(0.96, d, h, -1.5), ...shell(0.96, d, h, 1.5)];
  // Curved underside assembled from convex wedges; the opening remains empty.
  for (let i = 0; i < 16; i++) {
    const x0 = -1.02 + (i * 2.04) / 16,
      x1 = -1.02 + ((i + 1) * 2.04) / 16;
    const underside = (x: number) =>
      -h / 2 + 0.9 * Math.sqrt(Math.max(0, 1 - (x / 1.02) ** 2));
    parts.push(
      prism(
        [
          [x0, underside(x0)],
          [x1, underside(x1)],
          [x1, h / 2],
          [x0, h / 2],
        ],
        -d / 2,
        d / 2,
        "z",
      ),
    );
  }
  return parts;
}
