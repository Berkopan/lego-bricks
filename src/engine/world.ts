import R from "@dimforge/rapier3d-compat";
import * as T from "three";
import { OBB } from "three/addons/math/OBB.js";
import { catalog, connectors, type BrickSpec } from "./catalog";
import { component, mating, type Link, type Pose } from "./connections";
import { brickMesh } from "./geometry";
export interface Brick extends Pose {
  body: R.RigidBody;
  mesh: T.Group;
  color: string;
}
export interface Connection extends Link {
  joint: R.ImpulseJoint;
  studs: number;
}
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
    const w = spec.cols - 0.04,
      d = spec.rows - 0.04,
      h = spec.height,
      t = 0.16;
    const box = (
      x: number,
      y: number,
      z: number,
      hx: number,
      hy: number,
      hz: number,
    ) =>
      this.world.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(x, y, z)
          .setFriction(0.55)
          .setRestitution(0.08)
          .setDensity(0.65)
          .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        body,
      );
    box(0, h / 2 - 0.09, 0, w / 2, 0.09, d / 2);
    for (const k of [-1, 1]) {
      box((k * (w - t)) / 2, -0.075, 0, t / 2, (h - 0.15) / 2, d / 2);
      box(0, -0.075, (k * (d - t)) / 2, (w - 2 * t) / 2, (h - 0.15) / 2, t / 2);
    }
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
  clearAt(poses: Map<number, { p: T.Vector3; q: T.Quaternion }>) {
    for (const [id, { p, q }] of poses) {
      const b = this.get(id),
        obb = this.obb(b, p, q);
      const half = obb.halfSize,
        rot = obb.rotation.elements;
      const bottom =
        p.y -
        (Math.abs(rot[1]) * half.x +
          Math.abs(rot[4]) * half.y +
          Math.abs(rot[7]) * half.z);
      if (bottom < -0.01) return false;
      for (const other of this.bricks)
        if (!poses.has(other.id) && obb.intersectsOBB(this.obb(other), 1e-5))
          return false;
    }
    return true;
  }
  transform(id: number, target: T.Vector3, rotation?: T.Quaternion) {
    if (!this.held.has(id)) return false;
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
      if (!this.clearAt(poses)) return false;
    }
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
    if (!this.held.has(id)) return null;
    const upper = this.get(id);
    let best: null | {
      lower: Brick;
      fit: NonNullable<ReturnType<typeof mating>>;
    } = null;
    for (const lower of this.bricks) {
      if (this.held.has(lower.id)) continue;
      const fit = mating(upper, lower);
      if (
        fit &&
        (!best ||
          fit.position.distanceTo(upper.position) <
            best.fit.position.distanceTo(upper.position))
      )
        best = { lower, fit };
    }
    return best;
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
      for (const lower of this.bricks) {
        if (this.held.has(lower.id)) continue;
        const upper = this.get(i),
          fit = mating(upper, lower, 0.06);
        if (fit && fit.position.distanceTo(upper.position) < 0.04)
          contacts.push({ a: upper, b: lower, studs: fit.count });
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
    this.release();
    const b = this.get(id);
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
