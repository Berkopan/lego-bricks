import * as T from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";

/** A reusable support shape measured from the rendered brick, including studs. */
export class GroundSupport {
  private readonly points: Float64Array;
  /** Enclosing radius about the brick origin, for cheap ground-distance checks. */
  readonly radius: number;

  constructor(mesh: T.Object3D) {
    mesh.updateWorldMatrix(true, true);
    const inverse = mesh.matrixWorld.clone().invert();
    const points: T.Vector3[] = [];
    const local = new T.Matrix4();
    let radiusSquared = 0;
    mesh.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      const positions = child.geometry.getAttribute("position");
      local.multiplyMatrices(inverse, child.matrixWorld);
      for (let i = 0; i < positions.count; i++) {
        const point = new T.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(local);
        points.push(point);
        radiusSquared = Math.max(radiusSquared, point.lengthSq());
      }
    });
    // A linear height query reaches its minimum at a convex-hull vertex. This
    // keeps the exact rendered outline while discarding thousands of interior
    // and repeated vertices (shells, tubes and the undersides of studs).
    const hull = new ConvexHull().setFromPoints(points);
    const support = new Set<T.Vector3>();
    for (const face of hull.faces) {
      let edge = face.edge;
      do {
        support.add(edge.head().point);
        edge = edge.next;
      } while (edge !== face.edge);
    }
    this.points = new Float64Array(
      [...support].flatMap((point) => [point.x, point.y, point.z]),
    );
    this.radius = Math.sqrt(radiusSquared);
  }

  /** Exact lowest rendered vertex at a rigid pose; no per-step mesh traversal. */
  bottom(
    position: Readonly<{ x: number; y: number; z: number }>,
    rotation: Readonly<{ x: number; y: number; z: number; w: number }>,
  ) {
    const { x, y, z, w } = rotation;
    // World Y row of the same quaternion rotation matrix used by Three.
    const rx = 2 * (x * y + z * w);
    const ry = 1 - 2 * (x * x + z * z);
    const rz = 2 * (y * z - x * w);
    let bottom = Infinity;
    for (let i = 0; i < this.points.length; i += 3)
      bottom = Math.min(
        bottom,
        rx * this.points[i] + ry * this.points[i + 1] + rz * this.points[i + 2],
      );
    return position.y + bottom;
  }

  /** Projected vertex bounds overlap the square floor; not triangle clipping. */
  overlapsFloor(
    position: Readonly<{ x: number; y: number; z: number }>,
    rotation: Readonly<{ x: number; y: number; z: number; w: number }>,
    halfExtent = 100,
  ) {
    const px = Math.abs(position.x);
    const pz = Math.abs(position.z);
    if (px > halfExtent + this.radius || pz > halfExtent + this.radius)
      return false;
    if (px + this.radius <= halfExtent && pz + this.radius <= halfExtent)
      return true;

    // Only the narrow floor-edge band needs tighter projected bounds. A
    // bounding sphere alone would keep entirely off-edge bricks suspended.
    const { x, y, z, w } = rotation;
    const xx = 1 - 2 * (y * y + z * z);
    const xy = 2 * (x * y - z * w);
    const xz = 2 * (x * z + y * w);
    const zx = 2 * (x * z - y * w);
    const zy = 2 * (y * z + x * w);
    const zz = 1 - 2 * (x * x + y * y);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.points.length; i += 3) {
      const vx = this.points[i];
      const vy = this.points[i + 1];
      const vz = this.points[i + 2];
      const worldX = position.x + xx * vx + xy * vy + xz * vz;
      const worldZ = position.z + zx * vx + zy * vy + zz * vz;
      minX = Math.min(minX, worldX);
      maxX = Math.max(maxX, worldX);
      minZ = Math.min(minZ, worldZ);
      maxZ = Math.max(maxZ, worldZ);
    }
    return (
      minX <= halfExtent &&
      maxX >= -halfExtent &&
      minZ <= halfExtent &&
      maxZ >= -halfExtent
    );
  }
}
