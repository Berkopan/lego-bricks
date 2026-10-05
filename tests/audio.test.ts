import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BrickAudio } from "../src/engine/audio";
for (const name of ["connect-1.wav", "connect-2.wav", "connect-3.wav"])
  test(`${name} is audible, short, unclipped and faded`, () => {
    const b = readFileSync(new URL(`../public/audio/${name}`, import.meta.url));
    let samples: Buffer | undefined;
    let rate = 0,
      channels = 0;
    for (let i = 12; i + 8 <= b.length;) {
      const size = b.readUInt32LE(i + 4),
        tag = b.toString("ascii", i, i + 4);
      if (tag === "fmt ") {
        assert.equal(b.readUInt16LE(i + 8), 1);
        channels = b.readUInt16LE(i + 10);
        rate = b.readUInt32LE(i + 12);
        assert.equal(b.readUInt16LE(i + 22), 16);
      }
      if (tag === "data") samples = b.subarray(i + 8, i + 8 + size);
      i += 8 + size + (size % 2);
    }
    assert.ok(samples);
    let peak = 0,
      energy = 0;
    for (let i = 0; i < samples.length; i += 2) {
      const v = samples.readInt16LE(i) / 32768;
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
    }
    assert.ok(peak > 0.35 && peak <= 0.501);
    assert.ok(Math.sqrt(energy / (samples.length / 2)) > 0.005);
    assert.ok(samples.length / 2 / channels / rate < 0.15);
    assert.equal(samples.readInt16LE(0), 0);
    assert.equal(samples.readInt16LE(samples.length - 2), 0);
  });
test("connection sound is not swallowed by impact cooldown; settling impacts are suppressed", () => {
  const started: unknown[] = [];
  const ctx = {
    currentTime: 1,
    destination: {},
    createBufferSource: () => ({
      buffer: null,
      playbackRate: { value: 1 },
      connect() {
        return this;
      },
      disconnect() {},
      start() {
        started.push(this.buffer);
      },
    }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
  };
  const audio = new BrickAudio();
  Object.assign(audio, { ctx, buffers: ["impact", "snap1", "snap2", "snap3"] });
  audio.play(0.5);
  audio.play(0.8, false, true);
  assert.equal(started.length, 2);
  assert.equal(started[0], "impact");
  assert.notEqual(started[1], "impact");
  ctx.currentTime = 1.15;
  audio.play(0.5);
  assert.equal(started.length, 2);
  ctx.currentTime = 1.5;
  audio.play(0.5);
  assert.equal(started.length, 3);
});
