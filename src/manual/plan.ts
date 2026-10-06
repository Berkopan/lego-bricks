import { Box3, Quaternion, Vector3 } from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { catalog, connectors, type BrickSpec } from "../engine/catalog";
import { mating } from "../engine/connections";
import { solids, type Solid } from "../engine/solids";
import type { BrickWorld } from "../engine/world";

export type SceneSnapshot = ReturnType<BrickWorld["serialize"]>;

export interface ManualBrick {
  id: number;
  spec: BrickSpec;
  color: string;
  position: Vector3;
  rotation: Quaternion;
}

export interface ManualInventoryEntry {
  key: string;
  spec: BrickSpec;
  color: string;
  count: number;
}

export interface ManualWarning {
  code:
    | "unsupported"
    | "collision"
    | "support-cycle"
    | "invalid-link"
    | "assembly-access";
  message: string;
  brickIds: number[];
}

export interface ManualStep {
  /** Global, one-based page-step number. */
  number: number;
  /** One-based assembly number. */
  assembly: number;
  added: number[];
  /** Cumulative parts in this assembly, including this step's addition. */
  built: number[];
  /** All direct lower stud supports for the new parts. */
  supports: number[];
}

export interface ManualAssembly {
  number: number;
  brickIds: number[];
  /** Base-plane center in the unchanged source world. */
  origin: Vector3;
  /** Build frame -> source world. Invert a clone to render the assembly upright. */
  rotation: Quaternion;
  steps: ManualStep[];
}

export interface ManualPlan {
  bricks: ManualBrick[];
  inventory: ManualInventoryEntry[];
  assemblies: ManualAssembly[];
  steps: ManualStep[];
  warnings: ManualWarning[];
}

const CONTACT_EPSILON = 0.025;
const COLLISION_EPSILON = 0.035;
const GROUND_EPSILON = 0.08;
const UP = new Vector3(0, 1, 0);
const AXES = [new Vector3(1, 0, 0), UP, new Vector3(0, 0, 1)];
const rounded = (value: number) => Math.round(value * 10000) / 10000;
const numeric = (a: number, b: number) => rounded(a) - rounded(b);
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Geometry, not insertion time or IDs, determines every nonidentical choice. */
function compareBricks(a: ManualBrick, b: ManualBrick): number {
  return (
    numeric(a.position.y, b.position.y) ||
    numeric(a.position.z, b.position.z) ||
    numeric(a.position.x, b.position.x) ||
    lexical(a.spec.id, b.spec.id) ||
    lexical(a.color.toLowerCase(), b.color.toLowerCase()) ||
    lexical(rotationKey(a.rotation), rotationKey(b.rotation)) ||
    a.id - b.id
  );
}

function rotationKey(rotation: Quaternion) {
  const q = rotation.clone().normalize();
  // q and -q are the same orientation and must sort identically.
  const sign = (q.w || q.z || q.y || q.x) < 0 ? -1 : 1;
  return q
    .toArray()
    .map((v) => rounded(v * sign))
    .join(",");
}

interface ConvexSolid {
  vertices: Vector3[];
  normals: Vector3[];
  edges: Vector3[];
  bounds: Box3;
}

function uniqueDirection(directions: Vector3[], direction: Vector3) {
  if (direction.lengthSq() < 1e-12) return;
  direction.normalize();
  if (!directions.some((other) => Math.abs(other.dot(direction)) > 0.999999))
    directions.push(direction);
}

function convexSolid(solid: Solid): ConvexSolid {
  if (solid.kind === "box") {
    const vertices = [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map(
          (z) =>
            new Vector3(
              solid.center[0] + x * solid.half[0],
              solid.center[1] + y * solid.half[1],
              solid.center[2] + z * solid.half[2],
            ),
        ),
      ),
    );
    return {
      vertices,
      normals: AXES.map((v) => v.clone()),
      edges: AXES.map((v) => v.clone()),
      bounds: new Box3().setFromPoints(vertices),
    };
  }
  const vertices = Array.from({ length: solid.vertices.length / 3 }, (_, i) =>
    new Vector3().fromArray(solid.vertices, i * 3),
  );
  const hull = new ConvexHull().setFromPoints(vertices);
  const normals: Vector3[] = [];
  const edges: Vector3[] = [];
  for (const face of hull.faces) {
    uniqueDirection(normals, face.normal.clone());
    let edge = face.edge;
    do {
      uniqueDirection(edges, edge.head().point.clone().sub(edge.tail().point));
      edge = edge.next;
    } while (edge !== face.edge);
  }
  return {
    vertices,
    normals,
    edges,
    bounds: new Box3().setFromPoints(vertices),
  };
}

/** Shared occupied solids retain arch openings, slopes and corner cutouts. */
function partSolids(spec: BrickSpec) {
  const body = solids(spec);
  // The same stud dimensions as the world colliders; a polygonal cylinder is
  // sufficient for warnings while keeping this planner independent of Rapier.
  const studs: Solid[] = connectors(spec).map(({ x, z }) => ({
    kind: "hull",
    vertices: [spec.height / 2, spec.height / 2 + 0.22].flatMap((y) =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (i * Math.PI) / 6;
        return [x + Math.cos(angle) * 0.3, y, z + Math.sin(angle) * 0.3];
      }).flat(),
    ),
  }));
  return [...body, ...studs].map(convexSolid);
}

function transformSolid(solid: ConvexSolid, brick: ManualBrick): ConvexSolid {
  const rotation = brick.rotation.clone().normalize();
  const vertices = solid.vertices.map((v) =>
    v.clone().applyQuaternion(rotation).add(brick.position),
  );
  return {
    vertices,
    normals: solid.normals.map((v) => v.clone().applyQuaternion(rotation)),
    edges: solid.edges.map((v) => v.clone().applyQuaternion(rotation)),
    bounds: new Box3().setFromPoints(vertices),
  };
}

function boundsOverlap(a: Box3, b: Box3, tolerance = COLLISION_EPSILON) {
  return AXES.every(
    (_, axis) =>
      Math.min(a.max.getComponent(axis), b.max.getComponent(axis)) -
        Math.max(a.min.getComponent(axis), b.min.getComponent(axis)) >
      tolerance,
  );
}

/** SAT on actual convex pieces, including edge axes for arbitrary rotations. */
function solidOverlap(a: ConvexSolid, b: ConvexSolid) {
  if (!boundsOverlap(a.bounds, b.bounds)) return false;
  const axes = [...a.normals, ...b.normals];
  for (const x of a.edges)
    for (const y of b.edges) uniqueDirection(axes, x.clone().cross(y));
  return axes.every((axis) => {
    const pa = a.vertices.map((v) => v.dot(axis));
    const pb = b.vertices.map((v) => v.dot(axis));
    return (
      Math.min(Math.max(...pa), Math.max(...pb)) -
        Math.max(Math.min(...pa), Math.min(...pb)) >
      COLLISION_EPSILON
    );
  });
}

/** Ray/convex-solid slabs, used only to flag obvious enclosed components. */
function blocksRay(origin: Vector3, direction: Vector3, solid: ConvexSolid) {
  let enter = 0;
  let exit = Infinity;
  for (const normal of solid.normals) {
    const values = solid.vertices.map((vertex) => vertex.dot(normal));
    const min = Math.min(...values),
      max = Math.max(...values);
    const start = origin.dot(normal),
      speed = direction.dot(normal);
    if (Math.abs(speed) < 1e-9) {
      if (start < min || start > max) return false;
      continue;
    }
    const a = (min - start) / speed,
      b = (max - start) / speed;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (exit - enter <= COLLISION_EPSILON) return false;
  }
  // Do not infer an enclosure from a ray that starts in an intersecting solid.
  return enter > CONTACT_EPSILON && exit > enter;
}

/**
 * Make a reproducible, bottom-up construction sequence without touching the
 * world or snapping its poses. This diagnoses obvious problems, not structural
 * stability or every possible insertion path of a real physical model.
 */
export function createManualPlan(snapshot: SceneSnapshot): ManualPlan {
  if (snapshot.version !== 1 || !Array.isArray(snapshot.bricks))
    throw new Error("Invalid manual scene");
  const ids = new Set<number>();
  const bricks = snapshot.bricks
    .map((brick): ManualBrick => {
      const spec = catalog.find((s) => s.id === brick.spec);
      if (
        !spec ||
        ids.has(brick.id) ||
        !Number.isSafeInteger(brick.id) ||
        !/^#[0-9a-f]{6}$/i.test(brick.color) ||
        brick.p.length !== 3 ||
        brick.q.length !== 4 ||
        ![...brick.p, ...brick.q].every(Number.isFinite)
      )
        throw new Error("Invalid manual brick");
      const rotation = new Quaternion().fromArray(brick.q);
      if (rotation.lengthSq() < 1e-6)
        throw new Error("Invalid manual rotation");
      ids.add(brick.id);
      return {
        id: brick.id,
        spec: { ...spec },
        color: brick.color,
        position: new Vector3().fromArray(brick.p),
        rotation,
      };
    })
    .sort(compareBricks);
  const byId = new Map(bricks.map((brick) => [brick.id, brick]));
  const sortedIds = (values: Iterable<number>) =>
    [...new Set(values)].sort((a, b) =>
      compareBricks(byId.get(a)!, byId.get(b)!),
    );
  const warnings: ManualWarning[] = [];
  const inventoryByKey = new Map<string, ManualInventoryEntry>();
  for (const brick of bricks) {
    const color = brick.color.toLowerCase();
    const key = `${brick.spec.id}:${color}`;
    const item = inventoryByKey.get(key);
    if (item) item.count++;
    else inventoryByKey.set(key, { key, spec: brick.spec, color, count: 1 });
  }
  const inventory = [...inventoryByKey.values()].sort(
    (a, b) =>
      catalog.findIndex((s) => s.id === a.spec.id) -
        catalog.findIndex((s) => s.id === b.spec.id) ||
      lexical(a.color, b.color),
  );
  const lowerSupports = new Map(bricks.map((b) => [b.id, new Set<number>()]));
  const neighbors = new Map(bricks.map((b) => [b.id, new Set<number>()]));
  const connect = (upper: number, lower: number) => {
    lowerSupports.get(upper)!.add(lower);
    neighbors.get(upper)!.add(lower);
    neighbors.get(lower)!.add(upper);
  };

  const invalidLinks = new Set<number>();
  for (const link of snapshot.links ?? []) {
    const upper = byId.get(link.a),
      lower = byId.get(link.b);
    // Physics may leave a small joint error. Existing saved links use the same
    // geometry tolerance as restore, but are never allowed to invent support.
    const fit =
      upper && lower && upper !== lower ? mating(upper, lower, 0.08) : null;
    if (
      !fit ||
      !upper ||
      !lower ||
      fit.position.distanceTo(upper.position) > 0.08
    ) {
      if (upper) invalidLinks.add(upper.id);
      if (lower) invalidLinks.add(lower.id);
      continue;
    }
    connect(upper.id, lower.id);
  }
  if (invalidLinks.size)
    warnings.push({
      code: "invalid-link",
      brickIds: sortedIds(invalidLinks),
      message:
        "Some saved connections do not match the displayed connector geometry.",
    });

  // Contact inference includes every foot of a bridge, even if only one link
  // was saved. A nearby hovering preview or a smooth/sloped face is not a joint.
  for (let i = 0; i < bricks.length; i++) {
    for (let j = i + 1; j < bricks.length; j++) {
      const a = bricks[i],
        b = bricks[j];
      const reach =
        Math.hypot(
          a.spec.cols + b.spec.cols,
          a.spec.rows + b.spec.rows,
          a.spec.height + b.spec.height,
        ) /
          2 +
        CONTACT_EPSILON;
      if (a.position.distanceToSquared(b.position) > reach * reach) continue;
      for (const [upper, lower] of [
        [a, b],
        [b, a],
      ]) {
        if (lowerSupports.get(upper.id)!.has(lower.id)) continue;
        const fit = mating(
          upper,
          lower,
          CONTACT_EPSILON,
          false,
          CONTACT_EPSILON,
        );
        if (
          fit &&
          fit.position.distanceTo(upper.position) <= CONTACT_EPSILON &&
          fit.rotation.angleTo(upper.rotation.clone().normalize()) <=
            CONTACT_EPSILON
        )
          connect(upper.id, lower.id);
      }
    }
  }

  const localSolids = new Map<string, ConvexSolid[]>();
  const colliders = new Map<number, ConvexSolid[]>();
  const bounds = new Map<number, Box3>();
  for (const brick of bricks) {
    let local = localSolids.get(brick.spec.id);
    if (!local) {
      local = partSolids(brick.spec);
      localSolids.set(brick.spec.id, local);
    }
    const occupied = local.map((solid) => transformSolid(solid, brick));
    colliders.set(brick.id, occupied);
    bounds.set(
      brick.id,
      occupied.reduce((box, solid) => box.union(solid.bounds), new Box3()),
    );
  }
  const collided = new Set<number>();
  for (let i = 0; i < bricks.length; i++) {
    const a = bricks[i];
    if (bounds.get(a.id)!.min.y < -GROUND_EPSILON) collided.add(a.id);
    for (let j = i + 1; j < bricks.length; j++) {
      const b = bricks[j];
      if (!boundsOverlap(bounds.get(a.id)!, bounds.get(b.id)!)) continue;
      if (
        colliders
          .get(a.id)!
          .some((sa) => colliders.get(b.id)!.some((sb) => solidOverlap(sa, sb)))
      ) {
        collided.add(a.id);
        collided.add(b.id);
      }
    }
  }
  if (collided.size)
    warnings.push({
      code: "collision",
      brickIds: sortedIds(collided),
      message:
        "Some occupied part solids overlap other parts or the ground in the source scene.",
    });

  const groups: ManualBrick[][] = [];
  const visited = new Set<number>();
  for (const brick of bricks) {
    if (visited.has(brick.id)) continue;
    const pending = [brick.id];
    const members: ManualBrick[] = [];
    visited.add(brick.id);
    while (pending.length) {
      const id = pending.pop()!;
      members.push(byId.get(id)!);
      for (const next of sortedIds(neighbors.get(id)!)) {
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
    groups.push(members.sort(compareBricks));
  }
  // Finish the main model before smaller disconnected models and loose pieces.
  groups.sort((a, b) => b.length - a.length || compareBricks(a[0], b[0]));
  const groupBounds = new Map(
    groups.map((members) => [
      members,
      members.reduce(
        (box, brick) => box.union(bounds.get(brick.id)!),
        new Box3(),
      ),
    ]),
  );
  const enclosed = new Map(
    groups.map((members) => [members, new Set<ManualBrick[]>()]),
  );
  for (const outer of groups) {
    const envelope = groupBounds.get(outer)!;
    const outerSize = envelope.getSize(new Vector3()).lengthSq();
    const directions = [
      AXES[0],
      AXES[0].clone().negate(),
      AXES[2],
      AXES[2].clone().negate(),
      UP,
    ].map((axis) =>
      axis.clone().applyQuaternion(outer[0].rotation.clone().normalize()),
    );
    const occupied = outer.flatMap((brick) => colliders.get(brick.id)!);
    const affected = new Set<number>();
    for (const inner of groups) {
      if (inner === outer) continue;
      const inside = groupBounds.get(inner)!;
      if (
        inside.getSize(new Vector3()).lengthSq() >=
          outerSize - CONTACT_EPSILON ||
        !envelope.clone().expandByScalar(CONTACT_EPSILON).containsBox(inside)
      )
        continue;
      const center = inside.getCenter(new Vector3());
      const vertices = inner.flatMap((brick) =>
        colliders.get(brick.id)!.flatMap((solid) => solid.vertices),
      );
      const samples = [
        center,
        ...directions
          .slice(0, 4)
          .map((direction) =>
            vertices.reduce((furthest, point) =>
              point.dot(direction) > furthest.dot(direction) ? point : furthest,
            ),
          ),
      ];
      // A bounding-box test alone would incorrectly call an open arch enclosed.
      // Sample the occupied width as well as the center: a thin seam between roof
      // plates may pass a center ray but cannot pass the inner part. Blocked
      // straight translations are an advisory, not a general path proof.
      if (
        !directions.every((direction) =>
          samples.some((point) =>
            occupied.some((solid) => blocksRay(point, direction, solid)),
          ),
        )
      )
        continue;
      enclosed.get(outer)!.add(inner);
      for (const brick of [...outer, ...inner]) affected.add(brick.id);
    }
    if (affected.size)
      warnings.push({
        code: "assembly-access",
        brickIds: sortedIds(affected),
        message:
          "Place the inner assembly at its world-layout position before building the enclosing assembly around it; installing it afterward may be blocked.",
      });
  }
  const orderedGroups: ManualBrick[][] = [];
  const pendingGroups = groups.slice();
  while (pendingGroups.length) {
    const ready = pendingGroups.findIndex((members) =>
      [...enclosed.get(members)!].every(
        (inner) => !pendingGroups.includes(inner),
      ),
    );
    // Strictly smaller contained bounds make these dependencies acyclic.
    orderedGroups.push(pendingGroups.splice(ready < 0 ? 0 : ready, 1)[0]);
  }
  const assemblies: ManualAssembly[] = [];
  const steps: ManualStep[] = [];
  for (const members of orderedGroups) {
    const number = assemblies.length + 1;
    const roots = members.filter((brick) => !lowerSupports.get(brick.id)!.size);
    const anchor = [...(roots.length ? roots : members)].sort(
      (a, b) =>
        b.spec.cols * b.spec.rows - a.spec.cols * a.spec.rows ||
        compareBricks(a, b),
    )[0];
    const rotation = anchor.rotation.clone().normalize();
    const inverse = rotation.clone().invert();
    const localBounds = new Box3();
    const centers = new Map<number, Vector3>();
    const floors = new Map<number, number>();
    for (const brick of members) {
      centers.set(
        brick.id,
        brick.position.clone().sub(anchor.position).applyQuaternion(inverse),
      );
      let floor = Infinity;
      for (const solid of colliders.get(brick.id)!)
        for (const vertex of solid.vertices) {
          const local = vertex
            .clone()
            .sub(anchor.position)
            .applyQuaternion(inverse);
          localBounds.expandByPoint(local);
          floor = Math.min(floor, local.y);
        }
      floors.set(brick.id, floor);
    }
    const localOrigin = localBounds.getCenter(new Vector3());
    localOrigin.y = localBounds.min.y;
    const origin = localOrigin.applyQuaternion(rotation).add(anchor.position);
    const assembly: ManualAssembly = {
      number,
      brickIds: members.map((b) => b.id),
      origin,
      rotation,
      steps: [],
    };
    const ground = Math.min(...members.map((b) => bounds.get(b.id)!.min.y));
    const elevatedRoots = roots.filter(
      (brick) => floors.get(brick.id)! - localBounds.min.y > GROUND_EPSILON,
    );
    if (ground > GROUND_EPSILON || elevatedRoots.length)
      warnings.push({
        code: "unsupported",
        brickIds:
          ground > GROUND_EPSILON
            ? assembly.brickIds.slice()
            : sortedIds(elevatedRoots.map((brick) => brick.id)),
        message:
          ground > GROUND_EPSILON
            ? "This separate assembly is elevated above the ground; its displayed world pose may need external support."
            : "Some foundation parts start above the assembly base; hold or temporarily support them until the spanning parts are installed.",
      });
    const remaining = new Set(assembly.brickIds);
    const built = new Set<number>();
    let previous: ManualBrick | undefined;
    let cycleReported = false;
    while (remaining.size) {
      let ready = members.filter(
        (brick) =>
          remaining.has(brick.id) &&
          [...lowerSupports.get(brick.id)!].every((id) => built.has(id)),
      );
      if (!ready.length) {
        if (!cycleReported)
          warnings.push({
            code: "support-cycle",
            brickIds: sortedIds(remaining),
            message:
              "The support graph contains a cycle; a conventional bottom-up assembly cannot be guaranteed.",
          });
        cycleReported = true;
        ready = members.filter((brick) => remaining.has(brick.id));
      }
      ready.sort((a, b) => {
        const ca = centers.get(a.id)!,
          cb = centers.get(b.id)!;
        const floor = numeric(
          ca.y - a.spec.height / 2,
          cb.y - b.spec.height / 2,
        );
        if (floor) return floor;
        if (previous) {
          const reference = centers.get(previous.id)!;
          const distance = numeric(
            ca.distanceToSquared(reference),
            cb.distanceToSquared(reference),
          );
          if (distance) return distance;
        }
        return (
          b.spec.cols * b.spec.rows - a.spec.cols * a.spec.rows ||
          numeric(ca.z, cb.z) ||
          numeric(ca.x, cb.x) ||
          compareBricks(a, b)
        );
      });
      const next = ready[0];
      remaining.delete(next.id);
      built.add(next.id);
      const step: ManualStep = {
        number: steps.length + 1,
        assembly: number,
        added: [next.id],
        built: [...built],
        supports: sortedIds(lowerSupports.get(next.id)!),
      };
      assembly.steps.push(step);
      steps.push(step);
      previous = next;
    }
    assemblies.push(assembly);
  }
  return { bricks, inventory, assemblies, steps, warnings };
}
