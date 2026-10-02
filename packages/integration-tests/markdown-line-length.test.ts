/**
 * `docs/README.md` states Markdown is 100 columns, but Prettier only wraps code, not prose, so
 * nothing else enforces that limit. This holds it, for the two places a page for an app author or
 * a package's README lives: every page under `apps/documentation/src/content`, and every
 * `README.md` directly inside a `packages/*` directory.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findAllLongLines, findLongLines, LIMIT } from './markdown-line-length.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('findLongLines', () => {
  it('flags a prose line over the limit', () => {
    const line = `${'word '.repeat(Math.ceil((LIMIT + 1) / 5))}`.slice(0, LIMIT + 1);
    assert.deepEqual(findLongLines('x.md', line), [
      { file: 'x.md', line: 1, length: line.length, kind: 'prose' },
    ]);
  });

  it('leaves a line at the limit alone', () => {
    const line = `${'word '.repeat(Math.ceil(LIMIT / 5))}`.slice(0, LIMIT);
    assert.deepEqual(findLongLines('x.md', line), []);
  });

  // Words, not one long token, so the line is one the single-token rule would not excuse.
  const words = 'word '.repeat(LIMIT / 4);

  it('excludes a fenced code block', () => {
    const text = ['```ts', words, '```'].join('\n');
    assert.deepEqual(findLongLines('x.md', text), []);
  });

  it('excludes a block fenced with tildes', () => {
    const text = ['~~~ts', words, '~~~', 'after'].join('\n');
    assert.deepEqual(findLongLines('x.md', text), []);
  });

  it('flags prose after a fence closes', () => {
    const text = ['```ts', 'code', '```', words].join('\n');
    assert.equal(findLongLines('x.md', text).length, 1);
  });

  it('excludes a table row', () => {
    const text = `| ${'a'.repeat(LIMIT)} | ${'b'.repeat(LIMIT)} |`;
    assert.deepEqual(findLongLines('x.md', text), []);
  });

  it('excludes a line that is a single unbreakable token', () => {
    const text = `https://example.com/${'a'.repeat(LIMIT)}`;
    assert.deepEqual(findLongLines('x.md', text), []);
  });

  it('excludes a list item or quote whose content is a single token', () => {
    const url = `https://example.com/${'a'.repeat(LIMIT)}`;
    for (const marker of ['- ', '* ', '1. ', '> ']) {
      assert.deepEqual(findLongLines('x.md', marker + url), [], marker);
    }
  });

  it('excludes front matter other than summary', () => {
    const text = ['---', `title: ${'a'.repeat(LIMIT)}`, '---'].join('\n');
    assert.deepEqual(findLongLines('x.md', text), []);
  });

  it('flags an over-length summary line in front matter', () => {
    const summary = `summary: ${'a'.repeat(LIMIT)}`;
    const text = ['---', summary, '---'].join('\n');
    assert.deepEqual(findLongLines('x.md', text), [
      { file: 'x.md', line: 2, length: summary.length, kind: 'summary' },
    ]);
  });
});

describe('markdown prose and summaries in the repository', () => {
  it('has no line over 100 columns outside a table, a code fence or a single token', () => {
    const violations = findAllLongLines(REPO_ROOT);
    if (violations.length === 0) return;

    const report = violations
      .map((v) => `${v.file}:${v.line} (${v.kind}, ${v.length} columns)`)
      .join('\n');
    assert.fail(`${violations.length} line(s) over ${LIMIT} columns:\n${report}`);
  });
});
