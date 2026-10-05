import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BrickWorld, type Brick } from "./engine/world";
import { dragTarget } from "./engine/drag";
import { BrickAudio } from "./engine/audio";
import { catalog, colors } from "./engine/catalog";
import { component } from "./engine/connections";
import { messages, type Language } from "./i18n";
import "./style.css";
let language: Language =
  localStorage.getItem("bricks-language") === "tr" ? "tr" : "en";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<canvas id="world" aria-label="3D brick workspace"></canvas><header><a class="brand" href="./"><span class="brand-icon">▦</span>bricks<span class="brand-dot">.</span></a><div class="top-actions"><button id="help" class="icon-button">?</button><button id="sound" class="icon-button" aria-pressed="true">♫</button><div class="language"><button data-lang="en">EN</button><button data-lang="tr">TR</button></div><button id="library-toggle" class="library-toggle"><span>▦</span><span data-t="library"></span><span id="toggle-arrow">↗</span></button></div></header><aside id="library"><h2 data-t="library"></h2><div id="cards"></div><div class="color-heading eyebrow" data-t="color"></div><div id="swatches"></div></aside><section id="selection" class="selection"><div class="eyebrow" data-t="selected"></div><div id="selection-content"></div></section><div class="bottom-center"><div id="alignment" role="status"></div></div><footer><div class="status"><button id="pause"><i></i><span data-t="live"></span></button><span class="footer-divider"></span><span id="counts"></span></div><div class="scene-actions"><button id="view">⌖</button><button id="save" data-t="save"></button><button id="load" data-t="load"></button><button id="reset" data-t="reset"></button></div></footer><div id="toast" role="status"></div><dialog id="help-dialog"><button id="close-help" class="close">×</button><div class="eyebrow" data-t="shortcuts"></div><h2 data-t="help"></h2><button id="demo" class="text-button" data-t="demo"></button><p data-t="helpText"></p><div class="key-row"><kbd>Q</kbd><kbd>E</kbd><span data-t="lift"></span></div><div class="key-row"><kbd>R</kbd><span data-t="rotate"></span></div><div class="key-row"><kbd>Space</kbd><span data-t="press"></span></div></dialog><input type="file" id="file" accept=".json" hidden><div id="loading" data-t="loading"></div>`;
const $ = <E extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<E>(s)!;
const text = (key: keyof typeof messages.en) => messages[language][key];
const audio = new BrickAudio();
const canvas = $<HTMLCanvasElement>("#world");
canvas.tabIndex = 0;
const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new T.Scene();
scene.background = new T.Color("#f3f0e9");
scene.fog = new T.Fog("#f3f0e9", 35, 95);
const camera = new T.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 150);
camera.position.set(14, 15, 19);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.minDistance = 5;
controls.maxDistance = 55;
controls.mouseButtons = {
  LEFT: T.MOUSE.ROTATE,
  MIDDLE: T.MOUSE.DOLLY,
  RIGHT: T.MOUSE.PAN,
};
const pmrem = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.65;
room.dispose();
pmrem.dispose();
scene.add(new T.HemisphereLight(0xffffff, 0xbeb7a8, 0.8));
const sun = new T.DirectionalLight(0xfff4df, 2.5);
sun.position.set(-7, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -20,
  right: 20,
  top: 20,
  bottom: -20,
  near: 1,
  far: 55,
});
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 3;
scene.add(sun);
const floor = new T.Mesh(
  new T.PlaneGeometry(200, 200),
  new T.MeshStandardMaterial({ color: "#f0ede5", roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new T.GridHelper(70, 70, 0xd4d0c6, 0xe0dcd3);
grid.position.y = 0.003;
(grid.material as T.Material).transparent = true;
(grid.material as T.Material).opacity = 0.42;
scene.add(grid);
const world = new BrickWorld(scene, (v) => audio.play(v));
let selected: Brick | null = null,
  currentColor = colors[0],
  paused = false,
  panelOpen = innerWidth > 720,
  toastTimer = 0,
  dirty = true;
let pressing: null | {
  start: number;
  id: number;
  lower: number;
  origin: T.Vector3;
  target: T.Vector3;
  rotation: T.Quaternion;
} = null;
const outline = new T.BoxHelper(new T.Object3D(), 0x5c8070);
outline.visible = false;
scene.add(outline);
const ghost = new T.Mesh(
  new T.PlaneGeometry(1, 1),
  new T.MeshBasicMaterial({
    color: 0x54a981,
    transparent: true,
    opacity: 0.22,
    side: T.DoubleSide,
    depthWrite: false,
  }),
);
ghost.visible = false;
scene.add(ghost);
function toast(s: string) {
  $("#toast").textContent = s;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => $("#toast").classList.remove("visible"),
    3000,
  );
}
function translate() {
  document.documentElement.lang = language;
  document
    .querySelectorAll<HTMLElement>("[data-t]")
    .forEach(
      (el) => (el.textContent = text(el.dataset.t as keyof typeof messages.en)),
    );
  document
    .querySelectorAll<HTMLElement>("[data-lang]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.lang === language),
    );
  $("#help").title = text("help");
  $("#sound").title = text("sound");
  $("#view").title = text("view");
  $("#library-toggle").setAttribute("aria-expanded", String(panelOpen));
  $("#library").classList.toggle("closed", !panelOpen);
  $("#pause span").textContent = text(paused ? "paused" : "live");
  renderCards();
  dirty = true;
}
function renderCards() {
  $("#cards").innerHTML = catalog
    .map(
      (s, i) =>
        `<button class="brick-card" data-spec="${s.id}" aria-label="${text("add")} ${s.label}"><div class="brick-art art-${s.id}" style="--brick:${currentColor};--cols:${s.cols};--rows:${s.rows}"><div class="mini-brick">${Array.from({ length: s.cols * s.rows }, () => "<i></i>").join("")}</div></div><div class="card-description"><div><strong>${s.label}</strong></div><span class="add-circle">+</span></div></button>`,
    )
    .join("");
  document.querySelectorAll<HTMLElement>("[data-spec]").forEach(
    (el) =>
      (el.onclick = () => {
        if (world.bricks.length >= 250) return toast(text("limit"));
        cancelPress();
        world.release();
        const spec = catalog.find((s) => s.id === el.dataset.spec)!;
        const b = world.add(
          spec,
          currentColor,
          new T.Vector3(
            controls.target.x,
            6 + Math.random(),
            controls.target.z,
          ),
        );
        select(b);
        world.grab(b.id);
        dirty = true;
        audio.unlock();
      }),
  );
}
function select(b: Brick | null) {
  cancelPress();
  selected = b;
  dirty = true;
}
function renderSelection() {
  const b = selected;
  $("#selection").hidden = !b;
  if (!b) {
    $("#selection-content").innerHTML = "";
    return;
  }
  const held = world.held.has(b.id),
    links = world.links.filter((l) => component(b.id, world.links).has(l.a));
  $("#selection-content").innerHTML =
    `<div class="selected-title"><span class="color-chip" style="background:${b.color}"></span><h3>${b.spec.label}</h3><span class="pill">${held ? text("held") : text("free")}</span></div><div class="selection-actions"><button id="grab" class="secondary">${held ? text("drop") : text("grab")} <span>${held ? "Esc" : "↖"}</span></button><button id="rotate" title="R">↻ <span>${text("rotate")}</span></button><button id="upright" title="U">${text("upright")}</button><button id="remove" class="remove" title="${text("delete")}">×</button></div><div class="height-actions"><span>${text("lift")}</span><button id="down">−</button><button id="up">+</button><kbd>Q / E</kbd></div><button id="press" class="press" ${held ? "" : "disabled"}><span>${text("press")}</span><kbd>Space</kbd></button>${links.length ? `<div class="seam-label eyebrow">${text("seam")}</div><select id="seams" aria-label="${text("seam")}">${links.map((l) => `<option value="${world.links.indexOf(l)}">#${l.a} ↔ #${l.b} · ${l.studs} ${text("studs")}</option>`).join("")}</select><button id="detach" class="detach">↗ ${text("detach")}</button>` : ""}`;
  $("#grab").onclick = () => {
    cancelPress();
    held ? world.release() : world.grab(b.id);
    dirty = true;
  };
  $("#rotate").onclick = () => rotate("y");
  $("#upright").onclick = upright;
  $("#remove").onclick = () => {
    world.remove(b.id);
    select(null);
  };
  $("#up").onclick = () => height(0.24);
  $("#down").onclick = () => height(-0.24);
  const press = $("#press");
  press.onclick = () => startPress();
  if (links.length)
    $("#detach").onclick = () => {
      cancelPress();
      const link = world.links[Number($<HTMLSelectElement>("#seams").value)];
      if (!world.detach(link, b.id)) toast(text("cycle"));
      else {
        select(world.get(link.a));
        audio.play(0.55, true);
        toast(text("separated"));
      }
      dirty = true;
    };
}
function height(amount: number) {
  if (!selected || pressing) return;
  if (!world.held.has(selected.id)) world.grab(selected.id);
  if (
    !world.transform(
      selected.id,
      selected.position.clone().add(new T.Vector3(0, amount, 0)),
    )
  )
    toast(text("blocked"));
  dirty = true;
}
function rotate(axis: "x" | "y" | "z") {
  if (!selected || pressing) return;
  if (!world.held.has(selected.id)) world.grab(selected.id);
  const q = new T.Quaternion()
    .setFromAxisAngle(
      new T.Vector3(
        axis === "x" ? 1 : 0,
        axis === "y" ? 1 : 0,
        axis === "z" ? 1 : 0,
      ),
      Math.PI / 2,
    )
    .multiply(selected.rotation);
  if (!world.transform(selected.id, selected.position, q))
    toast(text("blocked"));
  dirty = true;
}
function upright() {
  if (!selected || pressing) return;
  if (!world.held.has(selected.id)) world.grab(selected.id);
  const e = new T.Euler().setFromQuaternion(selected.rotation, "YXZ");
  const q = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 1, 0),
    (Math.round(e.y / (Math.PI / 2)) * Math.PI) / 2,
  );
  if (!world.transform(selected.id, selected.position, q))
    toast(text("blocked"));
  dirty = true;
}
function startPress() {
  if (!selected || pressing) return;
  const c = world.candidate(selected.id);
  if (!c) {
    toast(text("notReady"));
    return;
  }
  audio.unlock();
  pressing = {
    start: performance.now(),
    id: selected.id,
    lower: c.lower.id,
    origin: selected.position.clone(),
    target: c.fit.position.clone(),
    rotation: c.fit.rotation.clone(),
  };
}
function cancelPress() {
  if (pressing) {
    const p = pressing;
    pressing = null;
    world.transform(p.id, p.origin);
    $("#press")?.style.setProperty("--progress", "0%");
  }
}
$("#swatches").innerHTML = colors
  .map(
    (c, i) =>
      `<button class="swatch ${i === 0 ? "active" : ""}" style="--swatch:${c}" data-color="${c}" aria-label="${c}" aria-pressed="${i === 0}"></button>`,
  )
  .join("");
document.querySelectorAll<HTMLElement>("[data-color]").forEach(
  (el) =>
    (el.onclick = () => {
      currentColor = el.dataset.color!;
      document.querySelectorAll<HTMLElement>("[data-color]").forEach((s) => {
        s.classList.toggle("active", s === el);
        s.setAttribute("aria-pressed", String(s === el));
      });
      renderCards();
    }),
);
document.querySelectorAll<HTMLElement>("[data-lang]").forEach(
  (el) =>
    (el.onclick = () => {
      language = el.dataset.lang as Language;
      localStorage.setItem("bricks-language", language);
      translate();
    }),
);
$("#library-toggle").onclick = () => {
  panelOpen = !panelOpen;
  $("#library").classList.toggle("closed", !panelOpen);
  $("#library-toggle").setAttribute("aria-expanded", String(panelOpen));
  $("#toggle-arrow").textContent = panelOpen ? "↗" : "↙";
};
$("#help").onclick = () => $<HTMLDialogElement>("#help-dialog").showModal();
$("#close-help").onclick = () => $<HTMLDialogElement>("#help-dialog").close();
$("#sound").onclick = () => {
  audio.enabled = !audio.enabled;
  $("#sound").setAttribute("aria-pressed", String(audio.enabled));
  $("#sound").textContent = audio.enabled ? "♫" : "♩";
  audio.unlock();
};
$("#pause").onclick = () => {
  paused = !paused;
  $("#pause").classList.toggle("paused", paused);
  $("#pause span").textContent = text(paused ? "paused" : "live");
};
$("#view").onclick = () => {
  camera.position.set(14, 15, 19);
  controls.target.set(0, 0.6, 0);
};
$("#save").onclick = () => {
  const blob = new Blob([JSON.stringify(world.serialize(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "my-bricks.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(text("saved"));
};
$("#load").onclick = () => $<HTMLInputElement>("#file").click();
$("#file").onchange = async () => {
  try {
    const file = $<HTMLInputElement>("#file").files?.[0];
    if (!file) return;
    if (file.size > 1000000) throw Error("Too large");
    const data = JSON.parse(await file.text());
    cancelPress();
    world.restore(data);
    select(null);
    toast(text("loaded"));
  } catch {
    toast(text("error"));
  }
  $<HTMLInputElement>("#file").value = "";
};
$("#reset").onclick = () => {
  if (confirm(text("resetAsk"))) {
    cancelPress();
    world.clear();
    select(null);
  }
};
$("#demo").onclick = () => {
  $<HTMLDialogElement>("#help-dialog").close();
  if (world.links.length && !confirm(text("resetAsk"))) return;
  cancelPress();
  world.clear();
  const lower = world.add(catalog[2], colors[2], new T.Vector3(0, 0.6, 0));
  const upper = world.add(catalog[1], colors[0], new T.Vector3(0, 2.2, 0));
  world.grab(upper.id);
  select(upper);
  camera.position.set(11, 12, 15);
  controls.target.copy(lower.position);
  toast(text("demoHint"));
};
const ray = new T.Raycaster(),
  mouse = new T.Vector2();
let drag: null | {
  id: number;
  startX: number;
  startY: number;
  moving: boolean;
  offset: T.Vector3;
  plane: T.Plane;
} = null;
function cast(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  mouse.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    (-(e.clientY - r.top) / r.height) * 2 + 1,
  );
  ray.setFromCamera(mouse, camera);
}
canvas.addEventListener(
  "pointerdown",
  (e) => {
    audio.unlock();
    if (e.button !== 0 || pressing) return;
    cast(e);
    const hit = ray.intersectObjects(
      world.bricks.map((b) => b.mesh),
      true,
    )[0];
    if (!hit) return;
    let obj: T.Object3D = hit.object;
    while (!obj.userData.brick && obj.parent) obj = obj.parent;
    const b = obj.userData.brick as Brick;
    select(b);
    controls.enabled = false;
    // Keep this plane fixed for the entire gesture: Q/E changes only Y.
    const plane = new T.Plane(new T.Vector3(0, 1, 0), -b.position.y),
      p = new T.Vector3();
    ray.ray.intersectPlane(plane, p);
    drag = {
      id: b.id,
      startX: e.clientX,
      startY: e.clientY,
      moving: false,
      offset: b.position.clone().sub(p),
      plane,
    };
    canvas.setPointerCapture(e.pointerId);
  },
  true,
);
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  cast(e);
  if (
    !drag.moving &&
    Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4
  ) {
    world.grab(drag.id);
    const b = world.get(drag.id);
    world.transform(b.id, b.position.clone().add(new T.Vector3(0, 0.4, 0)));
    drag.moving = true;
    dirty = true;
  }
  if (drag.moving) {
    const b = world.get(drag.id);
    const target = dragTarget(ray.ray, drag.plane, drag.offset, b.position.y);
    if (target) {
      const dist = target.distanceTo(b.position),
        steps = Math.max(1, Math.ceil(dist / 0.15)),
        origin = b.position.clone();
      for (let i = 1; i <= steps; i++)
        if (!world.transform(b.id, origin.clone().lerp(target, i / steps)))
          break;
    }
  }
});
function endDrag() {
  drag = null;
  controls.enabled = true;
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
window.addEventListener("blur", () => {
  endDrag();
  cancelPress();
});
window.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(
      (e.target as HTMLElement).tagName,
    ) ||
    $<HTMLDialogElement>("#help-dialog").open
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) startPress();
  }
  if (e.code === "Escape") {
    cancelPress();
    world.release();
    dirty = true;
  }
  if (e.key.toLowerCase() === "u") upright();
  if (e.key.toLowerCase() === "r") rotate("y");
  if (e.key.toLowerCase() === "x") rotate("x");
  if (e.key.toLowerCase() === "z") rotate("z");
  if (e.key.toLowerCase() === "q") height(-0.12);
  if (e.key.toLowerCase() === "e") height(0.12);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") cancelPress();
});
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
translate();
function starter() {
  world.add(
    catalog[2],
    colors[2],
    new T.Vector3(-2, 0.62, 0),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0),
  );
  world.add(
    catalog[1],
    colors[0],
    new T.Vector3(2, 0.62, 1.8),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0),
  );
  world.add(
    catalog[0],
    colors[1],
    new T.Vector3(0.8, 0.62, -2.1),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0),
  );
  world.add(
    catalog[0],
    colors[3],
    new T.Vector3(-3.8, 0.62, 3),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0),
  );
}
let previous = performance.now(),
  accumulator = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  accumulator += Math.min((now - previous) / 1000, 0.05);
  previous = now;
  if (!paused) {
    while (accumulator >= 1 / 120) {
      world.step();
      accumulator -= 1 / 120;
    }
  } else accumulator = 0;
  if (pressing) {
    const p = pressing,
      t = Math.min(1, (now - p.start) / 450),
      b = world.get(p.id),
      lower = world.get(p.lower);
    if (!b || !lower || !world.held.has(b.id)) {
      cancelPress();
    } else {
      const target = p.origin.clone().lerp(p.target, t * t * (3 - 2 * t));
      if (!world.transform(p.id, target, p.rotation)) {
        cancelPress();
        toast(text("blocked"));
      } else {
        $("#press")?.style.setProperty("--progress", `${t * 100}%`);
        if (t === 1) {
          pressing = null;
          if (world.press(p.id)) {
            audio.play(0.8, false, true);
            toast(text("connected"));
            dirty = true;
          } else toast(text("notReady"));
        }
      }
    }
  }
  if (selected && !world.bricks.includes(selected)) select(null);
  if (dirty) {
    renderSelection();
    dirty = false;
  }
  outline.visible = !!selected;
  if (selected) {
    outline.setFromObject(selected.mesh);
    const candidate = world.candidate(selected.id);
    (outline.material as T.LineBasicMaterial).color.set(
      candidate ? 0x46866b : 0x8c9591,
    );
    $("#alignment").textContent = world.held.has(selected.id)
      ? pressing
        ? text("pressing")
        : candidate
          ? text("ready")
          : ""
      : "";
    $("#alignment").classList.toggle("ready", !!candidate);
    $("#press")?.toggleAttribute("disabled", !candidate);
    ghost.visible = !!candidate;
    if (candidate) {
      ghost.scale.set(selected.spec.cols, selected.spec.rows, 1);
      ghost.quaternion
        .copy(candidate.fit.rotation)
        .multiply(
          new T.Quaternion().setFromAxisAngle(
            new T.Vector3(1, 0, 0),
            -Math.PI / 2,
          ),
        );
      ghost.position
        .copy(candidate.fit.position)
        .add(
          new T.Vector3(0, -selected.spec.height / 2 + 0.02, 0).applyQuaternion(
            candidate.fit.rotation,
          ),
        );
    }
  } else {
    $("#alignment").textContent = "";
    ghost.visible = false;
  }
  $("#counts").textContent =
    `${world.bricks.length} ${text("pieces")} · ${world.links.length} ${text("connections")}`;
  controls.update();
  renderer.render(scene, camera);
}
world
  .init()
  .then(() => {
    starter();
    $("#loading").remove();
    requestAnimationFrame(frame);
  })
  .catch((e) => {
    $("#loading").textContent = `Unable to start WebGL / physics: ${e.message}`;
  });
// Read-only inspection plus engine access during local development for integration tests.
if (import.meta.env.DEV)
  Object.assign(window, {
    __bricks: { world, select, audio, scene, camera, renderer },
  });
