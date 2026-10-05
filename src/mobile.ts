import * as T from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Language } from "./i18n";
import { bindRepeatActions, bindTouchGestures, type TouchActions } from "./input/touch";

const labels = {
  en: {
    build: "Build", camera: "Camera", tools: "Tools", hide: "Hide tools",
    zoomIn: "Zoom in", zoomOut: "Zoom out", controls: "Touch controls",
    buildHint: "Drag a brick to move it · two fingers to pan / zoom",
    cameraHint: "Drag anywhere to orbit · two fingers to pan / zoom",
    rotateX: "Rotate around X", rotateY: "Rotate around Y", rotateZ: "Rotate around Z",
    move: "Fine position", left: "Move left", right: "Move right",
    forward: "Move away", back: "Move closer", up: "Lift brick", down: "Lower brick",
    ready: "Aligned · tap Press to connect",
    demoHint: "The red brick is ready. Tap Press to connect.",
    help: "In Build mode, tap a brick to select it and drag to move it. Drag empty space to orbit, or switch to Camera to orbit even over bricks. Use two fingers together to pan, and pinch to zoom. Lift both fingers after a pinch before moving a brick again. Open Tools for X / Y / Z rotations, height and fine positioning. Hold a height or arrow button to keep moving. When green, tap Press to connect. Select a connection in the list and tap Separate to detach it. Release, delete, save and open are also available without a keyboard.",
  },
  tr: {
    build: "Parça", camera: "Kamera", tools: "Araçlar", hide: "Araçları gizle",
    zoomIn: "Yakınlaştır", zoomOut: "Uzaklaştır", controls: "Dokunmatik kontroller",
    buildHint: "Parçayı sürükle · iki parmakla kaydır / yakınlaştır",
    cameraHint: "Her yerde sürükleyerek dön · iki parmakla kaydır / yakınlaştır",
    rotateX: "X ekseninde döndür", rotateY: "Y ekseninde döndür", rotateZ: "Z ekseninde döndür",
    move: "Hassas konum", left: "Sola taşı", right: "Sağa taşı",
    forward: "İleri taşı", back: "Geri taşı", up: "Parçayı yükselt", down: "Parçayı alçalt",
    ready: "Hizalandı · birleştirme düğmesine dokun",
    demoHint: "Kırmızı parça hazır. Birleştirme düğmesine dokun.",
    help: "Parça modunda seçmek için parçaya dokun, taşımak için sürükle. Boş alanda sürükleyerek kamerayı döndür; parçaların üzerinde de kamerayı döndürmek için Kamera moduna geç. İki parmağı birlikte kaydırarak görüntüyü taşı, parmaklarını açıp kapatarak yakınlaştır. Yakınlaştırmadan sonra yeniden parça taşımak için iki parmağını da kaldır. Araçlar panelinden X / Y / Z eksenlerinde döndür, yüksekliği ayarla ve hassas konumlandır. Yükseklik ve yön düğmelerini basılı tutarak sürekli hareket ettir. Yeşil hizalamada birleştirme düğmesine dokun. Ayırmak için listeden bağlantıyı seç ve Ayır'a dokun. Bırakma, silme, kaydetme ve dosya açma da klavyesiz kullanılabilir.",
  },
};
type Label = keyof typeof labels.en;
interface MobileOptions {
  canvas: HTMLCanvasElement;
  camera: T.PerspectiveCamera;
  controls: OrbitControls;
  language(): Language;
  drag: Pick<TouchActions, "start" | "move" | "end">;
  cancel(): void;
  rotate(axis: "x" | "y" | "z"): void;
  translateBrick(delta: T.Vector3): void;
  setLibraryOpen(open: boolean): void;
}
export function setupMobile(options: MobileOptions) {
  const { canvas, camera, controls } = options;
  const root = document.documentElement;
  const compact = matchMedia("(max-width: 1024px), (any-pointer: coarse)");
  const selection = document.querySelector<HTMLElement>("#selection")!;
  let cameraMode = false;
  let expanded = true;
  const text = (key: Label) => labels[options.language()][key];
  const toolbar = document.createElement("nav");
  toolbar.id = "touch-toolbar";
  toolbar.className = "touch-only";
  toolbar.innerHTML = `<div class="touch-modes"><button data-mode="build" aria-pressed="true" data-touch-t="build"></button><button data-mode="camera" aria-pressed="false" data-touch-t="camera"></button></div><div class="touch-zoom"><button data-zoom="in">+</button><button data-zoom="out">−</button></div><p id="touch-hint"></p>`;
  document.querySelector("header")!.after(toolbar);
  const heading = document.createElement("div");
  heading.className = "selection-heading";
  heading.append(selection.querySelector(".eyebrow")!);
  const toggle = document.createElement("button");
  toggle.id = "selection-toggle";
  toggle.className = "touch-only";
  toggle.setAttribute("aria-controls", "selection-content");
  heading.append(toggle);
  selection.prepend(heading);
  const help = document.createElement("p");
  help.className = "touch-help touch-only";
  help.dataset.touchT = "help";
  document.querySelector("#help-dialog > p")!.before(help);

  function zoom(factor: number) {
    const offset = camera.position.clone().sub(controls.target);
    const distance = T.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setLength(distance));
    controls.update();
  }
  const touch = bindTouchGestures(canvas, {
    ...options.drag,
    orbit(dx, dy) {
      const spherical = new T.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      const scale = (2 * Math.PI) / Math.max(1, canvas.clientHeight);
      spherical.theta -= dx * scale;
      spherical.phi = T.MathUtils.clamp(spherical.phi - dy * scale, Math.max(0.01, controls.minPolarAngle), controls.maxPolarAngle);
      camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(spherical));
      controls.update();
    },
    panZoom(before, after) {
      camera.updateMatrix();
      const scale = 2 * camera.position.distanceTo(controls.target) * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, canvas.clientHeight);
      const pan = new T.Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar((before.x - after.x) * scale)
        .addScaledVector(new T.Vector3().setFromMatrixColumn(camera.matrix, 1), (after.y - before.y) * scale);
      camera.position.add(pan);
      controls.target.add(pan);
      zoom(before.distance / after.distance);
    },
  }, () => cameraMode);

  function run(action: string) {
    if (action === "up" || action === "down") {
      options.translateBrick(new T.Vector3(0, action === "up" ? 0.24 : -0.24, 0));
      return;
    }
    const forward = controls.target.clone().sub(camera.position).setY(0).normalize();
    const right = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0));
    const direction = action === "left" ? right.negate() : action === "right" ? right : action === "back" ? forward.negate() : forward;
    options.translateBrick(direction.multiplyScalar(0.25));
  }
  const repeat = bindRepeatActions(selection, run);
  function setExpanded(value: boolean) {
    expanded = value;
    selection.classList.toggle("collapsed", !value);
    toggle.setAttribute("aria-expanded", String(value));
    toggle.textContent = text(value ? "hide" : "tools");
  }
  toggle.onclick = () => setExpanded(!expanded);
  toolbar.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => {
    button.onclick = () => {
      touch.cancel();
      repeat.cancel();
      options.cancel();
      cameraMode = button.dataset.mode === "camera";
      translate();
    };
  });
  toolbar.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach(button => {
    button.onclick = () => zoom(button.dataset.zoom === "in" ? 0.85 : 1 / 0.85);
  });
  function translate() {
    document.querySelectorAll<HTMLElement>("[data-touch-t]").forEach(el => {
      el.textContent = text(el.dataset.touchT as Label);
    });
    toolbar.setAttribute("aria-label", text("controls"));
    toolbar.querySelector("#touch-hint")!.textContent = text(cameraMode ? "cameraHint" : "buildHint");
    toolbar.querySelectorAll<HTMLElement>("[data-mode]").forEach(el => {
      el.setAttribute("aria-pressed", String((el.dataset.mode === "camera") === cameraMode));
    });
    toolbar.querySelector("[data-zoom=in]")!.setAttribute("aria-label", text("zoomIn"));
    toolbar.querySelector("[data-zoom=out]")!.setAttribute("aria-label", text("zoomOut"));
    root.dataset.controlMode = cameraMode ? "camera" : "build";
    setExpanded(expanded);
  }
  function refreshSelection() {
    const body = selection.querySelector<HTMLElement>("#selection-content")!;
    if (!body.querySelector("#grab") || body.querySelector(".touch-tools")) return;
    const tools = document.createElement("div");
    tools.className = "touch-tools touch-only";
    tools.innerHTML = `<div class="axis-actions">${(["x", "y", "z"] as const).map(axis => `<button data-axis="${axis}" aria-label="${text(`rotate${axis.toUpperCase()}` as Label)}">↻ ${axis.toUpperCase()}</button>`).join("")}</div><div class="fine-actions"><span>${text("move")}</span>${(["left", "forward", "back", "right"] as const).map((direction, i) => `<button data-repeat="${direction}" aria-label="${text(direction)}">${["←", "↑", "↓", "→"][i]}</button>`).join("")}</div>`;
    body.querySelector(".selection-actions")!.after(tools);
    tools.querySelectorAll<HTMLButtonElement>("[data-axis]").forEach(button => {
      button.onclick = () => options.rotate(button.dataset.axis as "x" | "y" | "z");
    });
    tools.querySelectorAll<HTMLButtonElement>("[data-repeat]").forEach(button => {
      button.onclick = () => run(button.dataset.repeat!);
    });
    for (const action of ["up", "down"] as const) {
      const button = body.querySelector<HTMLButtonElement>(`#${action}`)!;
      button.dataset.repeat = action;
      button.setAttribute("aria-label", text(action));
    }
    setExpanded(expanded);
  }
  function layout() {
    touch.cancel();
    repeat.cancel();
    root.classList.toggle("touch-layout", compact.matches);
    if (compact.matches) options.setLibraryOpen(false);
    else cameraMode = false;
    translate();
  }
  compact.addEventListener("change", layout);
  layout();
  return {
    get enabled() { return compact.matches; },
    get cameraMode() { return cameraMode; },
    text,
    translate,
    refreshSelection,
    selected() { repeat.cancel(); setExpanded(true); },
    collapse() { if (compact.matches) setExpanded(false); },
    cancel() { touch.cancel(); repeat.cancel(); },
  };
}
