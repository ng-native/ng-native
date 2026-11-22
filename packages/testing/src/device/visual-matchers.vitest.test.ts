/**
 * `toHaveStyle` reads the view's latest committed record, through the harness's recorder, rather
 * than the record a test kept from an earlier query.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FakeFabricNode } from '../test-utils.ts';
import { setHarness, type Harness } from './harness.ts';
import { installVisualMatchers } from './visual-matchers.ts';

const committed = new Map<number, { props: Record<string, unknown> }>();

beforeAll(() => {
  setHarness({
    recorder: { current: (tag: number) => committed.get(tag) },
  } as unknown as Harness);
  installVisualMatchers();
});

const kept = { reactTag: 7, props: { opacity: 1 } } as unknown as FakeFabricNode;

describe('toHaveStyle on a node the test kept', () => {
  it('compares the props committed since, not those it was queried with', () => {
    committed.set(7, { props: { opacity: 0.5 } });
    expect(kept).toHaveStyle({ opacity: 0.5 });
    expect(kept).not.toHaveStyle({ opacity: 1 });
  });

  it('says the node is gone, with or without .not, once it is no longer committed', () => {
    committed.delete(7);
    expect(() => expect(kept).toHaveStyle({ opacity: 1 })).toThrow(/no longer committed/);
    expect(() => expect(kept).not.toHaveStyle({ opacity: 1 })).toThrow(/no longer committed/);
  });
});
