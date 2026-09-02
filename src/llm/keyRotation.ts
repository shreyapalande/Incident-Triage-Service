export interface KeyRotatorOptions {
  /** How long a key stays benched after being reported rate-limited. */
  cooldownMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/**
 * Round-robins across a pool of API keys and benches any key reported as
 * rate-limited for `cooldownMs`, falling back to it only once every key is
 * benched. Pure and I/O-free so it can be unit tested without a real API.
 */
export class KeyRotator {
  private readonly keys: string[];
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly cooldownUntil = new Map<string, number>();
  private cursor = 0;

  constructor(keys: string[], options: KeyRotatorOptions = {}) {
    if (keys.length === 0) {
      throw new Error("KeyRotator requires at least one API key");
    }
    this.keys = keys;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Number of keys in the pool. */
  get size(): number {
    return this.keys.length;
  }

  /** Returns the next available key, preferring one that isn't benched. */
  getKey(): string {
    const t = this.now();

    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[this.cursor % this.keys.length];
      this.cursor++;
      const benchedUntil = this.cooldownUntil.get(key);
      if (benchedUntil === undefined || benchedUntil <= t) {
        return key;
      }
    }

    // Every key is benched - return the one that frees up soonest.
    return this.keys.reduce((soonest, key) => {
      const soonestUntil = this.cooldownUntil.get(soonest) ?? 0;
      const keyUntil = this.cooldownUntil.get(key) ?? 0;
      return keyUntil < soonestUntil ? key : soonest;
    });
  }

  /** Marks a key as rate-limited so it's skipped until the cooldown elapses. */
  reportRateLimited(key: string): void {
    this.cooldownUntil.set(key, this.now() + this.cooldownMs);
  }

  /** Clears a key's cooldown, e.g. after a confirmed successful call. */
  reportSuccess(key: string): void {
    this.cooldownUntil.delete(key);
  }

  /** True if every key in the pool is currently benched. */
  isExhausted(): boolean {
    const t = this.now();
    return this.keys.every((key) => (this.cooldownUntil.get(key) ?? 0) > t);
  }
}

/** Parses a comma-separated env var into a trimmed, non-empty key list. */
export function parseKeysFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}
