import * as T from "three";
import type { BrickSpec } from "../engine/catalog";
import type { Brick, SnapCandidate } from "../engine/world";

interface Ghost {
  source: T.Group;
  spec: string;
  mesh: T.Group;
  edges: T.EdgesGeometry[];
}

const ignoreRaycast = () => {};
const shapeKey = (spec: BrickSpec) =>
  JSON.stringify([
    spec.id,
    spec.cols,
    spec.rows,
    spec.height,
    spec.shape,
    spec.family,
    spec.top,
  ]);

/** A render-only copy of the exact assembly poses offered for release. */
export class SnapHologram {
  private readonly group = new T.Group();
  private readonly ghosts = new Map<number, Ghost>();
  private readonly fill = new T.MeshBasicMaterial({
    color: "#65dfec",
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
  private readonly outline = new T.LineBasicMaterial({
    color: "#53d5e5",
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    toneMapped: false,
  });
  private disposed = false;

  constructor(scene: T.Scene) {
    this.group.name = "snap-preview";
    this.group.visible = false;
    scene.add(this.group);
  }

  get visible() {
    return this.group.visible;
  }

  show(members: readonly Brick[], preview: SnapCandidate) {
    if (this.disposed) return;
    const poses = new Map(preview.poses.map((pose) => [pose.id, pose]));
    if (
      !members.length ||
      poses.size !== members.length ||
      !poses.has(preview.rootId) ||
      members.some((member) => !poses.has(member.id))
    ) {
      this.hide();
      return;
    }

    for (const [id, ghost] of this.ghosts) {
      if (!poses.has(id)) {
        this.removeGhost(ghost);
        this.ghosts.delete(id);
      }
    }
    for (const member of members) {
      const spec = shapeKey(member.spec);
      let ghost = this.ghosts.get(member.id);
      if (!ghost || ghost.source !== member.mesh || ghost.spec !== spec) {
        if (ghost) this.removeGhost(ghost);
        ghost = this.createGhost(member, spec);
        this.ghosts.set(member.id, ghost);
        this.group.add(ghost.mesh);
      }
      const pose = poses.get(member.id)!;
      ghost.mesh.position.copy(pose.position);
      ghost.mesh.quaternion.copy(pose.rotation);
      ghost.mesh.scale.copy(member.mesh.scale);
    }
    this.group.visible = true;
  }

  hide() {
    // Keep geometry cached while a candidate briefly leaves the snap range.
    this.group.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.hide();
    this.group.removeFromParent();
    for (const ghost of this.ghosts.values()) this.removeGhost(ghost);
    this.ghosts.clear();
    this.fill.dispose();
    this.outline.dispose();
    this.disposed = true;
  }

  private createGhost(member: Brick, spec: string): Ghost {
    const edges: T.EdgesGeometry[] = [];
    const copy = (source: T.Object3D): T.Object3D => {
      // Object3D.clone copies userData, whose brick reference is cyclic. Only
      // visual state belongs here; all body, selection and picking data stays out.
      let target: T.Object3D;
      if (source instanceof T.Mesh) {
        target = new T.Mesh(source.geometry, this.fill);
        const geometry = new T.EdgesGeometry(source.geometry, 28);
        edges.push(geometry);
        const outline = new T.LineSegments(geometry, this.outline);
        outline.renderOrder = 21;
        outline.raycast = ignoreRaycast;
        target.add(outline);
      } else target = new T.Group();
      target.position.copy(source.position);
      target.quaternion.copy(source.quaternion);
      target.scale.copy(source.scale);
      target.matrix.copy(source.matrix);
      target.matrixAutoUpdate = source.matrixAutoUpdate;
      target.visible = source.visible;
      target.renderOrder = 20;
      target.raycast = ignoreRaycast;
      for (const child of source.children) target.add(copy(child));
      return target;
    };
    const mesh = new T.Group();
    mesh.name = `snap-preview-brick-${member.id}`;
    for (const child of member.mesh.children) mesh.add(copy(child));
    return { source: member.mesh, spec, mesh, edges };
  }

  private removeGhost(ghost: Ghost) {
    ghost.mesh.removeFromParent();
    // Fill geometries and original materials are owned by the live bricks.
    for (const geometry of ghost.edges) geometry.dispose();
  }
}
