/** Several controls can edit one held assembly at once (for example stick + lift).
 * Only the final normal release of an edited session may accept a snap preview.
 */
export class MovementSession {
  private sources = new Set<string>();
  private moved = false;
  private cancelled = false;

  get active() {
    return this.sources.size > 0;
  }

  start(source: string) {
    if (!this.active) {
      this.moved = false;
      this.cancelled = false;
    }
    this.sources.add(source);
  }

  edit() {
    if (this.active) this.moved = true;
  }

  end(source: string, commit: boolean) {
    if (!this.sources.delete(source)) return false;
    if (!commit) this.cancelled = true;
    if (this.active) return false;
    const accept = commit && this.moved && !this.cancelled;
    this.cancel();
    return accept;
  }

  cancel() {
    this.sources.clear();
    this.moved = false;
    this.cancelled = false;
  }
}
