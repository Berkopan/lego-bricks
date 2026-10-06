import { test } from "node:test";
import assert from "node:assert/strict";
import { bindJoystick, keepsJoystickWhile } from "../src/input/joystick.ts";
import { bindRepeatActions, type MovementPhase } from "../src/input/touch.ts";
import { MovementSession } from "../src/input/movement.ts";

// A deterministic event/capture clock exercises the real DOM binding callbacks.
// Releasing capture also dispatches lostpointercapture, as a browser does.
class Target {
  listeners = new Map<string, ((event: any) => void)[]>();
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, fields: Record<string, unknown> = {}) {
    let stopped = false;
    const event = {
      type, target: this, button: 0, pointerId: 1, clientX: 80, clientY: 50,
      detail: 0, repeat: false, defaultPrevented: false, ...fields,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() { stopped = true; },
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
      if (stopped) break;
    }
    return event;
  }
}
class Clock extends Target {
  time = 0;
  sequence = 0;
  frames = new Map<number, (now: number) => void>();
  timers = new Map<number, { callback: () => void; repeat: boolean }>();
  performance = { now: () => this.time };
  requestAnimationFrame(callback: (now: number) => void) {
    const id = ++this.sequence;
    this.frames.set(id, callback);
    return id;
  }
  cancelAnimationFrame(id: number) { this.frames.delete(id); }
  frame() {
    this.time += 16;
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(this.time);
  }
  setTimeout(callback: () => void) {
    const id = ++this.sequence;
    this.timers.set(id, { callback, repeat: false });
    return id;
  }
  setInterval(callback: () => void) {
    const id = ++this.sequence;
    this.timers.set(id, { callback, repeat: true });
    return id;
  }
  clearTimeout(id: number) { this.timers.delete(id); }
  clearInterval(id: number) { this.timers.delete(id); }
  fireTimers() {
    for (const [id, timer] of [...this.timers]) {
      if (!timer.repeat) this.timers.delete(id);
      timer.callback();
    }
  }
}
class Surface extends Target {
  clientWidth = 100;
  clientHeight = 100;
  captured = new Set<number>();
  style = { setProperty() {} };
  classList = { toggle() {} };
  constructor(readonly ownerDocument: Target & { defaultView: Clock; hidden: boolean }) { super(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
    this.emit("lostpointercapture", { pointerId: id });
  }
  get element() { return this as unknown as HTMLElement; }
}
function fixture() {
  const view = new Clock();
  const doc = Object.assign(new Target(), { defaultView: view, hidden: false });
  return { view, doc, pad: new Surface(doc), panel: new Surface(doc) };
}
function button(action = "up") {
  return { disabled: false, dataset: { repeat: action }, closest() { return this; } };
}

test("joystick emits one normal release after movement, despite lost capture and orphaned events", () => {
  const { pad, view } = fixture();
  const events: string[] = [];
  bindJoystick(pad.element, () => events.push("move"), () => true,
    () => events.push("prepare"), phase => events.push(phase));
  pad.emit("pointerdown");
  view.frame();
  pad.emit("pointerup", { pointerId: 99 });
  assert.deepEqual(events, ["prepare", "start", "move"]);
  pad.emit("pointerup");
  pad.emit("pointermove");
  pad.emit("pointerup");
  view.frame();
  assert.deepEqual(events, ["prepare", "start", "move", "release"]);
  assert.equal(pad.captured.size, 0);
});

test("joystick center taps, aborted gestures and disabled controls cannot commit", () => {
  for (const ending of ["center", "pointercancel", "lostpointercapture", "blur", "disabled"]) {
    const { pad, view } = fixture();
    const phases: string[] = [];
    let enabled = true;
    bindJoystick(pad.element, () => {}, () => enabled, () => {}, phase => phases.push(phase));
    pad.emit("pointerdown", { clientX: ending === "center" ? 50 : 80 });
    view.frame();
    if (ending === "disabled") enabled = false;
    if (ending === "blur") view.emit("blur");
    else pad.emit(ending === "center" || ending === "disabled" ? "pointerup" : ending);
    pad.emit("pointerup");
    assert.deepEqual(phases, ["start", "cancel"], ending);
  }
});

test("joystick arrow-key chords release only after the last held key", () => {
  const { pad, view } = fixture();
  const phases: string[] = [];
  const moves: number[][] = [];
  let preparations = 0;
  bindJoystick(pad.element, (x, y) => moves.push([x, y]), () => true,
    () => preparations++, phase => phases.push(phase));
  pad.emit("keydown", { key: "ArrowLeft" });
  pad.emit("keydown", { key: "ArrowLeft", repeat: true });
  pad.emit("keydown", { key: "ArrowUp" });
  view.emit("keyup", { key: "ArrowLeft" });
  assert.deepEqual(phases, ["start"]);
  view.emit("keyup", { key: "ArrowUp" });
  assert.deepEqual(phases, ["start", "release"]);
  assert.deepEqual(moves, [[-0.12, 0], [-0.12, 0], [0, -0.12]]);
  assert.equal(preparations, 1);
});

test("losing keyboard focus cancels and later orphaned key repeats cannot restart movement", () => {
  const { pad, view } = fixture();
  const phases: string[] = [];
  bindJoystick(pad.element, () => {}, () => true, () => {}, phase => phases.push(phase));
  pad.emit("keydown", { key: "ArrowRight" });
  pad.emit("blur");
  pad.emit("keydown", { key: "ArrowRight", repeat: true });
  view.emit("keyup", { key: "ArrowRight" });
  assert.deepEqual(phases, ["start", "cancel"]);
});

test("height and joystick support both start/release orders and commit only after the final finger", () => {
  for (const startHeightFirst of [true, false]) for (const releaseHeightFirst of [true, false]) {
    const { pad, panel, view } = fixture();
    const phases: string[] = [];
    const session = new MovementSession();
    let planarMoves = 0, heightMoves = 0, commits = 0;
    function movement(source: string, phase: MovementPhase) {
      phases.push(`${source}:${phase}`);
      if (phase === "start") session.start(source);
      else if (session.end(source, phase === "release")) commits++;
    }
    const repeat = bindRepeatActions(panel.element,
      () => { heightMoves++; session.edit(); }, phase => movement("repeat", phase));
    bindJoystick(pad.element, () => { planarMoves++; session.edit(); }, () => true, () => {
      if (!keepsJoystickWhile(repeat.action)) repeat.cancel();
      // The main cancelDrag hook also runs when no canvas drag owns movement.
      session.end("drag", false);
    }, phase => movement("stick", phase));
    const startStick = () => pad.emit("pointerdown", { pointerId: 1 });
    const startHeight = () => panel.emit("pointerdown", { pointerId: 2, target: button() });
    if (startHeightFirst) { startHeight(); startStick(); }
    else { startStick(); startHeight(); }
    view.frame();
    assert.deepEqual(phases, startHeightFirst ? ["repeat:start", "stick:start"] : ["stick:start", "repeat:start"]);
    if (releaseHeightFirst) {
      panel.emit("pointerup", { pointerId: 2 });
      assert.equal(commits, 0);
      assert.equal(session.active, true);
      const before = planarMoves;
      view.frame();
      assert.ok(planarMoves > before, "height release must not stop the stick");
      pad.emit("pointerup", { pointerId: 1 });
      assert.deepEqual(phases.slice(2), ["repeat:release", "stick:release"]);
    } else {
      pad.emit("pointerup", { pointerId: 1 });
      assert.equal(commits, 0);
      assert.equal(session.active, true);
      view.fireTimers(); view.fireTimers();
      assert.ok(heightMoves > 1, "stick release must not stop held height control");
      panel.emit("pointerup", { pointerId: 2 });
      assert.deepEqual(phases.slice(2), ["stick:release", "repeat:release"]);
    }
    assert.equal(commits, 1);
    assert.equal(session.active, false, "no movement source remains after both releases");
    assert.equal(repeat.action, undefined);
  }
});

test("repeat buttons distinguish successful release from cancellation and suppress duplicate physical clicks", () => {
  for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
    const { panel, view } = fixture();
    const events: string[] = [];
    const target = button();
    bindRepeatActions(panel.element, action => events.push(action), phase => events.push(phase));
    panel.emit("pointerdown", { target });
    panel.emit(ending);
    panel.emit("pointerup");
    panel.emit("click", { target, detail: 1 });
    view.fireTimers();
    assert.deepEqual(events, ["start", "up", ending === "pointerup" ? "release" : "cancel"]);
  }
});

test("keyboard height activation is bracketed by lifecycle events and consumes Space", () => {
  const { panel, view } = fixture();
  const events: string[] = [];
  bindRepeatActions(panel.element, action => events.push(action), phase => events.push(phase));
  const target = button("down");
  assert.ok(panel.emit("keydown", { target, key: " " }).defaultPrevented);
  panel.emit("keydown", { target, key: " ", repeat: true });
  assert.deepEqual(events, ["start", "down", "down"]);
  view.emit("keyup", { key: " " });
  assert.deepEqual(events, ["start", "down", "down", "release"]);
});

test("assistive-technology nudges allow a rendered preview before release and can be cancelled", () => {
  for (const cancelled of [false, true]) {
    const { panel, view } = fixture();
    const events: string[] = [];
    const binding = bindRepeatActions(panel.element, action => events.push(action), phase => events.push(phase));
    panel.emit("click", { target: button("left"), detail: 0 });
    assert.deepEqual(events, ["start", "left"]);
    view.frame();
    assert.deepEqual(events, ["start", "left"], "do not snap before the preview can render");
    if (cancelled) binding.cancel();
    view.frame();
    assert.deepEqual(events, ["start", "left", cancelled ? "cancel" : "release"]);
  }
});
