/**
 * Random choices from a seed, as the generator makes them.
 */
import type { Declaration } from './case.ts';

/** Mulberry32: small, fast, and the same everywhere. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PERCENTS = ['10%', '25%', '30%', '50%', '75%', '100%'];

/** A declaration written with a chance: its property, or how to pick one, and its value. */
export type Optional = readonly [
  chance: number,
  property: string | ((pick: Picker) => string),
  value: (pick: Picker) => string,
];

export class Picker {
  readonly next: () => number;
  /** Whether a size may be a percentage. */
  readonly percentages: boolean;
  constructor(seed: number, percentages: boolean) {
    this.next = random(seed);
    this.percentages = percentages;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  one<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  px(min: number, max: number): string {
    return `${this.int(min, max)}px`;
  }
  size(): string {
    return this.percentages && this.chance(0.25) ? this.one(PERCENTS) : this.px(0, 160);
  }
  words(): string {
    return Array.from({ length: this.int(1, 4) }, () => 'x'.repeat(this.int(1, 6))).join(' ');
  }
  /** Each declaration of a list, each with its own chance. */
  some(own: Declaration[], optional: readonly Optional[]): void {
    for (const [chance, property, value] of optional) {
      if (!this.chance(chance)) continue;
      own.push([typeof property === 'string' ? property : property(this), value(this)]);
    }
  }
}
