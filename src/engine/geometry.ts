import * as T from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { solids } from "./solids";
import { connectors, type BrickSpec } from "./catalog";
export function brickMesh(s: BrickSpec, color: string) {
  const group = new T.Group();
  const material = new T.MeshPhysicalMaterial({
    color,
    roughness: 0.27,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
  });
  const add = (g: T.BufferGeometry, x: number, y: number, z: number) => {
    const m = new T.Mesh(g, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  if (s.shape) {
    for (const solid of solids(s, 48)) {
      if (solid.kind === "box") {
        add(
          new T.BoxGeometry(
            ...(solid.half.map((v) => v * 2) as [number, number, number]),
          ),
          ...(solid.center as [number, number, number]),
        );
      } else {
        const points = [];
        for (let i = 0; i < solid.vertices.length; i += 3)
          points.push(new T.Vector3().fromArray(solid.vertices, i));
        add(new ConvexGeometry(points), 0, 0, 0);
      }
    }
    for (const p of connectors(s))
      add(
        new T.CylinderGeometry(0.3, 0.3, 0.22, 32),
        p.x,
        s.height / 2 + 0.11,
        p.z,
      );
    return group;
  }
  // Hollow underside, four walls, roof and hollow support tubes.
  const w = s.cols - 0.04,
    d = s.rows - 0.04,
    h = s.height,
    wall = 0.16;
  // Continuous shell: no seams between independently bevelled wall boxes.
  const vertices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
  const x = w / 2,
    z = d / 2,
    y = h / 2,
    ix = x - wall,
    iz = z - wall,
    ceiling = y - 0.18;
  quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]);
  quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]);
  quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]);
  quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]);
  quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]);
  quad([ix, -y, iz], [-ix, -y, iz], [-ix, ceiling, iz], [ix, ceiling, iz]);
  quad([-ix, -y, -iz], [ix, -y, -iz], [ix, ceiling, -iz], [-ix, ceiling, -iz]);
  quad([ix, -y, -iz], [ix, -y, iz], [ix, ceiling, iz], [ix, ceiling, -iz]);
  quad([-ix, -y, iz], [-ix, -y, -iz], [-ix, ceiling, -iz], [-ix, ceiling, iz]);
  quad(
    [-ix, ceiling, -iz],
    [ix, ceiling, -iz],
    [ix, ceiling, iz],
    [-ix, ceiling, iz],
  );
  quad([-x, -y, -z], [x, -y, -z], [ix, -y, -iz], [-ix, -y, -iz]);
  quad([x, -y, -z], [x, -y, z], [ix, -y, iz], [ix, -y, -iz]);
  quad([x, -y, z], [-x, -y, z], [-ix, -y, iz], [ix, -y, iz]);
  quad([-x, -y, z], [-x, -y, -z], [-ix, -y, -iz], [-ix, -y, iz]);
  const shell = new T.BufferGeometry();
  shell.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  shell.computeVertexNormals();
  add(shell, 0, 0, 0);
  for (const p of connectors(s))
    add(new T.CylinderGeometry(0.3, 0.3, 0.22, 40), p.x, h / 2 + 0.11, p.z);
  if (s.rows > 1)
    for (let i = 0; i < s.cols - 1; i++) {
      const shape = new T.Shape();
      shape.absarc(0, 0, 0.32, 0, Math.PI * 2, false);
      const hole = new T.Path();
      hole.absarc(0, 0, 0.23, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const geo = new T.ExtrudeGeometry(shape, {
        depth: h - 0.22,
        bevelEnabled: false,
        curveSegments: 24,
      });
      geo.rotateX(Math.PI / 2);
      add(geo, i - (s.cols - 2) / 2, h / 2 - 0.18, 0);
    }
  return group;
}
