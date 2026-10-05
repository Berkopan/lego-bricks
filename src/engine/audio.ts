/** Local CC0 recordings, decoded once after a user gesture. No synthesized clicks. */
export class BrickAudio {
  enabled = true;
  private ctx?: AudioContext;
  private buffers: AudioBuffer[] = [];
  private loading?: Promise<void>;
  private lastImpact = -Infinity;
  private impactQuietUntil = 0;
  async unlock() {
    try {
      this.ctx ??= new AudioContext();
      await this.ctx.resume();
      if (!this.loading)
        this.loading = Promise.all(
          [
            "lego-tap.mp3",
            "connect-1.wav",
            "connect-2.wav",
            "connect-3.wav",
          ].map(async (name) => {
            const r = await fetch(`${import.meta.env.BASE_URL}audio/${name}`);
            if (!r.ok) throw Error("Audio unavailable");
            return this.ctx!.decodeAudioData(await r.arrayBuffer());
          }),
        )
          .then((b) => {
            this.buffers = b;
          })
          .catch((e) => {
            this.loading = undefined;
            console.warn(e);
          });
      await this.loading;
    } catch (e) {
      console.warn("Audio unavailable", e);
    }
  }
  play(strength = 0.5, release = false, connection = false) {
    if (!this.enabled || !this.ctx || !this.buffers.length) return;
    const deliberate = release || connection;
    if (deliberate) this.impactQuietUntil = this.ctx.currentTime + 0.3;
    else {
      if (
        this.ctx.currentTime < this.impactQuietUntil ||
        this.ctx.currentTime - this.lastImpact < 0.065
      )
        return;
      this.lastImpact = this.ctx.currentTime;
    }
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    source.buffer =
      this.buffers[
        connection || release ? 1 + Math.floor(Math.random() * 3) : 0
      ];
    source.playbackRate.value =
      (release ? 0.88 : 1) + (Math.random() - 0.5) * 0.06;
    gain.gain.value = Math.min(0.85, Math.max(0.03, strength));
    source.connect(gain).connect(this.ctx.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }
}
