/** Pointer ownership is independent of the renderer so gesture transitions are testable. */
export interface TouchPoint {
  pointerId: number;
  clientX: number;
  clientY: number;
}
export interface TouchPair {
  x: number;
  y: number;
  distance: number;
}
export interface TouchActions {
  start(point: TouchPoint): boolean;
  move(point: TouchPoint): void;
  end(): void;
  orbit(dx: number, dy: number): void;
  panZoom(before: TouchPair, after: TouchPair): void;
}
const TAP_SLOP = 9;
function pair(points: TouchPoint[]): TouchPair {
  const [a, b] = points;
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
    distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
  };
}
export class TouchGestures {
  private points = new Map<number, TouchPoint>();
  private kind: "idle" | "piece" | "orbit" | "multi" = "idle";
  private origin: TouchPoint | null = null;
  private moved = false;
  private actions: TouchActions;
  constructor(actions: TouchActions) {
    this.actions = actions;
  }
  get ids(): number[] {
    return [...this.points.keys()];
  }
  down(point: TouchPoint, cameraMode = false) {
    if (this.points.has(point.pointerId)) return;
    this.points.set(point.pointerId, { ...point });
    if (this.points.size === 1) {
      this.origin = { ...point };
      this.moved = false;
      this.kind = !cameraMode && this.actions.start(point) ? "piece" : "orbit";
    } else {
      // A second finger ends editing, but never releases/drops the held assembly.
      if (this.kind === "piece") this.actions.end();
      this.kind = "multi";
    }
  }
  move(point: TouchPoint) {
    const previous = this.points.get(point.pointerId);
    if (!previous) return;
    const before = [...this.points.values()];
    this.points.set(point.pointerId, { ...point });
    if (this.kind === "multi") {
      // Ignore extra fingers. Rebase on the remaining pair when a finger leaves.
      if (before.length >= 2 && before.slice(0, 2).some(p => p.pointerId === point.pointerId))
        this.actions.panZoom(pair(before), pair([...this.points.values()]));
      // After a pinch, the remaining finger must lift before editing can resume.
      return;
    }
    if (!this.origin) return;
    if (!this.moved) {
      this.moved = Math.hypot(point.clientX - this.origin.clientX, point.clientY - this.origin.clientY) > TAP_SLOP;
      if (!this.moved) return;
    }
    if (this.kind === "piece") this.actions.move(point);
    else if (this.kind === "orbit")
      this.actions.orbit(point.clientX - previous.clientX, point.clientY - previous.clientY);
  }
  up(pointerId: number) {
    if (!this.points.delete(pointerId)) return;
    if (this.points.size === 0) this.cancel();
  }
  cancel() {
    if (this.kind === "piece") this.actions.end();
    this.points.clear();
    this.kind = "idle";
    this.origin = null;
    this.moved = false;
  }
}

/** Capture touch events before OrbitControls: a gesture has exactly one owner. */
export function bindTouchGestures(
  element: HTMLElement,
  actions: TouchActions,
  cameraMode: () => boolean,
) {
  const gestures = new TouchGestures(actions);
  function cancel() {
    const ids = gestures.ids;
    gestures.cancel();
    for (const id of ids)
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
  }
  function receive(event: PointerEvent) {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // PointerEvent coordinates are prototype properties; copy them explicitly.
    const point = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    if (event.type === "pointerdown") {
      element.setPointerCapture(event.pointerId);
      gestures.down(point, cameraMode());
    } else if (event.type === "pointermove") gestures.move(point);
    else if (event.type === "pointerup") {
      gestures.up(event.pointerId);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    } else cancel();
  }
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
    element.addEventListener(type, receive as EventListener, { capture: true, passive: false });
  element.addEventListener("lostpointercapture", event => {
    if (gestures.ids.includes(event.pointerId)) cancel();
  });
  window.addEventListener("blur", cancel);
  window.addEventListener("pagehide", cancel);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancel();
  });
  return { cancel };
}

/** Capture on the persistent panel, not a button replaced by renderSelection(). */
export function bindRepeatActions(panel: HTMLElement, run: (action: string) => void) {
  let pointer: number | null = null;
  let delay = 0;
  let repeat = 0;
  function cancel() {
    const id = pointer;
    pointer = null;
    window.clearTimeout(delay);
    window.clearInterval(repeat);
    if (id !== null && panel.hasPointerCapture(id)) panel.releasePointerCapture(id);
  }
  panel.addEventListener("pointerdown", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-repeat]");
    if (!button || button.disabled || event.button !== 0 || pointer !== null) return;
    event.preventDefault();
    const action = button.dataset.repeat!;
    pointer = event.pointerId;
    panel.setPointerCapture(pointer);
    run(action);
    delay = window.setTimeout(() => {
      repeat = window.setInterval(() => run(action), 90);
    }, 350);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    panel.addEventListener(type, event => {
      if ((event as PointerEvent).pointerId === pointer) cancel();
    });
  // A physical tap was already handled on pointerdown. Keyboard/AT clicks still work.
  panel.addEventListener("click", event => {
    if (event.detail > 0 && (event.target as Element).closest("button[data-repeat]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("blur", cancel);
  window.addEventListener("pagehide", cancel);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancel();
  });
  return { cancel };
}
