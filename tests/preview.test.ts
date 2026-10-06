import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { catalog } from "../src/engine/catalog";
import { brickMesh } from "../src/engine/geometry";
import type { Brick, SnapCandidate } from "../src/engine/world";
import { SnapHologram } from "../src/scene/snap-preview";

function brick(
  id: number,
  position = new T.Vector3(),
  rotation = new T.Quaternion(),
  spec = catalog[0],
): Brick {
  const result: Brick = {
    id,
    spec,
    position,
    rotation,
    mesh: brickMesh(spec, "#df553e"),
    color: "#df553e",
    body: {} as Brick["body"],
  };
  result.mesh.position.copy(position);
  result.mesh.quaternion.copy(rotation);
  result.mesh.userData.brick = result;
  return result;
}

function meshes(root: T.Object3D) {
  const result: T.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof T.Mesh) result.push(object);
  });
  return result;
}

function edges(root: T.Object3D) {
  const result: T.LineSegments<T.EdgesGeometry, T.LineBasicMaterial>[] = [];
  root.traverse((object) => {
    if (object instanceof T.LineSegments) result.push(object);
  });
  return result;
}

function disposeBricks(bricks: Brick[]) {
  const materials = new Set<T.Material>();
  for (const brick of bricks)
    for (const mesh of meshes(brick.mesh)) {
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        materials.add(material);
    }
  for (const material of materials) material.dispose();
}

function preview(
  members: Brick[],
  position = new T.Vector3(0, 1.8, 0),
  rotation = new T.Quaternion(),
): SnapCandidate {
  const root = members[0];
  const delta = rotation.clone().multiply(root.rotation.clone().invert());
  const coordinates = ({ x, y, z }: T.Vector3) => Object.freeze({ x, y, z });
  const quaternion = ({ x, y, z, w }: T.Quaternion) =>
    Object.freeze({ x, y, z, w });
  return Object.freeze({
    rootId: root.id,
    position: coordinates(position),
    rotation: quaternion(rotation),
    poses: Object.freeze(
      members.map((member) =>
        Object.freeze({
          id: member.id,
          position: coordinates(
            member.position
              .clone()
              .sub(root.position)
              .applyQuaternion(delta)
              .add(position),
          ),
          rotation: quaternion(delta.clone().multiply(member.rotation)),
        }),
      ),
    ),
    upperId: root.id,
    lowerId: 999,
    stationaryId: 999,
    studs: 2,
  });
}

test("hologram shows the complete saved assembly pose using the actual brick geometry", (t) => {
  const scene = new T.Scene();
  const hologram = new SnapHologram(scene);
  const root = brick(
    1,
    new T.Vector3(3, 4, 6),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.35),
  );
  const member = brick(
    2,
    new T.Vector3(1, 1.2, -0.5)
      .applyQuaternion(root.rotation)
      .add(root.position),
    root.rotation
      .clone()
      .multiply(
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.4),
      ),
    catalog.find((spec) => spec.id === "slope-2x2")!,
  );
  const members = [root, member];
  t.after(() => {
    hologram.dispose();
    disposeBricks(members);
  });
  const candidate = preview(
    members,
    new T.Vector3(-2, 1.8, 3),
    new T.Quaternion().setFromEuler(new T.Euler(0.25, Math.PI / 2, 0)),
  );
  // A preview is a saved promise: source motion must not move its target poses.
  root.position.x += 10;
  member.position.y += 10;
  const livePositions = members.map((member) => member.position.clone());
  assert.equal(hologram.visible, false);
  hologram.show(members, candidate);
  assert.equal(hologram.visible, true);
  const group = scene.getObjectByName("snap-preview")!;
  assert.equal(group.children.length, 2);
  for (const [index, member] of members.entries()) {
    const ghost = group.getObjectByName(`snap-preview-brick-${member.id}`)!;
    const pose = candidate.poses.find((pose) => pose.id === member.id)!;
    assert.ok(
      ghost.position.distanceTo(new T.Vector3().copy(pose.position)) < 1e-9,
    );
    assert.ok(
      ghost.quaternion.angleTo(new T.Quaternion().copy(pose.rotation)) < 1e-7,
    );
    const originalMeshes = meshes(member.mesh);
    const ghostMeshes = meshes(ghost);
    assert.equal(ghostMeshes.length, originalMeshes.length);
    ghostMeshes.forEach((mesh, index) => {
      assert.equal(mesh.geometry, originalMeshes[index].geometry);
      assert.notEqual(mesh.material, originalMeshes[index].material);
      assert.ok(mesh.material instanceof T.MeshBasicMaterial);
      assert.equal(mesh.material.transparent, true);
      assert.equal(mesh.material.depthWrite, false);
      assert.ok(mesh.material.opacity > 0 && mesh.material.opacity < 0.25);
      assert.equal(mesh.castShadow, false);
      assert.equal(mesh.receiveShadow, false);
      assert.equal(mesh.userData.brick, undefined);
    });
    assert.equal(edges(ghost).length, originalMeshes.length);
    assert.ok(member.position.equals(livePositions[index]));
    assert.equal(member.mesh.userData.brick, member);
  }
  scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(
    new T.Vector3(-2, 10, 3),
    new T.Vector3(0, -1, 0),
  );
  assert.equal(ray.intersectObject(group, true).length, 0);
});

test("candidate updates reuse ghosts and cleanup only disposes owned render resources", (t) => {
  const scene = new T.Scene();
  const hologram = new SnapHologram(scene);
  const members = [brick(1), brick(2, new T.Vector3(0, 1.2, 0))];
  t.after(() => {
    hologram.dispose();
    disposeBricks(members);
  });
  let sourceDisposals = 0;
  for (const member of members)
    for (const mesh of meshes(member.mesh)) {
      mesh.geometry.addEventListener("dispose", () => sourceDisposals++);
      (mesh.material as T.Material).addEventListener(
        "dispose",
        () => sourceDisposals++,
      );
    }
  hologram.show(members, preview(members));
  const group = scene.getObjectByName("snap-preview")!;
  const [first, second] = group.children;
  const removedEdges = edges(second);
  let removedDisposals = 0;
  for (const edge of removedEdges)
    edge.geometry.addEventListener("dispose", () => removedDisposals++);
  const fill = meshes(first)[0].material as T.Material;
  const outline = edges(first)[0].material;
  let materialDisposals = 0;
  fill.addEventListener("dispose", () => materialDisposals++);
  outline.addEventListener("dispose", () => materialDisposals++);

  hologram.hide();
  assert.equal(hologram.visible, false);
  assert.equal(group.children.length, 2);
  hologram.show(
    [...members].reverse(),
    preview(members, new T.Vector3(2, 3, 4)),
  );
  assert.equal(group.children[0], first);
  assert.equal(group.children[1], second);
  assert.ok(first.position.equals(new T.Vector3(2, 3, 4)));
  assert.equal(removedDisposals, 0);

  hologram.show([members[0]], preview([members[0]]));
  assert.equal(group.children.length, 1);
  assert.equal(group.children[0], first);
  assert.equal(removedDisposals, removedEdges.length);
  assert.equal(sourceDisposals, 0);
  assert.equal(materialDisposals, 0);

  const replacedEdges = edges(first);
  let replacedDisposals = 0;
  for (const edge of replacedEdges)
    edge.geometry.addEventListener("dispose", () => replacedDisposals++);
  members[0].spec = { ...members[0].spec, id: "updated-spec" };
  hologram.show([members[0]], preview([members[0]]));
  assert.notEqual(group.children[0], first);
  assert.equal(replacedDisposals, replacedEdges.length);
  const finalEdges = edges(group);
  let finalDisposals = 0;
  for (const edge of finalEdges)
    edge.geometry.addEventListener("dispose", () => finalDisposals++);

  hologram.dispose();
  hologram.dispose();
  hologram.show(members, preview(members));
  assert.equal(hologram.visible, false);
  assert.equal(scene.getObjectByName("snap-preview"), undefined);
  assert.equal(finalDisposals, finalEdges.length);
  assert.equal(removedDisposals, removedEdges.length);
  assert.equal(replacedDisposals, replacedEdges.length);
  assert.equal(materialDisposals, 2);
  assert.equal(sourceDisposals, 0);
});

test("an incomplete or mismatched snapshot hides the hologram instead of showing a partial assembly", (t) => {
  const scene = new T.Scene();
  const hologram = new SnapHologram(scene);
  const members = [brick(1), brick(2)];
  t.after(() => {
    hologram.dispose();
    disposeBricks(members);
  });
  const candidate = preview(members);
  hologram.show(members, candidate);
  assert.equal(hologram.visible, true);
  hologram.show([members[0]], candidate);
  assert.equal(hologram.visible, false);
  hologram.show(members, candidate);
  hologram.show(members, { ...candidate, rootId: 999 });
  assert.equal(hologram.visible, false);
  hologram.show(members, candidate);
  hologram.show([], candidate);
  assert.equal(hologram.visible, false);
});
