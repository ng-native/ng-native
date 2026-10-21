/**
 * `DOMRectReadOnly`, `DOMRect` and `DOMRectList`: what `getBoundingClientRect`, `getClientRects`
 * and the observers answer with, and what a library makes a rectangle of its own with. Each side
 * is worked out from the origin and the size, so a rectangle of a negative width still has its
 * `left` at its smaller edge, as a browser's does.
 */

/** A number as a `double` an IDL method takes: anything at all, with no error for `NaN`. */
const number = (value: unknown): number => (value === undefined ? 0 : Number(value));

interface RectInit {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

/** Each rectangle's origin and size, kept off the object as a browser keeps them. */
const sides = new WeakMap<object, { x: number; y: number; width: number; height: number }>();
const of = (rect: object) => sides.get(rect) ?? { x: 0, y: 0, width: 0, height: 0 };

/** A rectangle that is read, not written: an observer's entry and a range's box. */
export class DOMRectReadOnly {
  constructor(x?: unknown, y?: unknown, width?: unknown, height?: unknown) {
    sides.set(this, { x: number(x), y: number(y), width: number(width), height: number(height) });
  }

  static fromRect(other?: RectInit): DOMRectReadOnly {
    return new this(other?.x, other?.y, other?.width, other?.height);
  }

  get x(): number {
    return of(this).x;
  }
  get y(): number {
    return of(this).y;
  }
  get width(): number {
    return of(this).width;
  }
  get height(): number {
    return of(this).height;
  }
  get top(): number {
    const { y, height } = of(this);
    return Math.min(y, y + height);
  }
  get right(): number {
    const { x, width } = of(this);
    return Math.max(x, x + width);
  }
  get bottom(): number {
    const { y, height } = of(this);
    return Math.max(y, y + height);
  }
  get left(): number {
    const { x, width } = of(this);
    return Math.min(x, x + width);
  }

  /** What a library logs or sends: every side, as plain numbers. */
  toJSON(): Record<string, number> {
    const { x, y, width, height, top, right, bottom, left } = this;
    return { x, y, width, height, top, right, bottom, left };
  }

  get [Symbol.toStringTag](): string {
    return 'DOMRectReadOnly';
  }

  /** For `DOMRect`, which writes what this only reads. */
  protected place(key: 'x' | 'y' | 'width' | 'height', value: unknown): void {
    of(this)[key] = number(value);
  }
}

/** A rectangle a script can move and size: what `getBoundingClientRect` answers. */
export class DOMRect extends DOMRectReadOnly {
  static override fromRect(other?: RectInit): DOMRect {
    return new this(other?.x, other?.y, other?.width, other?.height);
  }

  override get x(): number {
    return super.x;
  }
  override set x(value: number) {
    this.place('x', value);
  }
  override get y(): number {
    return super.y;
  }
  override set y(value: number) {
    this.place('y', value);
  }
  override get width(): number {
    return super.width;
  }
  override set width(value: number) {
    this.place('width', value);
  }
  override get height(): number {
    return super.height;
  }
  override set height(value: number) {
    this.place('height', value);
  }

  override get [Symbol.toStringTag](): string {
    return 'DOMRect';
  }
}

/** What each list holds. */
const lists = new WeakMap<DOMRectList, readonly DOMRect[]>();

/** The boxes an element is drawn in, as `getClientRects` lists them. */
export class DOMRectList {
  [index: number]: DOMRect;

  constructor(rects: readonly DOMRect[]) {
    lists.set(this, rects);
    rects.forEach((rect, at) => Object.defineProperty(this, at, { value: rect, enumerable: true }));
  }

  get length(): number {
    return lists.get(this)?.length ?? 0;
  }

  item(index: number): DOMRect | null {
    return lists.get(this)?.[index] ?? null;
  }

  [Symbol.iterator](): Iterator<DOMRect> {
    return (lists.get(this) ?? [])[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return 'DOMRectList';
  }
}
