export interface StickVector {
  x: number;
  y: number;
}

/** Height controls are orthogonal to planar steering and may run concurrently. */
export function keepsJoystickWhile(action: string | undefined): boolean {
  return action === "up" || action === "down";
}

/** Circular dead zone and radial clamping: diagonals must not move faster. */
export function stickVector(dx: number, dy: number, radius: number): StickVector {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0)
    return { x: 0, y: 0 };
  const distance = Math.hypot(dx, dy);
  const deadZone = radius * 0.12;
  if (distance <= deadZone) return { x: 0, y: 0 };
  const strength = Math.min(1, (distance - deadZone) / (radius - deadZone));
  return { x: (dx / distance) * strength, y: (dy / distance) * strength };
}

/** Bound each physics move, including the first frame after an interrupted tab. */
export function stickStep(vector: StickVector, elapsedMs: number): StickVector {
  const seconds = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.min(elapsedMs, 50)) / 1000
    : 0;
  return { x: vector.x * 2.4 * seconds, y: vector.y * 2.4 * seconds };
}

export class JoystickState {
  pointerId: number | null = null;
  vector: StickVector = { x: 0, y: 0 };

  down(pointerId: number): boolean {
    if (this.pointerId !== null) return false;
    this.pointerId = pointerId;
    this.vector = { x: 0, y: 0 };
    return true;
  }

  move(pointerId: number, dx: number, dy: number, radius: number) {
    if (pointerId === this.pointerId) this.vector = stickVector(dx, dy, radius);
  }

  up(pointerId: number) {
    if (pointerId === this.pointerId) this.cancel();
  }

  cancel() {
    this.pointerId = null;
    this.vector = { x: 0, y: 0 };
  }
}

/** The pad is persistent: re-rendering the selected brick must not lose capture. */
export function bindJoystick(
  pad: HTMLElement,
  move: (x: number, y: number) => void,
  enabled: () => boolean,
  start: () => void,
) {
  const state = new JoystickState();
  const doc = pad.ownerDocument;
  const view = doc.defaultView!;
  let frame = 0;
  let previous = 0;

  function paint() {
    const travel = Math.min(pad.clientWidth, pad.clientHeight) * 0.3;
    pad.style.setProperty("--stick-x", `${state.vector.x * travel}px`);
    pad.style.setProperty("--stick-y", `${state.vector.y * travel}px`);
    pad.classList.toggle("active", state.pointerId !== null);
  }

  function cancel() {
    const pointerId = state.pointerId;
    state.cancel();
    view.cancelAnimationFrame(frame);
    frame = 0;
    if (pointerId !== null && pad.hasPointerCapture(pointerId))
      pad.releasePointerCapture(pointerId);
    paint();
  }

  function tick(now: number) {
    if (state.pointerId === null || !enabled()) return cancel();
    const step = stickStep(state.vector, now - previous);
    previous = now;
    if (step.x || step.y) move(step.x, step.y);
    // A callback may cancel the gesture (for example, selection changed).
    if (state.pointerId !== null) frame = view.requestAnimationFrame(tick);
  }

  function position(event: PointerEvent) {
    const rect = pad.getBoundingClientRect();
    state.move(
      event.pointerId,
      event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2,
      Math.min(rect.width, rect.height) * 0.3,
    );
    paint();
  }

  pad.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !enabled() || state.pointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    start();
    if (!enabled() || !state.down(event.pointerId)) return;
    pad.setPointerCapture(event.pointerId);
    position(event);
    previous = view.performance.now();
    frame = view.requestAnimationFrame(tick);
  });
  pad.addEventListener("pointermove", (event) => {
    if (event.pointerId !== state.pointerId) return;
    event.preventDefault();
    position(event);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    pad.addEventListener(type, (event) => {
      if ((event as PointerEvent).pointerId === state.pointerId) cancel();
    });
  pad.addEventListener("contextmenu", (event) => event.preventDefault());
  // Keyboard/assistive-technology alternative to the analog gesture.
  pad.addEventListener("keydown", (event) => {
    const direction: Record<string, StickVector> = {
      ArrowLeft: { x: -0.12, y: 0 },
      ArrowRight: { x: 0.12, y: 0 },
      ArrowUp: { x: 0, y: -0.12 },
      ArrowDown: { x: 0, y: 0.12 },
    };
    const step = direction[event.key];
    if (!step || !enabled()) return;
    event.preventDefault();
    event.stopPropagation();
    start();
    move(step.x, step.y);
  });
  view.addEventListener("blur", cancel);
  view.addEventListener("pagehide", cancel);
  view.addEventListener("resize", cancel);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) cancel();
  });
  return { cancel };
}
