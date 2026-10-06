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
  /** Only a normal release after dragging may commit the displayed snap. */
  end(commit: boolean): void;
  orbit(dx: number, dy: number): void;
  panZoom(before: TouchPair, after: TouchPair): void;
}
export type MovementPhase = "start" | "release" | "cancel";
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
    if (this.points.size === 0) {
      // Picking a different brick cancels previous scene input. Establish this
      // gesture after that callback so it cannot cancel its own initial pointer.
      const piece = !cameraMode && this.actions.start(point);
      this.points.set(point.pointerId, { ...point });
      this.origin = { ...point };
      this.moved = false;
      this.kind = piece ? "piece" : "orbit";
    } else {
      this.points.set(point.pointerId, { ...point });
      // A second finger ends editing, but never releases/drops the held assembly.
      const wasPiece = this.kind === "piece";
      this.kind = "multi";
      if (wasPiece) this.actions.end(false);
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
    if (this.points.size === 0) this.finish(true);
  }
  cancel() {
    this.finish(false);
  }
  private finish(commit: boolean) {
    const wasPiece = this.kind === "piece";
    const didMove = this.moved;
    this.points.clear();
    this.kind = "idle";
    this.origin = null;
    this.moved = false;
    // Reset ownership before callbacks, which may cancel other input handlers.
    if (wasPiece) this.actions.end(commit && didMove);
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
export function bindRepeatActions(
  panel: HTMLElement,
  run: (action: string) => void,
  movement: (phase: MovementPhase) => void = () => {},
  enabled: () => boolean = () => true,
) {
  const doc = panel.ownerDocument;
  const view = doc.defaultView!;
  let pointer: number | null = null;
  const keys = new Set<string>();
  let active = false;
  let activeAction: string | undefined;
  let delay = 0;
  let repeat = 0;
  let completionFrame = 0;
  function finish(commit: boolean) {
    const id = pointer;
    const wasActive = active;
    active = false;
    activeAction = undefined;
    pointer = null;
    keys.clear();
    view.clearTimeout(delay);
    view.clearInterval(repeat);
    view.cancelAnimationFrame(completionFrame);
    completionFrame = 0;
    if (id !== null && panel.hasPointerCapture(id)) panel.releasePointerCapture(id);
    if (wasActive) movement(commit ? "release" : "cancel");
  }
  function cancel() {
    finish(false);
  }
  function begin() {
    if (active) return;
    active = true;
    movement("start");
  }
  function execute(action: string) {
    if (!active || !enabled()) return cancel();
    activeAction = action;
    run(action);
  }
  function buttonFor(event: Event) {
    return (event.target as Element).closest<HTMLButtonElement>("button[data-repeat]");
  }
  panel.addEventListener("pointerdown", event => {
    const button = buttonFor(event);
    if (!button || button.disabled || event.button !== 0 || pointer !== null || keys.size || !enabled()) return;
    event.preventDefault();
    // A physical gesture takes over from a pending assistive-technology click.
    cancel();
    const action = button.dataset.repeat!;
    pointer = event.pointerId;
    panel.setPointerCapture(pointer);
    begin();
    execute(action);
    if (!active) return;
    delay = view.setTimeout(() => {
      repeat = view.setInterval(() => execute(action), 90);
    }, 350);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    panel.addEventListener(type, event => {
      if ((event as PointerEvent).pointerId === pointer) finish(type === "pointerup" && enabled());
    });
  // Own keyboard activation so Space does not also trigger the canvas press shortcut.
  panel.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const button = buttonFor(event);
    if (!button || button.disabled || !enabled() || pointer !== null) return;
    if (event.repeat && !keys.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    view.cancelAnimationFrame(completionFrame);
    completionFrame = 0;
    keys.add(event.key);
    begin();
    execute(button.dataset.repeat!);
  });
  view.addEventListener("keyup", event => {
    if (!keys.delete(event.key)) return;
    event.preventDefault();
    if (!keys.size) finish(enabled());
  });
  panel.addEventListener("focusout", () => {
    if (keys.size) cancel();
  });
  // Physical and keyboard events were handled above. AT clicks have no pointer
  // or key release, so leave a rendering opportunity before completing the step.
  panel.addEventListener("click", event => {
    const button = buttonFor(event);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.detail > 0 || button.disabled || !enabled() || pointer !== null || keys.size) return;
    view.cancelAnimationFrame(completionFrame);
    begin();
    execute(button.dataset.repeat!);
    if (!active) return;
    completionFrame = view.requestAnimationFrame(() => {
      completionFrame = view.requestAnimationFrame(() => finish(enabled()));
    });
  }, true);
  view.addEventListener("blur", cancel);
  view.addEventListener("pagehide", cancel);
  view.addEventListener("resize", cancel);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) cancel();
  });
  return { cancel, get action() { return activeAction; } };
}
