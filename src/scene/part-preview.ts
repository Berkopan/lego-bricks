import * as T from "three";
import { brickMesh } from "../engine/geometry";
import type { BrickSpec } from "../engine/catalog";
/** One reused context, cached images, the same geometry as the actual workspace. */
export function partPreviews() {
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(220, 130);
  renderer.setClearColor(0, 0);
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xffffff, 0x777766, 2));
  const light = new T.DirectionalLight(0xffffff, 3);
  light.position.set(-3, 8, 5);
  scene.add(light);
  const camera = new T.OrthographicCamera(-3, 3, 1.8, -1.8, 0.1, 50);
  camera.position.set(5, 5, 7);
  camera.lookAt(0, 0, 0);
  const cache = new Map<string, string>();
  return (spec: BrickSpec, color: string) => {
    const key = spec.id + color;
    if (cache.has(key)) return cache.get(key)!;
    const mesh = brickMesh(spec, color);
    scene.add(mesh);
    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL();
    cache.set(key, image);
    scene.remove(mesh);
    const materials = new Set<T.Material>();
    mesh.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        materials.add(o.material);
      }
    });
    materials.forEach((m) => m.dispose());
    return image;
  };
}
