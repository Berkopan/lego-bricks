import { Plane, Ray, Vector3 } from "three";
/** Project against the gesture's original plane, independent of lift height. */
export function dragTarget(
  ray: Ray,
  plane: Plane,
  offset: Vector3,
  height: number,
) {
  const hit = ray.intersectPlane(plane, new Vector3());
  if (!hit) return null;
  hit.add(offset);
  hit.y = height;
  return hit;
}
