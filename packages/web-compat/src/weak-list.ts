/**
 * Values held weakly, in the order they were added: each iterator `traversal.ts` moves off a
 * node taken out. A ref whose value is gone is let go of as a walk over them finds it, and as
 * more are added, so an app that makes iterators and takes nothing out does not hold a ref for
 * every one it ever made.
 */
export class WeakList<T extends object> {
  private readonly refs = new Set<{ deref(): T | undefined }>();
  /** The count at which the refs are next looked over, twice what was left the last time. */
  private sweepAt = 16;

  get size(): number {
    return this.refs.size;
  }

  add(ref: { deref(): T | undefined }): void {
    this.refs.add(ref);
    if (this.refs.size < this.sweepAt) return;
    for (const each of this.refs) if (!each.deref()) this.refs.delete(each);
    this.sweepAt = Math.max(16, this.refs.size * 2);
  }

  /** Each value still held, in order, on a copy: `each` may add to the list. */
  forEach(each: (value: T) => void): void {
    for (const ref of [...this.refs]) {
      const value = ref.deref();
      if (value) each(value);
      else this.refs.delete(ref);
    }
  }
}
