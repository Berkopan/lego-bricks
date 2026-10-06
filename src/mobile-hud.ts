import { bindJoystick, keepsJoystickWhile } from "./input/joystick";
import { bindRepeatActions, type MovementPhase } from "./input/touch";
import type { Language } from "./i18n";

const labels = {
  en: {
    move: "Move brick", joystick: "Drag the stick to move; arrow keys also work.",
    more: "More brick tools", close: "Close tools", connect: "Connect", rotate: "Rotate around Y",
    up: "Lift brick", down: "Lower brick", x: "Tilt X", z: "Tilt Z", upright: "Upright",
    remove: "Delete brick", grab: "Pick up / release", seam: "Connection to separate",
    detach: "Separate", left: "Move left", right: "Move right", forward: "Move away", back: "Move closer",
  },
  tr: {
    move: "Parçayı taşı", joystick: "Taşımak için joystick'i sürükle; yön tuşları da kullanılabilir.",
    more: "Diğer parça araçları", close: "Araçları kapat", connect: "Birleştir", rotate: "Y ekseninde döndür",
    up: "Parçayı yükselt", down: "Parçayı alçalt", x: "X eğ", z: "Z eğ", upright: "Dik tut",
    remove: "Parçayı sil", grab: "Eline al / bırak", seam: "Ayrılacak bağlantı",
    detach: "Ayır", left: "Sola taşı", right: "Sağa taşı", forward: "İleri taşı", back: "Geri taşı",
  },
};
type Label = keyof typeof labels.en;
export type MovementSource = "stick" | "repeat";
interface HudOptions {
  language(): Language;
  move(x: number, y: number): void;
  rotate(axis: "x" | "y" | "z"): void;
  cancelScene(): void;
  movement(source: MovementSource, phase: MovementPhase): void;
}

/** Persistent, transparent controls; the original desktop controls remain untouched. */
export function setupMobileHud(options: HudOptions) {
  const root = document.documentElement;
  const selection = document.querySelector<HTMLElement>("#selection")!;
  const source = selection.querySelector<HTMLElement>("#selection-content")!;
  const hud = document.createElement("div");
  hud.id = "touch-hud";
  hud.className = "touch-only";
  hud.innerHTML = `
    <div class="hud-movement">
      <div class="hud-caption"><i></i><span></span></div>
      <div id="brick-joystick" role="group" tabindex="0" aria-describedby="joystick-help">
        <span class="stick-cross" aria-hidden="true">✥</span>
        <span class="stick-knob" aria-hidden="true"></span>
      </div>
      <span id="joystick-help" class="hud-sr-only"></span>
    </div>
    <div class="hud-actions">
      <button data-repeat="down" data-label="down">↓</button>
      <button data-repeat="up" data-label="up">↑</button>
      <button data-action="rotate" data-label="rotate">↻</button>
      <button id="hud-more" data-label="more" aria-expanded="false" aria-controls="hud-details">…</button>
      <button id="hud-connect" data-action="press" data-label="connect" disabled></button>
    </div>
    <section id="hud-details" hidden>
      <div class="hud-details-heading"><span data-copy="more"></span><button id="hud-close" data-label="close">×</button></div>
      <div class="hud-detail-actions">
        <button data-axis="x" data-copy="x"></button><button data-axis="z" data-copy="z"></button>
        <button data-action="grab" data-label="grab"></button><button data-action="upright" data-copy="upright"></button>
      </div>
      <div class="hud-nudges">
        <button data-repeat="left" data-label="left">←</button><button data-repeat="forward" data-label="forward">↑</button>
        <button data-repeat="back" data-label="back">↓</button><button data-repeat="right" data-label="right">→</button>
      </div>
      <div id="hud-seam-controls" hidden>
        <label for="hud-seams" data-copy="seam"></label><select id="hud-seams"></select>
        <button data-action="detach" data-copy="detach"></button>
      </div>
      <button class="hud-delete" data-action="remove" data-copy="remove"></button>
    </section>`;
  selection.append(hud);
  const $ = <E extends HTMLElement = HTMLElement>(query: string) => hud.querySelector<E>(query)!;
  const text = (key: Label) => labels[options.language()][key];
  const pad = $("#brick-joystick");
  const details = $("#hud-details");
  const toggle = $("#hud-more");
  let expanded = false;

  function enabled() {
    return root.classList.contains("touch-layout") && !selection.hidden &&
      !root.classList.contains("library-open") && root.dataset.controlMode !== "camera" &&
      !!source.querySelector("#grab");
  }
  function activate(action: string) {
    if (!enabled()) return;
    const button = source.querySelector<HTMLButtonElement>(`#${action}`);
    if (button && !button.disabled) button.click();
  }
  function run(action: string) {
    if (!enabled()) return;
    if (action === "up" || action === "down") return activate(action);
    const step = 0.12;
    options.move(action === "left" ? -step : action === "right" ? step : 0,
      action === "forward" ? -step : action === "back" ? step : 0);
  }
  const repeat = bindRepeatActions(hud, run, phase => options.movement("repeat", phase), enabled);
  const stick = bindJoystick(pad, options.move, enabled, () => {
    // A height finger remains independent in either start order. Directional
    // nudges give way to the joystick instead of competing on the same plane.
    if (!keepsJoystickWhile(repeat.action)) repeat.cancel();
    // Stop a canvas drag before the joystick becomes the movement owner.
    options.cancelScene();
    setExpanded(false);
  }, phase => options.movement("stick", phase));
  function cancel() {
    stick.cancel();
    repeat.cancel();
  }
  function setExpanded(value: boolean, focus = false) {
    expanded = value && enabled();
    const returnFocus = !expanded && details.contains(document.activeElement);
    details.hidden = !expanded;
    if (returnFocus) toggle.focus({ preventScroll: true });
    toggle.setAttribute("aria-expanded", String(expanded));
    if (expanded && focus) $("#hud-close").focus({ preventScroll: true });
  }
  toggle.onclick = () => { cancel(); setExpanded(!expanded, true); };
  $("#hud-close").onclick = () => { cancel(); setExpanded(false); };
  hud.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button => {
    button.onclick = () => {
      cancel();
      activate(button.dataset.action!);
      setExpanded(false);
    };
  });
  hud.querySelectorAll<HTMLButtonElement>("[data-axis]").forEach(button => {
    button.onclick = () => {
      cancel();
      if (enabled()) options.rotate(button.dataset.axis as "x" | "z");
      setExpanded(false);
    };
  });
  $("#hud-seams").onchange = () => {
    const original = source.querySelector<HTMLSelectElement>("#seams");
    if (original) original.value = $<HTMLSelectElement>("#hud-seams").value;
  };
  hud.addEventListener("keydown", event => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      setExpanded(false);
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!hud.contains(event.target as Node)) {
      cancel();
      setExpanded(false);
    } else if (!pad.contains(event.target as Node)) {
      const repeatAction = (event.target as Element)
        .closest<HTMLElement>("[data-repeat]")?.dataset.repeat;
      // Height is an independent axis: a second finger may lift/lower while the
      // first keeps steering the brick. Other tools still take ownership.
      if (!keepsJoystickWhile(repeatAction)) stick.cancel();
    }
  }, true);

  function sync() {
    const original = source.querySelector<HTMLButtonElement>("#press");
    const connect = $<HTMLButtonElement>("#hud-connect");
    connect.disabled = !original || original.disabled;
    connect.style.setProperty("--progress", original?.style.getPropertyValue("--progress") || "0%");
    $(".hud-caption span").textContent = source.querySelector(".selected-title h3")?.textContent || "";
    $(".hud-caption i").style.background = source.querySelector<HTMLElement>(".color-chip")?.style.background || "";
    const grab = source.querySelector("#grab");
    $("[data-action=grab]").textContent = grab?.firstChild?.textContent?.trim() || text("grab");
    const seams = source.querySelector<HTMLSelectElement>("#seams");
    $("#hud-seam-controls").hidden = !seams;
    if (seams) {
      const list = $<HTMLSelectElement>("#hud-seams");
      if (list.innerHTML !== seams.innerHTML) list.innerHTML = seams.innerHTML;
      list.value = seams.value;
    }
    if (!enabled()) { cancel(); setExpanded(false); }
  }
  function translate() {
    hud.querySelectorAll<HTMLElement>("[data-label]").forEach(el => {
      const label = text(el.dataset.label as Label);
      el.setAttribute("aria-label", label);
      el.title = label;
    });
    hud.querySelectorAll<HTMLElement>("[data-copy]").forEach(el => {
      el.textContent = text(el.dataset.copy as Label);
    });
    pad.setAttribute("aria-label", text("move"));
    $("#joystick-help").textContent = text("joystick");
    $("#hud-connect").textContent = text("connect");
    $("#hud-seams").setAttribute("aria-label", text("seam"));
    sync();
  }
  // Mirror the engine-driven connect availability/progress without a second frame loop.
  new MutationObserver(sync).observe(source, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "style"],
  });
  new MutationObserver(() => {
    if (!enabled()) { cancel(); setExpanded(false); }
  }).observe(selection, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(() => {
    if (!enabled()) { cancel(); setExpanded(false); }
  }).observe(root, { attributes: true, attributeFilter: ["class", "data-control-mode"] });
  translate();
  return {
    translate,
    refresh: sync,
    selected() { cancel(); setExpanded(false); },
    collapse() { setExpanded(false); },
    cancel,
  };
}
