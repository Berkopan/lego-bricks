import * as T from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Language } from "./i18n";
import { bindTouchGestures, type TouchActions } from "./input/touch";
import { setupMobileHud } from "./mobile-hud";

const labels = {
  en: {
    build: "Build", camera: "Camera", zoomIn: "Zoom in", zoomOut: "Zoom out", controls: "Touch controls",
    buildHint: "Drag a brick or use the stick · two fingers to pan / zoom",
    cameraHint: "Drag anywhere to orbit · two fingers to pan / zoom",
    ready: "Aligned · tap Connect", demoHint: "The red brick is ready. Tap Connect.",
    help: "In Build mode, tap a brick to select it. The transparent joystick at the bottom left moves it relative to your view; push gently for fine positioning. Release the stick to stop. The small buttons at the bottom right lift, lower, rotate and connect the brick. Tap … for X / Z tilt, upright, pick up / release, directional nudges, separate and delete. Extra tools stay closed until you ask for them. You can still drag bricks directly. Drag empty space to orbit, or switch to Camera to orbit over bricks. Move two fingers together to pan, and pinch to zoom. Save and open are available in the footer.",
  },
  tr: {
    build: "Parça", camera: "Kamera", zoomIn: "Yakınlaştır", zoomOut: "Uzaklaştır", controls: "Dokunmatik kontroller",
    buildHint: "Parçayı sürükle veya joystick'i kullan · iki parmakla kaydır / yakınlaştır",
    cameraHint: "Her yerde sürükleyerek dön · iki parmakla kaydır / yakınlaştır",
    ready: "Hizalandı · Birleştir'e dokun", demoHint: "Kırmızı parça hazır. Birleştir'e dokun.",
    help: "Parça modunda seçmek için parçaya dokun. Sol alttaki saydam joystick parçayı kameraya göre taşır; hassas konumlandırmak için hafifçe it. Parmağını kaldırınca hareket durur. Sağ alttaki küçük düğmelerle yükselt, alçalt, döndür ve birleştir. X / Z eğme, dik tutma, eline alma / bırakma, yön düğmeleri, ayırma ve silme için … düğmesine dokun. Ek araçlar kendiliğinden açılmaz. Parçaları doğrudan sürüklemeye de devam edebilirsin. Boş alanda sürükleyerek kamerayı döndür; parçaların üzerinde de dönmek için Kamera moduna geç. İki parmakla kaydır ve parmaklarını açıp kapatarak yakınlaştır. Kaydetme ve dosya açma alt çubuktadır.",
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
  // Viewport width changes placement only; it never enables mobile controls on desktop.
  const compact = matchMedia("(pointer: coarse)");
  let cameraMode = false;
  const text = (key: Label) => labels[options.language()][key];
  const toolbar = document.createElement("nav");
  toolbar.id = "touch-toolbar";
  toolbar.className = "touch-only";
  toolbar.innerHTML = `<div class="touch-modes"><button data-mode="build" aria-pressed="true" data-touch-t="build"></button><button data-mode="camera" aria-pressed="false" data-touch-t="camera"></button></div><div class="touch-zoom"><button data-zoom="in">+</button><button data-zoom="out">−</button></div><p id="touch-hint"></p>`;
  document.querySelector("header")!.after(toolbar);
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

  const hud = setupMobileHud({
    language: options.language,
    rotate: options.rotate,
    cancelScene: options.cancel,
    move(x, y) {
      const forward = controls.target.clone().sub(camera.position).setY(0).normalize();
      const right = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0));
      options.translateBrick(right.multiplyScalar(x).addScaledVector(forward, -y));
    },
  });
  toolbar.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => {
    button.onclick = () => {
      touch.cancel();
      hud.cancel();
      hud.collapse();
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
    hud.translate();
  }
  function layout() {
    touch.cancel();
    hud.cancel();
    hud.collapse();
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
    refreshSelection: hud.refresh,
    selected: hud.selected,
    collapse: hud.collapse,
    cancel() { touch.cancel(); hud.cancel(); },
  };
}
