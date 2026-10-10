/**
 * The target the user deliberately rested on: the last one aimed at for at
 * least `holdMs`. Reaching for a button in the side panel sweeps the aim across
 * other targets, or off the page, on the way; those brief passes do not count,
 * so a request about "this" target means the one the user rested on.
 */
export class SettledAim<T> {
  private current: { value: T; since: number } | null = null;
  private settled: T | null = null;

  /** `same` tells whether two values are the same target, so a fresh scan of it keeps its hold time. */
  constructor(
    private readonly same: (a: T, b: T) => boolean,
    private readonly holdMs = 800,
  ) {}

  /** Records the aim from time `now` on, or null for no aim. */
  update(value: T | null, now: number): void {
    if (this.current && value !== null && this.same(this.current.value, value)) {
      this.current.value = value;
      return;
    }
    if (this.current && now - this.current.since >= this.holdMs) this.settled = this.current.value;
    this.current = value === null ? null : { value, since: now };
  }

  /** The rested-on target at `now`: the current aim once held long enough, else the last one that was. */
  get(now: number): T | null {
    if (this.current && now - this.current.since >= this.holdMs) return this.current.value;
    return this.settled;
  }

  reset(): void {
    this.current = null;
    this.settled = null;
  }
}
