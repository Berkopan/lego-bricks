import R from "@dimforge/rapier3d-compat";
import * as T from "three";
import { OBB } from "three/addons/math/OBB.js";
import { catalog, connectors, type BrickSpec } from "./catalog";
import { component, mating, type Link, type Pose } from "./connections";
import { overlapDepth, bottomOf } from "./overlap";
import { brickMesh } from "./geometry";
import { solids, type Solid } from "./solids";
import { loweringFit } from "./alignment";
function solidCollider(s: Solid) {
  return s.kind === "box"
    ? R.ColliderDesc.cuboid(
        ...(s.half as [number, number, number]),
      ).setTranslation(...(s.center as [number, number, number]))
    : R.ColliderDesc.convexHull(new Float32Array(s.vertices))!;
}
export interface Brick extends Pose {
  body: R.RigidBody;
  mesh: T.Group;
  color: string;
}
export interface Connection extends Link {
  joint: R.ImpulseJoint;
  studs: number;
}
type PositionSnapshot = Readonly<{ x: number; y: number; z: number }>;
type RotationSnapshot = Readonly<{
  x: number;
  y: number;
  z: number;
  w: number;
}>;
export interface SnapPose {
  readonly id: number;
  readonly position: PositionSnapshot;
  readonly rotation: RotationSnapshot;
}
/** The complete, immutable pose displayed by a snap hologram. */
export interface SnapCandidate {
  readonly rootId: number;
  readonly position: PositionSnapshot;
  readonly rotation: RotationSnapshot;
  readonly poses: readonly SnapPose[];
  readonly upperId: number;
  readonly lowerId: number;
  readonly stationaryId: number;
  readonly studs: number;
}
export interface LoweringAlignment {
  /** Root pose at the current height after planar/assist alignment. */
  position: T.Vector3;
  rotation: T.Quaternion;
  lowerId: number;
  memberId: number;
  /** World-Y distance from the aligned pose to the final connector pose. */
  drop: number;
}
type TargetPoses = Map<number, { p: T.Vector3; q: T.Quaternion }>;
type Fit = NonNullable<ReturnType<typeof mating>>;
const snapshotPose = (id: number, p: T.Vector3, q: T.Quaternion): SnapPose =>
  Object.freeze({
    id,
    position: Object.freeze({ x: p.x, y: p.y, z: p.z }),
    rotation: Object.freeze({ x: q.x, y: q.y, z: q.z, w: q.w }),
  });
const samePosition = (a: PositionSnapshot, b: PositionSnapshot) =>
  new T.Vector3().copy(a).distanceTo(new T.Vector3().copy(b)) <= 1e-4;
const sameRotation = (a: RotationSnapshot, b: RotationSnapshot) =>
  new T.Quaternion()
    .copy(a)
    .normalize()
    .angleTo(new T.Quaternion().copy(b).normalize()) <= 1e-4;
export class BrickWorld {
  world!: R.World;
  events!: R.EventQueue;
  bricks: Brick[] = [];
  links: Connection[] = [];
  held = new Set<number>();
  nextId = 1;
  private elapsed = 0;
  private impactTimes = new Map<string, number>();
  private quietUntil = new Map<number, number>();
  private holdRevision = 0;
  private snapPreviews = new WeakMap<
    SnapCandidate,
    {
      kind: "nearby" | "lowering";
      revision: number;
      members: Brick[];
      stationary: Brick;
      anchor: SnapPose;
      stationaryMembers: { brick: Brick; pose: SnapPose }[];
      poses: TargetPoses;
    }
  >();
  constructor(
    public scene: T.Scene,
    public onImpact: (v: number) => void,
  ) {}
  async init() {
    await R.init();
    this.world = new R.World({ x: 0, y: -24, z: 0 });
    this.world.timestep = 1 / 120;
    this.world.numSolverIterations = 12;
    this.events = new R.EventQueue(true);
    this.world.createCollider(
      R.ColliderDesc.cuboid(100, 0.2, 100)
        .setTranslation(0, -0.2, 0)
        .setFriction(0.65),
    );
  }
  /** Reserve a free position before releasing the previous held assembly.
   * Synchronous scene insertion makes repeated clicks safe even without a physics step.
   * Full envelopes include studs, orientation, and a small separation margin.
   */
  spawnHeld(spec: BrickSpec, color: string, center = new T.Vector3(0, 6, 0)) {
    if (this.bricks.length >= 250) return null;
    const envelope = (spec: BrickSpec, p: T.Vector3, q: T.Quaternion) =>
      new OBB(
        p.clone().add(new T.Vector3(0, 0.11, 0).applyQuaternion(q)),
        new T.Vector3(
          spec.cols / 2 + 0.1,
          spec.height / 2 + 0.21,
          spec.rows / 2 + 0.1,
        ),
        new T.Matrix3().setFromMatrix4(
          new T.Matrix4().makeRotationFromQuaternion(q),
        ),
      );
    const occupied = this.bricks.map((b) =>
      envelope(
        b.spec,
        new T.Vector3().copy(b.body.translation()),
        new T.Quaternion().copy(b.body.rotation()),
      ),
    );
    const origin = new T.Vector3(
      T.MathUtils.clamp(center.x, -60, 60),
      Math.max(6, center.y, spec.height / 2 + 0.3),
      T.MathUtils.clamp(center.z, -60, 60),
    );
    const stride = Math.max(spec.cols, spec.rows) + 0.3;
    const rotation = new T.Quaternion();
    for (let ring = 0; ring <= 16; ring++) {
      const candidates: T.Vector3[] = [];
      for (let x = -ring; x <= ring; x++)
        for (let z = -ring; z <= ring; z++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== ring) continue;
          candidates.push(
            origin.clone().add(new T.Vector3(x * stride, 0, z * stride)),
          );
        }
      candidates.sort(
        (a, b) => a.distanceToSquared(origin) - b.distanceToSquared(origin),
      );
      for (const p of candidates) {
        if (
          Math.abs(p.x) + spec.cols / 2 > 95 ||
          Math.abs(p.z) + spec.rows / 2 > 95
        )
          continue;
        const bounds = envelope(spec, p, rotation);
        if (occupied.some((other) => bounds.intersectsOBB(other))) continue;
        const brick = this.add(spec, color, p);
        this.grab(brick.id);
        return brick;
      }
    }
    return null;
  }
  add(
    spec: BrickSpec,
    color: string,
    p = new T.Vector3(0, 4, 0),
    q = new T.Quaternion(),
  ) {
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(q)
        .setCcdEnabled(true)
        .setLinearDamping(0.18)
        .setAngularDamping(0.35),
    );
    const h = spec.height;
    for (const solid of solids(spec))
      this.world.createCollider(
        solidCollider(solid)
          .setFriction(0.55)
          .setRestitution(0.08)
          .setDensity(0.65)
          .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        body,
      );
    for (const p of connectors(spec))
      this.world.createCollider(
        R.ColliderDesc.cylinder(0.11, 0.3)
          .setTranslation(p.x, h / 2 + 0.11, p.z)
          .setFriction(0.5)
          .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        body,
      );
    const mesh = brickMesh(spec, color);
    this.scene.add(mesh);
    const b = {
      id: this.nextId++,
      spec,
      color,
      body,
      mesh,
      position: p.clone(),
      rotation: q.clone(),
    };
    mesh.userData.brick = b;
    this.bricks.push(b);
    this.sync();
    return b;
  }
  sync() {
    for (const b of this.bricks) {
      b.position.copy(b.body.translation());
      b.rotation.copy(b.body.rotation());
      b.mesh.position.copy(b.position);
      b.mesh.quaternion.copy(b.rotation);
    }
  }
  step() {
    // Capture incoming motion before the solver removes impact velocity.
    const incoming = new Map(
      this.bricks.map((b) => [
        b.body.handle,
        {
          brick: b,
          velocity: new T.Vector3().copy(b.body.linvel()),
          spin:
            (new T.Vector3().copy(b.body.angvel()).length() *
              Math.max(b.spec.cols, b.spec.rows)) /
            2,
          group: Math.min(...component(b.id, this.links)),
        },
      ]),
    );
    this.elapsed += this.world.timestep;
    this.world.step(this.events);
    const impacts = new Map<string, number>();
    this.events.drainCollisionEvents((handleA, handleB, started) => {
      if (!started) return;
      const bodyA = this.world.getCollider(handleA)?.parent();
      const bodyB = this.world.getCollider(handleB)?.parent();
      const a = bodyA ? incoming.get(bodyA.handle) : undefined;
      const b = bodyB ? incoming.get(bodyB.handle) : undefined;
      if (!a && !b) return;
      if (
        [a, b].some(
          (v) =>
            v &&
            (this.held.has(v.brick.id) ||
              (this.quietUntil.get(v.brick.id) ?? 0) > this.elapsed),
        )
      )
        return;
      if (a && b && a.group === b.group) return;
      const speed =
        (a?.velocity.clone() ?? new T.Vector3())
          .sub(b?.velocity ?? new T.Vector3())
          .length() +
        (a?.spin ?? 0) +
        (b?.spin ?? 0);
      // Resting support forces and tiny solver bounces are not fresh impacts.
      if (speed < 1.2) return;
      const key = [a?.group ?? 0, b?.group ?? 0]
        .sort((a, b) => a - b)
        .join(":");
      impacts.set(key, Math.max(impacts.get(key) ?? 0, speed));
    });
    for (const [key, speed] of impacts) {
      if (this.elapsed - (this.impactTimes.get(key) ?? -Infinity) < 0.25)
        continue;
      this.impactTimes.set(key, this.elapsed);
      this.onImpact(Math.min(0.65, speed / 18));
    }
    for (const [key, time] of this.impactTimes)
      if (this.elapsed - time > 1) this.impactTimes.delete(key);
    for (const [id, time] of this.quietUntil)
      if (this.elapsed > time) this.quietUntil.delete(id);
    this.sync();
    for (const b of [...this.bricks]) if (b.position.y < -30) this.remove(b.id);
  }
  get(id: number) {
    return this.bricks.find((b) => b.id === id)!;
  }
  grab(id: number) {
    this.release();
    this.held = component(id, this.links);
    for (const i of this.held) {
      const b = this.get(i);
      b.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
  release() {
    this.holdRevision++;
    for (const i of this.held) {
      const b = this.get(i);
      b.body.setBodyType(R.RigidBodyType.Dynamic, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.held.clear();
  }
  obb(b: Brick, p = b.position, q = b.rotation) {
    return new OBB(
      p.clone(),
      new T.Vector3(
        b.spec.cols / 2 - 0.035,
        b.spec.height / 2 - 0.015,
        b.spec.rows / 2 - 0.035,
      ),
      new T.Matrix3().setFromMatrix4(
        new T.Matrix4().makeRotationFromQuaternion(q),
      ),
    );
  }
  private clearanceShapes = new Map<
    BrickSpec,
    { shape: R.Shape; offset: T.Vector3 }[]
  >();
  private shapes(spec: BrickSpec) {
    let cached = this.clearanceShapes.get(spec);
    if (!cached) {
      cached = spec.shape
        ? solids(spec).map((s) => ({
            shape: solidCollider(s).shape,
            offset: new T.Vector3(
              ...((s.kind === "box" ? s.center : [0, 0, 0]) as [
                number,
                number,
                number,
              ]),
            ),
          }))
        : [
            {
              shape: new R.Cuboid(
                spec.cols / 2 - 0.035,
                spec.height / 2 - 0.015,
                spec.rows / 2 - 0.035,
              ),
              offset: new T.Vector3(),
            },
          ];
      this.clearanceShapes.set(spec, cached);
    }
    return cached;
  }
  private detailedOverlap(a: Brick, box: OBB, b: Brick) {
    const q = new T.Quaternion().setFromRotationMatrix(
      new T.Matrix4().setFromMatrix3(box.rotation),
    );
    return this.shapes(a.spec).some((sa) =>
      this.shapes(b.spec).some((sb) =>
        sa.shape.intersectsShape(
          sa.offset.clone().applyQuaternion(q).add(box.center),
          q,
          sb.shape,
          sb.offset.clone().applyQuaternion(b.rotation).add(b.position),
          b.rotation,
        ),
      ),
    );
  }
  clearAt(
    poses: Map<number, { p: T.Vector3; q: T.Quaternion }>,
    previous?: Map<number, OBB>,
  ) {
    for (const [id, { p, q }] of poses) {
      const b = this.get(id),
        obb = this.obb(b, p, q);
      const before = previous?.get(id);
      const bottom = bottomOf(obb);
      if (bottom < -0.01 && (!before || bottom < bottomOf(before) - 1e-6))
        return false;
      for (const other of this.bricks) {
        if (poses.has(other.id)) continue;
        const obstacle = this.obb(other);
        if (!obb.intersectsOBB(obstacle, 1e-5)) continue;
        const detailed = !!(b.spec.shape || other.spec.shape);
        if (detailed && !this.detailedOverlap(b, obb, other)) continue;
        // Existing overlaps may only stay level or shrink at every swept step.
        // New intersections, deepening overlaps, and passing through walls remain blocked.
        if (
          !before ||
          !before.intersectsOBB(obstacle, 1e-5) ||
          (detailed && !this.detailedOverlap(b, before, other)) ||
          obb.center.distanceToSquared(obstacle.center) <
            before.center.distanceToSquared(obstacle.center) - 1e-6 ||
          overlapDepth(obb, obstacle) > overlapDepth(before, obstacle) + 1e-6
        )
          return false;
      }
    }
    return true;
  }
  private sweptPoses(id: number, target: T.Vector3, rotation?: T.Quaternion) {
    if (!this.held.has(id)) return null;
    const root = this.get(id);
    const desired = rotation ?? root.rotation;
    const distance = root.position.distanceTo(target);
    const angle = root.rotation.angleTo(desired);
    const radius = Math.max(
      ...[...this.held].map(
        (i) =>
          this.get(i).position.distanceTo(root.position) +
          this.get(i).spec.cols,
      ),
    );
    const steps = Math.max(1, Math.ceil((distance + angle * radius) / 0.15));
    let poses = new Map<number, { p: T.Vector3; q: T.Quaternion }>();
    let previous = new Map(
      [...this.held].map((i) => [i, this.obb(this.get(i))]),
    );
    // Sweep both translation and rotation so a large input cannot tunnel
    // through an obstacle even when the destination itself is clear.
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const position = root.position.clone().lerp(target, t);
      const delta = root.rotation
        .clone()
        .slerp(desired, t)
        .multiply(root.rotation.clone().invert());
      poses = new Map();
      for (const i of this.held) {
        const b = this.get(i);
        poses.set(i, {
          p: b.position
            .clone()
            .sub(root.position)
            .applyQuaternion(delta)
            .add(position),
          q: delta.clone().multiply(b.rotation),
        });
      }
      if (!this.clearAt(poses, previous)) return null;
      previous = new Map(
        [...poses].map(([id, { p, q }]) => [id, this.obb(this.get(id), p, q)]),
      );
    }
    return poses;
  }
  transform(id: number, target: T.Vector3, rotation?: T.Quaternion) {
    const poses = this.sweptPoses(id, target, rotation);
    if (!poses) return false;
    for (const [i, { p, q }] of poses) {
      const b = this.get(i);
      b.body.setTranslation(p, true);
      b.body.setRotation(q, true);
      b.body.setNextKinematicTranslation(p);
      b.body.setNextKinematicRotation(q);
    }
    this.sync();
    return true;
  }
  candidate(id: number) {
    const result = this.findCandidate(id, 0.65, 0.45);
    if (!result) return null;
    const { poses: _poses, ...candidate } = result;
    return candidate;
  }
  private pairCandidate(
    id: number,
    moving: Brick,
    stationary: Brick,
    fromBelow: boolean,
    maxGap: number,
    maxHorizontal: number,
  ) {
    const root = this.get(id);
    const upper = fromBelow ? stationary : moving;
    const lower = fromBelow ? moving : stationary;
    const contact = mating(upper, lower, maxGap, true, maxHorizontal);
    if (!contact) return null;
    // mating gives the upper target with the lower fixed. Invert that
    // rigid transform when holding the lower, keeping the upper in place.
    const delta = fromBelow
      ? upper.rotation.clone().multiply(contact.rotation.clone().invert())
      : contact.rotation.clone().multiply(upper.rotation.clone().invert());
    const position = fromBelow
      ? lower.position
          .clone()
          .sub(contact.position)
          .applyQuaternion(delta)
          .add(upper.position)
      : contact.position;
    const distance = position.distanceToSquared(moving.position);
    const fit: Fit = {
      ...contact,
      position: root.position
        .clone()
        .sub(moving.position)
        .applyQuaternion(delta)
        .add(position),
      rotation: delta.clone().multiply(root.rotation),
    };
    const surfaceFit = fromBelow
      ? {
          ...contact,
          position: upper.position.clone(),
          rotation: upper.rotation.clone(),
        }
      : contact;
    return { upper, lower, stationary, surfaceFit, fit, distance };
  }
  private findCandidate(
    id: number,
    maxGap: number,
    maxHorizontal: number,
    exact = false,
  ) {
    if (!this.held.has(id)) return null;
    let best: {
      upper: Brick;
      lower: Brick;
      stationary: Brick;
      surfaceFit: Fit;
      fit: Fit;
      poses: TargetPoses;
    } | null = null;
    let bestDistance = Infinity;
    // Any held member can supply either sockets (above) or studs (below).
    for (const member of this.held)
      for (const stationary of this.bricks) {
        if (this.held.has(stationary.id)) continue;
        const moving = this.get(member);
        for (const fromBelow of [false, true]) {
          const pair = this.pairCandidate(
            id,
            moving,
            stationary,
            fromBelow,
            maxGap,
            maxHorizontal,
          );
          if (!pair) continue;
          const { upper, lower, surfaceFit, fit, distance } = pair;
          if (distance >= bestDistance) continue;
          const poses = this.sweptPoses(id, fit.position, fit.rotation);
          if (!poses || (exact && !this.clearAt(poses))) continue;
          best = { upper, lower, stationary, surfaceFit, fit, poses };
          bestDistance = distance;
        }
      }
    return best;
  }
  private contactsAt(poses: TargetPoses) {
    const contacts: { a: Brick; b: Brick; studs: number }[] = [];
    for (const [id, { p, q }] of poses) {
      const moving = this.get(id);
      const pose: Pose = { ...moving, position: p, rotation: q };
      for (const stationary of this.bricks) {
        if (poses.has(stationary.id)) continue;
        for (const [upper, lower] of [
          [pose, stationary],
          [stationary, pose],
        ]) {
          const fit = mating(upper, lower, 0.06);
          if (fit && fit.position.distanceTo(upper.position) < 0.04)
            contacts.push({
              a: this.get(upper.id),
              b: this.get(lower.id),
              studs: fit.count,
            });
        }
      }
    }
    return contacts;
  }
  /** Optional wider assistance; the legacy candidate/press thresholds stay fixed. */
  snapCandidate(id: number): SnapCandidate | null {
    const c = this.findCandidate(id, 1, 0.6, true);
    if (!c) return null;
    if (
      !this.contactsAt(c.poses).some(
        (contact) => contact.a.id === c.upper.id && contact.b.id === c.lower.id,
      )
    )
      return null;
    const root = c.poses.get(id)!;
    const rootPose = snapshotPose(id, root.p, root.q);
    const preview: SnapCandidate = Object.freeze({
      rootId: id,
      position: rootPose.position,
      rotation: rootPose.rotation,
      poses: Object.freeze(
        [...c.poses].map(([member, { p, q }]) => snapshotPose(member, p, q)),
      ),
      upperId: c.upper.id,
      lowerId: c.lower.id,
      stationaryId: c.stationary.id,
      studs: c.surfaceFit.count,
    });
    this.snapPreviews.set(preview, {
      kind: "nearby",
      revision: this.holdRevision,
      members: [...this.held].map((member) => this.get(member)),
      stationary: c.stationary,
      anchor: snapshotPose(
        c.stationary.id,
        c.stationary.position,
        c.stationary.rotation,
      ),
      stationaryMembers: [...component(c.stationary.id, this.links)].map(
        (member) => {
          const brick = this.get(member);
          return {
            brick,
            pose: snapshotPose(member, brick.position, brick.rotation),
          };
        },
      ),
      poses: c.poses,
    });
    return preview;
  }
  /** Commit only the displayed target. Validation never searches for a new pair. */
  commitSnap(id: number, preview: SnapCandidate): boolean {
    const saved = this.snapPreviews.get(preview);
    if (
      !saved ||
      preview.rootId !== id ||
      saved.revision !== this.holdRevision ||
      !this.held.has(id) ||
      this.held.size !== saved.members.length ||
      saved.members.some(
        (member) => !this.held.has(member.id) || this.get(member.id) !== member,
      ) ||
      this.get(saved.stationary.id) !== saved.stationary ||
      !samePosition(saved.stationary.position, saved.anchor.position) ||
      !sameRotation(saved.stationary.rotation, saved.anchor.rotation) ||
      saved.stationaryMembers.some(
        ({ brick, pose }) =>
          this.get(brick.id) !== brick ||
          !samePosition(brick.position, pose.position) ||
          !sameRotation(brick.rotation, pose.rotation),
      )
    )
      return false;
    const connected = component(id, this.links);
    if (
      connected.size !== this.held.size ||
      [...connected].some((member) => !this.held.has(member))
    )
      return false;

    const sameSavedPoses = (poses: TargetPoses) =>
      poses.size === saved.poses.size &&
      [...saved.poses].every(([member, target]) => {
        const current = poses.get(member);
        return (
          !!current &&
          samePosition(current.p, target.p) &&
          sameRotation(current.q, target.q)
        );
      });

    let contacts: { a: Brick; b: Brick; studs: number }[];
    if (saved.kind === "lowering") {
      // Projection snaps may start far above the studs. Re-resolve the current
      // lowering guide and require it to lead to the exact hologram that was shown.
      const guide = this.loweringAlignment(id);
      if (
        !guide ||
        guide.memberId !== preview.upperId ||
        guide.lowerId !== preview.lowerId
      )
        return false;
      const target = this.loweringTarget(id, guide);
      const root = target?.poses.get(id);
      if (
        !target ||
        !root ||
        !samePosition(root.p, preview.position) ||
        !sameRotation(root.q, preview.rotation) ||
        !sameSavedPoses(target.poses)
      )
        return false;
      contacts = target.contacts;
    } else {
      const fromBelow = this.held.has(preview.lowerId);
      const moving = this.get(fromBelow ? preview.lowerId : preview.upperId);
      // A final pointer move may arrive between the displayed frame and release.
      // Accept it only when this same pair still resolves to the shown target.
      const pair = this.pairCandidate(
        id,
        moving,
        saved.stationary,
        fromBelow,
        1,
        0.6,
      );
      if (
        !pair ||
        !samePosition(pair.fit.position, preview.position) ||
        !sameRotation(pair.fit.rotation, preview.rotation)
      )
        return false;
      const swept = this.sweptPoses(
        id,
        new T.Vector3().copy(preview.position),
        new T.Quaternion().copy(preview.rotation),
      );
      if (!swept || !sameSavedPoses(swept) || !this.clearAt(saved.poses))
        return false;
      contacts = this.contactsAt(saved.poses);
    }

    if (
      !contacts.some(
        (contact) =>
          contact.a.id === preview.upperId && contact.b.id === preview.lowerId,
      )
    )
      return false;
    // Everything, including all other support contacts, is checked before the
    // first body moves. Use the stored poses so the hologram remains authoritative.
    for (const [member, { p, q }] of saved.poses) {
      const brick = this.get(member);
      brick.body.setTranslation(p, true);
      brick.body.setRotation(q, true);
      brick.body.setNextKinematicTranslation(p);
      brick.body.setNextKinematicRotation(q);
    }
    this.sync();
    for (const contact of contacts)
      this.connect(contact.a, contact.b, contact.studs);
    this.release();
    return true;
  }

  /** Check only occupied height ranges, so a guide high above the scene stays cheap. */
  private clearLowering(poses: TargetPoses, drop: number) {
    const bounds = (box: OBB) => {
      const e = box.rotation.elements;
      const half = box.halfSize;
      const extents = new T.Vector3(
        Math.abs(e[0]) * half.x +
          Math.abs(e[3]) * half.y +
          Math.abs(e[6]) * half.z,
        Math.abs(e[1]) * half.x +
          Math.abs(e[4]) * half.y +
          Math.abs(e[7]) * half.z,
        Math.abs(e[2]) * half.x +
          Math.abs(e[5]) * half.y +
          Math.abs(e[8]) * half.z,
      );
      return {
        min: box.center.clone().sub(extents),
        max: box.center.clone().add(extents),
      };
    };
    const obstacles = this.bricks
      .filter((brick) => !poses.has(brick.id))
      .map((brick) => bounds(this.obb(brick)));
    const intervals: [number, number][] = [[drop, drop]];
    for (const [member, { p, q }] of poses) {
      const moving = bounds(this.obb(this.get(member), p, q));
      for (const obstacle of obstacles) {
        if (
          moving.min.x > obstacle.max.x ||
          moving.max.x < obstacle.min.x ||
          moving.min.z > obstacle.max.z ||
          moving.max.z < obstacle.min.z
        )
          continue;
        const start = Math.max(0, moving.min.y - obstacle.max.y - 0.01);
        const end = Math.min(drop, moving.max.y - obstacle.min.y + 0.01);
        if (start <= end) intervals.push([start, end]);
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const ranges: [number, number][] = [];
    for (const [start, end] of intervals) {
      const previous = ranges.at(-1);
      if (previous && start <= previous[1])
        previous[1] = Math.max(previous[1], end);
      else ranges.push([start, end]);
    }
    for (const [start, end] of ranges) {
      const steps = Math.max(1, Math.ceil((end - start) / 0.15));
      for (let step = 0; step <= steps; step++) {
        const down = start + ((end - start) * step) / steps;
        const sample: TargetPoses = new Map(
          [...poses].map(([member, { p, q }]) => [
            member,
            { p: p.clone().add(new T.Vector3(0, -down, 0)), q },
          ]),
        );
        if (!this.clearAt(sample)) return false;
      }
    }
    return true;
  }
  /**
   * Planar guide independent of Snap. Candidate geometry deliberately mirrors
   * nearby Snap assistance, but it is projected to arbitrary height and still
   * has to pass the complete lowering-path collision check.
   */
  loweringAlignment(id: number): LoweringAlignment | null {
    if (!this.held.has(id)) return null;
    const root = this.get(id);
    const options: (LoweringAlignment & { distance: number })[] = [];
    for (const member of this.held) {
      const moving = this.get(member);
      const movingRadius = Math.hypot(moving.spec.cols, moving.spec.rows) / 2;
      for (const lower of this.bricks) {
        if (
          this.held.has(lower.id) ||
          lower.spec.top === "none" ||
          moving.position.y <= lower.position.y ||
          Math.hypot(
            moving.position.x - lower.position.x,
            moving.position.z - lower.position.z,
          ) >
            movingRadius +
              Math.hypot(lower.spec.cols, lower.spec.rows) / 2 +
              0.6
        )
          continue;
        const fit = loweringFit(moving, lower, 0.6);
        if (!fit) continue;

        // Apply the exact same rigid rotation correction to the whole held
        // component, but perform it at the current height. The remaining move
        // to the connector pose is then a pure world-Y lowering by fit.drop.
        const delta = fit.rotation
          .clone()
          .multiply(moving.rotation.clone().invert())
          .normalize();
        const alignedMoving = new T.Vector3(
          fit.position.x,
          moving.position.y,
          fit.position.z,
        );
        const position = root.position
          .clone()
          .sub(moving.position)
          .applyQuaternion(delta)
          .add(alignedMoving);
        const rotation = delta.clone().multiply(root.rotation).normalize();
        options.push({
          position,
          rotation,
          lowerId: lower.id,
          memberId: member,
          drop: fit.drop,
          distance:
            Math.hypot(
              position.x - root.position.x,
              position.z - root.position.z,
            ) +
            root.rotation.angleTo(rotation) * 0.25,
        });
      }
    }
    options.sort((a, b) => a.distance - b.distance || a.drop - b.drop);
    for (const { distance: _distance, ...option } of options) {
      const aligned = this.sweptPoses(
        id,
        option.position,
        option.rotation,
      );
      if (aligned && this.clearLowering(aligned, option.drop)) return option;
    }
    return null;
  }
  /** Resolve the exact final assembly pose represented by a lowering guide. */
  private loweringTarget(id: number, guide: LoweringAlignment) {
    if (
      !this.held.has(id) ||
      !this.held.has(guide.memberId) ||
      this.held.has(guide.lowerId)
    )
      return null;
    const aligned = this.sweptPoses(id, guide.position, guide.rotation);
    if (!aligned || !this.clearLowering(aligned, guide.drop)) return null;
    const poses: TargetPoses = new Map(
      [...aligned].map(([member, { p, q }]) => [
        member,
        {
          p: p.clone().add(new T.Vector3(0, -guide.drop, 0)),
          q: q.clone(),
        },
      ]),
    );
    const contacts = this.contactsAt(poses);
    const primary = contacts.find(
      (contact) =>
        contact.a.id === guide.memberId && contact.b.id === guide.lowerId,
    );
    if (!primary) return null;
    return { poses, contacts, primary };
  }

  /**
   * Snap-mode companion to the planar lowering guide. Unlike nearby snap,
   * this can preview a connection several units below the held assembly.
   */
  loweringSnapCandidate(
    id: number,
    guide: LoweringAlignment,
  ): SnapCandidate | null {
    const target = this.loweringTarget(id, guide);
    if (!target) return null;
    const stationary = this.get(guide.lowerId);
    const root = target.poses.get(id);
    if (!root) return null;
    const rootPose = snapshotPose(id, root.p, root.q);
    const preview: SnapCandidate = Object.freeze({
      rootId: id,
      position: rootPose.position,
      rotation: rootPose.rotation,
      poses: Object.freeze(
        [...target.poses].map(([member, { p, q }]) =>
          snapshotPose(member, p, q),
        ),
      ),
      upperId: target.primary.a.id,
      lowerId: target.primary.b.id,
      stationaryId: stationary.id,
      studs: target.primary.studs,
    });
    this.snapPreviews.set(preview, {
      kind: "lowering",
      revision: this.holdRevision,
      members: [...this.held].map((member) => this.get(member)),
      stationary,
      anchor: snapshotPose(
        stationary.id,
        stationary.position,
        stationary.rotation,
      ),
      stationaryMembers: [...component(stationary.id, this.links)].map(
        (member) => {
          const brick = this.get(member);
          return {
            brick,
            pose: snapshotPose(member, brick.position, brick.rotation),
          };
        },
      ),
      poses: target.poses,
    });
    return preview;
  }

  connect(a: Brick, b: Brick, studs: number) {
    for (const id of [
      ...component(a.id, this.links),
      ...component(b.id, this.links),
    ])
      this.quietUntil.set(id, this.elapsed + 0.3);
    const anchor = b.position
      .clone()
      .sub(a.position)
      .applyQuaternion(a.rotation.clone().invert());
    const frame = a.rotation.clone().invert().multiply(b.rotation);
    const joint = this.world.createImpulseJoint(
      R.JointData.fixed(
        anchor,
        frame,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      ),
      a.body,
      b.body,
      true,
    );
    joint.setContactsEnabled(false);
    this.links.push({ a: a.id, b: b.id, joint, studs });
  }
  press(id: number) {
    const c = this.candidate(id);
    if (!c) return false;
    if (!this.transform(id, c.fit.position, c.fit.rotation)) return false;
    // A wide brick may engage several independent supports with the same press.
    const contacts: { a: Brick; b: Brick; studs: number }[] = [];
    for (const i of this.held)
      for (const other of this.bricks) {
        if (this.held.has(other.id)) continue;
        const moving = this.get(i);
        // Links always store upper -> lower, regardless of which side is held.
        for (const [upper, lower] of [
          [moving, other],
          [other, moving],
        ]) {
          const fit = mating(upper, lower, 0.06);
          if (fit && fit.position.distanceTo(upper.position) < 0.04)
            contacts.push({ a: upper, b: lower, studs: fit.count });
        }
      }
    if (!contacts.length) return false;
    for (const c of contacts) this.connect(c.a, c.b, c.studs);
    this.release();
    return true;
  }
  detach(link: Connection, _from: number) {
    // Pull one side of a physical interface. Parallel connections across that
    // interface must release together; connections inside either side survive.
    const lower = this.get(link.b),
      normal = new T.Vector3(0, 1, 0).applyQuaternion(lower.rotation);
    const planePoint = lower.position
      .clone()
      .addScaledVector(normal, lower.spec.height / 2);
    const assembly = component(link.a, this.links);
    const signed = (id: number) =>
      this.get(id).position.clone().sub(planePoint).dot(normal);
    const cuts = this.links.filter(
      (l) => assembly.has(l.a) && signed(l.a) * signed(l.b) < 0,
    );
    const remaining = this.links.filter((l) => !cuts.includes(l));
    const side = component(link.a, remaining);
    if (side.has(link.b)) return false;
    let poses = new Map<number, { p: T.Vector3; q: T.Quaternion }>();
    // Validate the entire extraction path, including clearance above the studs.
    for (let step = 1; step <= 8; step++) {
      poses = new Map();
      for (const id of side) {
        const brick = this.get(id);
        poses.set(id, {
          p: brick.position.clone().addScaledVector(normal, step * 0.05),
          q: brick.rotation.clone(),
        });
      }
      if (!this.clearAt(poses)) return false;
    }
    this.release();
    for (const cut of cuts) this.world.removeImpulseJoint(cut.joint, true);
    this.links = remaining;
    this.grab(link.a);
    for (const [i, { p, q }] of poses) {
      const brick = this.get(i);
      brick.body.setTranslation(p, true);
      brick.body.setNextKinematicTranslation(p);
      brick.body.setRotation(q, true);
    }
    this.sync();
    return true;
  }

  remove(id: number) {
    const b = this.get(id);
    if (!b) return;
    this.release();
    for (const l of this.links.filter((l) => l.a === id || l.b === id))
      this.world.removeImpulseJoint(l.joint, true);
    this.links = this.links.filter((l) => l.a !== id && l.b !== id);
    this.world.removeRigidBody(b.body);
    this.scene.remove(b.mesh);
    b.mesh.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
    this.bricks = this.bricks.filter((x) => x !== b);
  }
  clear() {
    for (const b of [...this.bricks]) this.remove(b.id);
  }
  serialize() {
    return {
      version: 1,
      bricks: this.bricks.map((b) => ({
        id: b.id,
        spec: b.spec.id,
        color: b.color,
        p: b.position.toArray(),
        q: b.rotation.toArray(),
      })),
      links: this.links.map((l) => ({ a: l.a, b: l.b, studs: l.studs })),
    };
  }
  restore(data: ReturnType<BrickWorld["serialize"]>) {
    if (
      data.version !== 1 ||
      !Array.isArray(data.bricks) ||
      data.bricks.length > 250
    )
      throw Error("Invalid scene");
    const poses = new Map<number, Pose>();
    for (const b of data.bricks) {
      const spec = catalog.find((s) => s.id === b.spec);
      if (
        !spec ||
        !/^#[0-9a-f]{6}$/i.test(b.color) ||
        !Number.isSafeInteger(b.id) ||
        b.p.length !== 3 ||
        b.q.length !== 4 ||
        ![...b.p, ...b.q].every(Number.isFinite) ||
        b.p.some((n) => Math.abs(n) > 1000) ||
        poses.has(b.id)
      )
        throw Error("Invalid brick");
      const rotation = new T.Quaternion().fromArray(b.q);
      if (rotation.length() < 0.001) throw Error("Invalid rotation");
      poses.set(b.id, {
        id: b.id,
        spec,
        position: new T.Vector3().fromArray(b.p),
        rotation: rotation.normalize(),
      });
    }
    const pairs = new Set<string>();
    if (!Array.isArray(data.links)) throw Error("Invalid links");
    for (const l of data.links) {
      const a = poses.get(l.a),
        b = poses.get(l.b),
        key = [l.a, l.b].sort((a, b) => a - b).join(":");
      if (!a || !b || a === b || pairs.has(key)) throw Error("Invalid link");
      const fit = mating(a, b, 0.08);
      if (!fit || fit.position.distanceTo(a.position) > 0.08)
        throw Error("Invalid connection geometry");
      pairs.add(key);
    }
    this.clear();
    const map = new Map<number, Brick>();
    for (const b of data.bricks) {
      const pose = poses.get(b.id)!;
      map.set(b.id, this.add(pose.spec, b.color, pose.position, pose.rotation));
    }
    for (const l of data.links) {
      const a = map.get(l.a)!,
        b = map.get(l.b)!;
      this.connect(a, b, mating(a, b, 0.08)!.count);
    }
  }
}
