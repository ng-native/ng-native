/**
 * The weak list an iterator is held in until it is let go of: one whose iterators are gone is
 * let go of as more are added, not only once a node is taken out.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WeakList } from './weak-list.ts';

/** A ref whose value is gone, as one is once the value is collected. */
const gone = { deref: () => undefined };

describe('a weak list', () => {
  it('lets go of the refs whose values are gone as more are added', () => {
    const list = new WeakList<object>();
    const kept = {};
    list.add(new WeakRef(kept));
    for (let made = 0; made < 1000; made++) list.add({ ...gone });
    assert.ok(list.size < 40, `${list.size} held`);
    const seen: object[] = [];
    list.forEach((value) => seen.push(value));
    assert.deepEqual(seen, [kept]);
    assert.equal(list.size, 1);
  });
});
