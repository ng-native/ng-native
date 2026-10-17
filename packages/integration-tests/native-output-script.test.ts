/**
 * `scripts/native-output.mjs diff`: what changed between two checkouts' screens, as a pull
 * request's description lists it, and the exit code a gate reads.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
// A script of the repository's, not a package: loaded by its path, which no import can name.
const { compare, differences, report } = await import(
  new URL('../../scripts/native-output.mjs', import.meta.url).href
);

const script = new URL('../../scripts/native-output.mjs', import.meta.url);

const view = (name: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  view: name,
  props,
  children,
});

/** Two directories of screens, as `write` leaves them, and what `check` makes of them. */
function screens(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  check: (beforeDir: string, afterDir: string) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), 'native-output-'));
  try {
    const dirs = [path.join(root, 'before'), path.join(root, 'after')];
    for (const [dir, files] of [
      [dirs[0]!, before],
      [dirs[1]!, after],
    ] as const) {
      mkdirSync(dir);
      for (const [name, screen] of Object.entries(files)) {
        writeFileSync(path.join(dir, name), JSON.stringify(screen));
      }
    }
    check(dirs[0]!, dirs[1]!);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('native-output differences', () => {
  it('names the view a prop changed on by its place, and each prop that did', () => {
    const before = [view('View', {}, [view('Text', { color: 'red', fontSize: 12 })])];
    const after = [view('View', {}, [view('Text', { color: 'blue', fontSize: 12, margin: 4 })])];
    assert.deepEqual(differences(before, after), [
      {
        place: 'View[0] > Text[0]',
        kind: 'props',
        props: [
          { key: 'color', from: 'red', to: 'blue' },
          { key: 'margin', from: undefined, to: 4 },
        ],
      },
    ]);
  });

  it('tells a view that came, went, or is another view in its place', () => {
    assert.deepEqual(differences([view('View')], [view('View'), view('Text')]), [
      { place: 'Text[1]', kind: 'added' },
    ]);
    assert.deepEqual(differences([view('View'), view('Text')], [view('View')]), [
      { place: 'Text[1]', kind: 'removed' },
    ]);
    assert.deepEqual(differences([view('View')], [view('Image')]), [
      { place: 'Image[0]', kind: 'replaced', from: 'View', to: 'Image' },
    ]);
  });

  it('finds nothing for the same screen', () => {
    const tree = [view('View', { flex: 1 }, [view('Text', { color: 'red' })])];
    assert.deepEqual(differences(tree, structuredClone(tree)), []);
  });
});

describe('native-output diff', () => {
  const screen = (props: Record<string, unknown>) => ({
    url: '/a',
    tailwind: true,
    views: [view('View', props)],
  });

  it('exits 1 and lists the screens that changed, and 0 where none did', () => {
    screens({ 'a.json': screen({ height: 96 }) }, { 'a.json': screen({ height: 97 }) }, (a, b) => {
      const run = spawnSync(process.execPath, [script.pathname, 'diff', a, b], {
        encoding: 'utf8',
      });
      assert.equal(run.status, 1);
      assert.match(run.stdout, /1 of 1 screens changed/);
      assert.match(run.stdout, /`height` 96 → 97/);
    });
    screens({ 'a.json': screen({ height: 96 }) }, { 'a.json': screen({ height: 96 }) }, (a, b) => {
      const run = spawnSync(process.execPath, [script.pathname, 'diff', a, b], {
        encoding: 'utf8',
      });
      assert.equal(run.status, 0);
      assert.match(run.stdout, /0 of 1 screens changed/);
    });
  });

  it('counts a screen that throws on one side only as a change, and the same throw as none', () => {
    const threw = (message: string) => ({ url: '/a', tailwind: true, threw: message });
    screens({ 'a.json': screen({}) }, { 'a.json': threw('boom') }, (a, b) => {
      const [result] = compare(a, b);
      assert.match(result.notes.join(), /throws where it rendered: boom/);
    });
    screens({ 'a.json': threw('boom') }, { 'a.json': threw('boom') }, (a, b) => {
      const results = compare(a, b);
      assert.deepEqual(results[0].changes, []);
      assert.match(report(results), /throw in Node on both sides[\s\S]*`\/a`: boom/);
    });
  });

  it('counts a screen written on one side only, and lists the screens left out', () => {
    screens({ 'a.json': screen({}) }, {}, (a, b) => {
      assert.match(report(compare(a, b)), /`\/a`: written only before/);
    });
    assert.match(
      report([], { worklets: 'never yields' }),
      /Not compared, as they cannot be rendered in Node:\n- `\/worklets`: never yields/,
    );
  });
});
