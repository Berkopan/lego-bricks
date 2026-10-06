import * as T from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { BrickSpec } from "../engine/catalog";
import { brickMesh } from "../engine/geometry";
import type { ManualBrick } from "./plan";

export interface ManualTransform {
  /** Source-world origin of the illustrated build frame. */
  origin: T.Vector3;
  /** Source world -> illustrated frame (inverse of an assembly's rotation). */
  rotation: T.Quaternion;
}

export interface ManualRenderRequest {
  ids: readonly number[];
  highlightIds?: readonly number[];
  width: number;
  height: number;
  /** Include the completed assembly here to keep every step at the same scale. */
  frameIds?: readonly number[];
  viewpoint?: "assembly" | "top" | "front" | "detail" | "world";
  transform?: ManualTransform;
  /** Optional camera direction, expressed in the illustrated build frame. */
  direction?: T.Vector3;
  padding?: number;
  grid?: boolean;
  /** Optional exploded-view offsets, expressed in source-world coordinates. */
  offsets?: ReadonlyMap<number, T.Vector3>;
}

export interface ManualAnchor {
  x: number;
  y: number;
  /** Inside the image bounds; this does not imply visibility through other parts. */
  visible: boolean;
}

export interface ManualRenderResult {
  /** Reused between calls. Copy or encode this canvas before the next render. */
  canvas: HTMLCanvasElement;
  anchors: Map<number, ManualAnchor>;
  /** Projects source-world coordinates using this result's saved camera. */
  project: (point: T.Vector3) => ManualAnchor;
  pixelsPerUnit: number;
}

interface GeometryPart {
  geometry: T.BufferGeometry;
  edges?: LineSegmentsGeometry;
  matrix: T.Matrix4;
}

interface GeometryTemplate {
  parts: GeometryPart[];
  corners: T.Vector3[];
  outline?: LineSegmentsGeometry;
}

interface BrickIllustration {
  group: T.Group;
  fills: T.Mesh<T.BufferGeometry, T.MeshLambertMaterial>[];
  outlines: LineSegments2[];
}

const ordinaryDirection = new T.Vector3(8, 7, 10).normalize();
const paper = new T.Color("#f7f6f2");
const identityRotation = new T.Quaternion();
const zero = new T.Vector3();

function corners(box: T.Box3) {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new T.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ),
  );
}

/**
 * Compound collision solids are also the special parts' render meshes. Drawing
 * every solid edge would invent ribs on cylinders and seams across arch faces.
 * Outline their continuous external profile instead; fills still come directly
 * from brickMesh, including all cavities, curves and studs.
 */
function specialOutline(spec: BrickSpec) {
  if (!spec.shape) return undefined;
  const positions: number[] = [];
  const segment = (a: T.Vector3, b: T.Vector3) => {
    if (a.distanceToSquared(b) > 1e-12)
      positions.push(...a.toArray(), ...b.toArray());
  };
  const loop = (points: T.Vector3[]) =>
    points.forEach((point, i) =>
      segment(point, points[(i + 1) % points.length]),
    );
  const w = spec.cols - 0.04;
  const d = spec.rows - 0.04;
  const bottom = -spec.height / 2;
  const top = spec.height / 2;
  if (spec.shape === "round") {
    for (const [radius, y] of [
      [0.48, bottom],
      [0.48, top],
      [0.33, bottom],
      [0.33, top - 0.16],
    ])
      loop(
        Array.from({ length: 48 }, (_, i) => {
          const angle = (i * Math.PI * 2) / 48;
          return new T.Vector3(
            Math.cos(angle) * radius,
            y,
            Math.sin(angle) * radius,
          );
        }),
      );
  } else if (spec.shape === "corner") {
    const perimeter = [
      [-0.98, -0.98],
      [0.98, -0.98],
      [0.98, 0],
      [0, 0],
      [0, 0.98],
      [-0.98, 0.98],
    ];
    for (const y of [bottom, top])
      loop(perimeter.map(([x, z]) => new T.Vector3(x, y, z)));
    for (const [x, z] of perimeter)
      segment(new T.Vector3(x, bottom, z), new T.Vector3(x, top, z));
  } else if (spec.shape === "slope") {
    const back = -d / 2;
    const front = d / 2;
    const plateau = spec.top === "back" ? back + 0.94 : back;
    const perimeter = [
      [bottom, back],
      [top, back],
      [top, plateau],
      [bottom + 0.4, front],
      [bottom, front],
    ];
    for (const x of [-w / 2, w / 2])
      loop(perimeter.map(([y, z]) => new T.Vector3(x, y, z)));
    for (const [y, z] of perimeter)
      segment(new T.Vector3(-w / 2, y, z), new T.Vector3(w / 2, y, z));
  } else {
    const perimeter = [
      [-w / 2, bottom],
      [-w / 2, top],
      [w / 2, top],
      [w / 2, bottom],
      ...Array.from({ length: 17 }, (_, i) => {
        const x = 1.02 - (i * 2.04) / 16;
        return [x, bottom + 0.9 * Math.sqrt(Math.max(0, 1 - (x / 1.02) ** 2))];
      }),
    ];
    for (const z of [-d / 2, d / 2])
      loop(perimeter.map(([x, y]) => new T.Vector3(x, y, z)));
    for (const [x, y] of [
      ...perimeter.slice(0, 4),
      [1.02, bottom],
      [-1.02, bottom],
    ])
      segment(new T.Vector3(x, y, -d / 2), new T.Vector3(x, y, d / 2));
  }
  return new LineSegmentsGeometry().setPositions(positions);
}

/**
 * Fit actual transformed geometry in camera space, not just its world X/Z span.
 * The camera's direction and up vector are retained. Tall and rotated assemblies
 * consequently remain inside both the image and the depth clipping planes.
 */
export function fitManualCamera(
  camera: T.OrthographicCamera,
  points: readonly T.Vector3[],
  width: number,
  height: number,
  padding = 0.12,
) {
  if (!(width > 0 && height > 0) || !points.length)
    throw new Error("Cannot frame an empty manual illustration");
  const bounds = new T.Box3().setFromPoints([...points]);
  const center = bounds.getCenter(new T.Vector3());
  const radius = Math.max(1, bounds.getSize(new T.Vector3()).length() / 2);
  const direction = camera.getWorldDirection(new T.Vector3()).negate();
  camera.position.copy(center).addScaledVector(direction, radius * 3 + 10);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const view = new T.Box3().setFromPoints(
    points.map((point) =>
      point.clone().applyMatrix4(camera.matrixWorldInverse),
    ),
  );
  const margin = 1 + 2 * T.MathUtils.clamp(padding, 0.02, 0.5);
  const aspect = width / height;
  const viewHeight = Math.max(
    0.7,
    (view.max.y - view.min.y) * margin,
    ((view.max.x - view.min.x) * margin) / aspect,
  );
  const viewWidth = viewHeight * aspect;
  const cx = (view.min.x + view.max.x) / 2;
  const cy = (view.min.y + view.max.y) / 2;
  camera.left = cx - viewWidth / 2;
  camera.right = cx + viewWidth / 2;
  camera.top = cy + viewHeight / 2;
  camera.bottom = cy - viewHeight / 2;
  camera.near = Math.max(0.01, -view.max.z - radius - 1);
  camera.far = Math.max(camera.near + 1, -view.min.z + radius + 1);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  return height / viewHeight;
}

/**
 * One isolated WebGL context for the entire PDF. Geometry is built from the same
 * brickMesh factory as the workspace and shared by shape, never borrowed from or
 * attached to the live world. All input poses are cloned before illustration.
 */
export class ManualRenderer {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly model = new T.Group();
  private readonly camera = new T.OrthographicCamera();
  private readonly bricks = new Map<number, ManualBrick>();
  private readonly templates = new Map<string, GeometryTemplate>();
  private readonly illustrations = new Map<number, BrickIllustration>();
  private readonly fills = new Map<string, T.MeshLambertMaterial>();
  private readonly lines = new Map<string, LineMaterial>();
  private thumbnailIllustration?: BrickIllustration;
  private grid?: T.LineSegments<T.BufferGeometry, T.LineBasicMaterial>;
  private disposed = false;
  private contextLost = false;
  private readonly onContextLost = () => {
    this.contextLost = true;
  };

  constructor(bricks: readonly ManualBrick[]) {
    for (const brick of bricks) {
      if (this.bricks.has(brick.id))
        throw new Error("Duplicate brick in manual illustration");
      this.bricks.set(brick.id, {
        ...brick,
        spec: { ...brick.spec },
        position: brick.position.clone(),
        rotation: brick.rotation.clone(),
      });
    }
    try {
      this.renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
      });
    } catch {
      throw new Error("A WebGL context could not be created for the manual");
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.NoToneMapping;
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.scene.add(this.model);
    // Broad, neutral lighting describes each shape without photographic glare.
    this.scene.add(new T.HemisphereLight(0xffffff, 0xc3c8d0, 2.15));
    const key = new T.DirectionalLight(0xffffff, 2.15);
    key.position.set(-5, 12, 8);
    this.scene.add(key);
    const fill = new T.DirectionalLight(0xffffff, 0.35);
    fill.position.set(8, 3, -4);
    this.scene.add(fill);
  }

  private checkContext() {
    if (this.disposed) throw new Error("The manual renderer has been disposed");
    if (this.contextLost || this.renderer.getContext().isContextLost())
      throw new Error("The WebGL context was lost while rendering the manual");
  }

  private template(spec: BrickSpec) {
    // Include geometry attributes rather than assuming an ID defines a shape.
    const key = JSON.stringify([
      spec.id,
      spec.cols,
      spec.rows,
      spec.height,
      spec.shape,
      spec.top,
    ]);
    const cached = this.templates.get(key);
    if (cached) return cached;
    const mesh = brickMesh(spec, "#ffffff");
    mesh.updateMatrixWorld(true);
    const parts: GeometryPart[] = [];
    const materials = new Set<T.Material>();
    const bounds = new T.Box3();
    mesh.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      object.geometry.computeBoundingBox();
      bounds.union(
        object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld),
      );
      let edges: LineSegmentsGeometry | undefined;
      if (!spec.shape || object.geometry.type === "CylinderGeometry") {
        const thinEdges = new T.EdgesGeometry(object.geometry, 35);
        edges = new LineSegmentsGeometry().fromEdgesGeometry(thinEdges);
        thinEdges.dispose();
      }
      parts.push({
        geometry: object.geometry,
        edges,
        matrix: object.matrixWorld.clone(),
      });
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    });
    materials.forEach((material) => material.dispose());
    const template = {
      parts,
      corners: corners(bounds),
      outline: specialOutline(spec),
    };
    this.templates.set(key, template);
    return template;
  }

  private fill(color: string, previous: boolean) {
    const key = `${color}:${previous}`;
    let material = this.fills.get(key);
    if (!material) {
      const shade = new T.Color(color);
      if (previous) shade.lerp(paper, 0.5);
      material = new T.MeshLambertMaterial({
        color: shade,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      this.fills.set(key, material);
    }
    return material;
  }

  private line(mode: "normal" | "previous" | "new") {
    let material = this.lines.get(mode);
    if (!material) {
      material = new LineMaterial({
        color:
          mode === "new" ? 0xc38b08 : mode === "previous" ? 0x8b979d : 0x36434c,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        alphaToCoverage: true,
      });
      this.lines.set(mode, material);
    }
    return material;
  }

  private illustration(spec: BrickSpec, color: string) {
    const group = new T.Group();
    const fills: BrickIllustration["fills"] = [];
    const outlines: BrickIllustration["outlines"] = [];
    const template = this.template(spec);
    for (const part of template.parts) {
      const fill = new T.Mesh(part.geometry, this.fill(color, false));
      fill.applyMatrix4(part.matrix);
      group.add(fill);
      fills.push(fill);
      if (part.edges) {
        const edge = new LineSegments2(part.edges, this.line("normal"));
        edge.applyMatrix4(part.matrix);
        edge.renderOrder = 1;
        group.add(edge);
        outlines.push(edge);
      }
    }
    if (template.outline) {
      const edge = new LineSegments2(template.outline, this.line("normal"));
      edge.renderOrder = 1;
      group.add(edge);
      outlines.push(edge);
    }
    return { group, fills, outlines };
  }

  private point(source: T.Vector3, transform?: ManualTransform): T.Vector3 {
    return source
      .clone()
      .sub(transform?.origin ?? zero)
      .applyQuaternion(transform?.rotation ?? identityRotation);
  }

  private framePoints(request: ManualRenderRequest) {
    const points: T.Vector3[] = [];
    // Exploded parts must still fit when frameIds describes the resting model.
    const ids = new Set([...(request.frameIds ?? request.ids), ...request.ids]);
    for (const id of ids) {
      const brick = this.bricks.get(id);
      if (!brick) throw new Error("Unknown brick in manual illustration");
      for (const corner of this.template(brick.spec).corners) {
        const point = corner
          .clone()
          .applyQuaternion(brick.rotation)
          .add(brick.position);
        points.push(this.point(point, request.transform));
        const offset = request.offsets?.get(id);
        if (offset)
          points.push(this.point(point.add(offset), request.transform));
      }
    }
    return points;
  }

  private reset() {
    for (const illustration of this.illustrations.values())
      illustration.group.visible = false;
    if (this.thumbnailIllustration)
      this.thumbnailIllustration.group.visible = false;
    if (this.grid) this.grid.visible = false;
  }

  private setGrid(points: readonly T.Vector3[]) {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    const bounds = new T.Box3().setFromPoints([...points]);
    const spacing = Math.max(
      1,
      Math.ceil(
        Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) /
          100,
      ),
    );
    const left = Math.floor(bounds.min.x / spacing - 1) * spacing;
    const right = Math.ceil(bounds.max.x / spacing + 1) * spacing;
    const back = Math.floor(bounds.min.z / spacing - 1) * spacing;
    const front = Math.ceil(bounds.max.z / spacing + 1) * spacing;
    const y = bounds.min.y - 0.03;
    const gridPoints: T.Vector3[] = [];
    for (let x = left; x <= right; x += spacing)
      gridPoints.push(new T.Vector3(x, y, back), new T.Vector3(x, y, front));
    for (let z = back; z <= front; z += spacing)
      gridPoints.push(new T.Vector3(left, y, z), new T.Vector3(right, y, z));
    this.grid = new T.LineSegments(
      new T.BufferGeometry().setFromPoints(gridPoints),
      new T.LineBasicMaterial({ color: 0xe1e6e9, toneMapped: false }),
    );
    this.scene.add(this.grid);
  }

  private draw(
    points: readonly T.Vector3[],
    width: number,
    height: number,
    direction: T.Vector3,
    top: boolean,
    padding: number,
  ) {
    this.checkContext();
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 1 ||
      height < 1 ||
      width > 4096 ||
      height > 4096
    )
      throw new Error("Invalid manual illustration size");
    width = Math.round(width);
    height = Math.round(height);
    this.renderer.setSize(width, height, false);
    for (const [mode, material] of this.lines) {
      material.resolution.set(width, height);
      material.linewidth =
        Math.max(1, Math.min(width, height) / 520) *
        (mode === "new" ? 2.3 : 1.1);
    }
    this.camera.up.set(0, top ? 0 : 1, top ? -1 : 0);
    this.camera.position.copy(direction);
    this.camera.lookAt(zero);
    const pixelsPerUnit = fitManualCamera(
      this.camera,
      points,
      width,
      height,
      padding,
    );
    this.scene.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
    this.checkContext();
    return { width, height, pixelsPerUnit };
  }

  render(request: ManualRenderRequest): ManualRenderResult {
    this.checkContext();
    this.reset();
    const highlights = new Set(request.highlightIds ?? []);
    const withHighlights = highlights.size > 0;
    for (const id of request.ids) {
      const brick = this.bricks.get(id);
      if (!brick) throw new Error("Unknown brick in manual illustration");
      let illustration = this.illustrations.get(id);
      if (!illustration) {
        illustration = this.illustration(brick.spec, brick.color);
        this.illustrations.set(id, illustration);
        this.model.add(illustration.group);
      }
      const previous = withHighlights && !highlights.has(id);
      const material = this.fill(brick.color, previous);
      const line = this.line(
        previous ? "previous" : highlights.has(id) ? "new" : "normal",
      );
      for (const fill of illustration.fills) fill.material = material;
      for (const edge of illustration.outlines) edge.material = line;
      illustration.group.position.copy(brick.position);
      illustration.group.position.add(request.offsets?.get(id) ?? zero);
      illustration.group.quaternion.copy(brick.rotation);
      illustration.group.visible = true;
    }
    this.model.quaternion.copy(request.transform?.rotation ?? identityRotation);
    this.model.position
      .copy(request.transform?.origin ?? zero)
      .negate()
      .applyQuaternion(this.model.quaternion);
    const points = this.framePoints(request);
    if (!points.length)
      throw new Error("Cannot render an empty manual illustration");
    if (request.grid) this.setGrid(points);
    const top = request.viewpoint === "top";
    let direction = top
      ? new T.Vector3(0, 1, 0)
      : request.viewpoint === "front"
        ? new T.Vector3(0, 0, 1)
        : ordinaryDirection.clone();
    if (request.viewpoint === "detail" && highlights.size) {
      // Detail insets can look from the insertion's side. Main assembly views
      // retain one camera direction throughout the manual.
      const center = new T.Box3()
        .setFromPoints(points)
        .getCenter(new T.Vector3());
      const added = new T.Vector3();
      let count = 0;
      for (const id of highlights) {
        const brick = this.bricks.get(id);
        if (brick) {
          added.add(this.point(brick.position, request.transform));
          count++;
        }
      }
      if (count) {
        added.divideScalar(count).sub(center);
        direction.x *= added.x < -0.1 ? -1 : 1;
        direction.z *= added.z < -0.1 ? -1 : 1;
      }
    }
    if (request.direction && request.direction.lengthSq() > 1e-8)
      direction = request.direction.clone().normalize();
    const result = this.draw(
      points,
      request.width,
      request.height,
      direction,
      top,
      request.padding ?? 0.12,
    );
    const sourceToFrame = new T.Matrix4().makeRotationFromQuaternion(
      request.transform?.rotation ?? identityRotation,
    );
    sourceToFrame.setPosition(this.point(zero, request.transform));
    const projection = new T.Matrix4()
      .multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      )
      .multiply(sourceToFrame);
    // Capture matrices and dimensions rather than the camera that the next page
    // will reuse; annotations remain correct even after another view is rendered.
    const project = (point: T.Vector3): ManualAnchor => {
      const p = point.clone().applyMatrix4(projection);
      return {
        x: ((p.x + 1) / 2) * result.width,
        y: ((1 - p.y) / 2) * result.height,
        visible: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1,
      };
    };
    const anchors = new Map<number, ManualAnchor>();
    for (const id of request.ids) {
      const position = this.bricks.get(id)!.position.clone();
      position.add(request.offsets?.get(id) ?? zero);
      anchors.set(id, project(position));
    }
    return {
      canvas: this.renderer.domElement,
      anchors,
      project,
      pixelsPerUnit: result.pixelsPerUnit,
    };
  }

  thumbnail(spec: BrickSpec, color: string, width = 240, height = 170) {
    this.checkContext();
    this.reset();
    if (this.thumbnailIllustration)
      this.model.remove(this.thumbnailIllustration.group);
    this.thumbnailIllustration = this.illustration(spec, color);
    this.model.add(this.thumbnailIllustration.group);
    this.model.position.set(0, 0, 0);
    this.model.quaternion.identity();
    this.draw(
      this.template(spec).corners,
      width,
      height,
      ordinaryDirection,
      false,
      0.1,
    );
    return this.renderer.domElement;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    for (const template of this.templates.values()) {
      for (const part of template.parts) {
        part.geometry.dispose();
        part.edges?.dispose();
      }
      template.outline?.dispose();
    }
    this.templates.clear();
    for (const material of this.fills.values()) material.dispose();
    for (const material of this.lines.values()) material.dispose();
    this.fills.clear();
    this.lines.clear();
    this.grid?.geometry.dispose();
    this.grid?.material.dispose();
    this.model.clear();
    this.scene.clear();
    this.bricks.clear();
    this.illustrations.clear();
    this.renderer.dispose();
    // A download may be repeated many times; release the browser's context slot.
    if (!this.renderer.getContext().isContextLost())
      this.renderer.forceContextLoss();
    this.renderer.domElement.width = 1;
    this.renderer.domElement.height = 1;
  }
}
