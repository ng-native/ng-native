/**
 * A revised document shares what did not change with the one drawn before, in work that grows
 * with the document, not with how deeply its blocks nest.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shareBlocks, type MarkdownBlock } from '../components/src/markdown-blocks.ts';

/** A quote in a quote, `depth` deep, round a text; each block counts the times it is compared. */
function nested(depth: number, text: string, count: { reads: number }): MarkdownBlock[] {
  const counted = (block: Record<string, unknown>, kind: string) =>
    Object.defineProperty(block, 'kind', {
      enumerable: true,
      get: () => (count.reads++, kind),
    });
  let blocks: unknown[] = [counted({ text }, 'paragraph')];
  for (let level = 0; level < depth; level++) blocks = [counted({ blocks }, 'quote')];
  return blocks as MarkdownBlock[];
}

describe('shareBlocks', () => {
  it('compares each changed block once, however deeply it nests', () => {
    const count = { reads: 0 };
    const previous = nested(12, 'before', count);
    const next = nested(12, 'after', { reads: 0 });
    const shared = shareBlocks(previous, next);
    assert.notEqual(shared, previous);
    assert.ok(count.reads < 100, `${count.reads} comparisons for 13 blocks`);
  });
});
