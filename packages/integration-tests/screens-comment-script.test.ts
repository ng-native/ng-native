/**
 * `scripts/screens-comment.mjs`: the pull request comment on a change's screens, written from what
 * a pull request's run uploaded, which a fork controls.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
// A script of the repository's, not a package: loaded by its path, which no import can name.
const {
  MARK,
  clean,
  differs,
  images,
  incomplete,
  merge,
  nativeMissing,
  nativeSection,
  screenshotSection,
  worth,
} = await import(new URL('../../scripts/screens-comment.mjs', import.meta.url).href);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** A directory of files, and what `check` makes of it. */
function folder(files: Record<string, Buffer | string>, check: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'screens-comment-'));
  try {
    for (const [name, content] of Object.entries(files))
      writeFileSync(path.join(dir, name), content);
    check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('screens-comment', () => {
  it('takes out of what it shows anything that could leave a code span or write HTML', () => {
    assert.equal(clean('a`b<img src=x>c\n| d'), 'a b img src=x c   d');
    assert.equal(clean('x'.repeat(400)).length, 300);
    assert.deepEqual(clean({ '`k`': ['<v>', 1, true, null] }), { ' k ': [' v ', 1, true, null] });
    assert.equal(
      clean(() => 1),
      null,
    );
  });

  it('writes the native output, with the screens that changed and those left out', () => {
    const section = nativeSection({
      results: [
        {
          url: '/a',
          notes: [],
          changes: [
            { place: 'View[0]', kind: 'props', props: [{ key: 'height', from: 1, to: 2 }] },
          ],
        },
        { url: '/b', notes: [], changes: [] },
      ],
      skipped: { worklets: 'never yields' },
    });
    assert.match(section, /^### Native output: 1 of 2 screens changed/);
    assert.match(section, /`height` 1 → 2/);
    assert.match(section, /`\/worklets`: never yields/);
    assert.throws(() => nativeSection({ results: 'no' }), /no list of screens/);
  });

  it('shows each screenshot that differs, main beside the change, and none of a name it cannot trust', () => {
    const section = screenshotSection(
      {
        flows: 12,
        compared: true,
        differ: [
          { shot: 'visual-css.png', base: 'base-visual-css.png', diff: 'visual-css_diff.png' },
          { shot: 'x', base: '../../etc/passwd.png', diff: 'x_diff.png' },
        ],
      },
      'https://raw.example/pr-1/2',
    );
    assert.match(section, /^### iOS screenshots: 1 differ/);
    assert.match(
      section,
      /<img src="https:\/\/raw\.example\/pr-1\/2\/base-visual-css\.png" width="240">/,
    );
    assert.doesNotMatch(section, /passwd/);
    const named = screenshotSection(
      {
        flows: 12,
        compared: true,
        differ: [
          { shot: 'visual-css.png', base: 'base-visual-css.png', diff: 'visual-css_diff.png' },
        ],
      },
      '',
    );
    assert.match(
      named,
      /^### iOS screenshots: 1 differ\n\n- `visual-css\.png`$/,
      'by name, with no store',
    );
    assert.doesNotMatch(named, /<img/);
    assert.match(
      screenshotSection({ flows: 12, compared: true, differ: [] }, ''),
      /none of 12 flows differ/,
    );
    assert.match(
      screenshotSection({ flows: 12, compared: false, differ: [] }, ''),
      /Not compared: a flow failed/,
    );
    assert.match(
      screenshotSection({ skipped: "main's app is not cached" }, ''),
      /Not compared: main's app/,
    );
    const unchanged = screenshotSection(
      { flows: 0, compared: true, differ: [], unchanged: true },
      '',
    );
    assert.match(unchanged, /none compared, as no screen's native output changed/);
    assert.equal(worth(unchanged), false, 'no comment started for it');
    assert.equal(incomplete(merge('', 'screenshots', unchanged, 'abc1234'), 'abc1234'), false);
  });

  it('takes only PNGs of plain names and of a size a comment shows', () => {
    folder({ 'a.png': PNG, 'report.json': '{}', 'pr.json': '{}' }, (dir) =>
      assert.deepEqual(images(dir), ['a.png']),
    );
    folder({ 'a.png': 'not a png' }, (dir) =>
      assert.throws(() => images(dir), /not a PNG: a\.png/),
    );
    folder({ 'a b.png': PNG }, (dir) => assert.throws(() => images(dir), /not an image name/));
    folder({ 'a.svg': PNG }, (dir) => assert.throws(() => images(dir), /not an image name/));
    folder({ 'a.png': Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]) }, (dir) =>
      assert.throws(() => images(dir), /size to show/),
    );
  });

  it("puts each workflow's section in the one comment, and leaves the other's as it was", () => {
    const first = merge(
      '',
      'native-output',
      '### Native output: 1 of 2 screens changed',
      'aaa1111',
    );
    assert.ok(first.startsWith(MARK));
    const both = merge(first, 'screenshots', '### iOS screenshots: 2 differ', 'aaa1111');
    const again = merge(
      both,
      'native-output',
      '### Native output: 0 of 2 screens changed',
      'bbb2222',
    );
    assert.match(again, /<!-- native-output:start bbb2222 -->\n### Native output: 0 of 2/);
    assert.doesNotMatch(again, /1 of 2 screens changed/);
    assert.match(again, /<!-- screenshots:start aaa1111 -->\n### iOS screenshots: 2 differ/);
    assert.equal(again.split(MARK).length, 2, 'one mark');
    assert.throws(() => merge('', 'native-output', 'x', 'not a commit'), /not a commit/);
  });

  it('differs at a commit only by the sections written for it', () => {
    const body = merge(
      merge('', 'native-output', '### Native output: 0 of 2 screens changed', 'bbb2222'),
      'screenshots',
      '### iOS screenshots: 2 differ',
      'aaa1111',
    );
    assert.equal(differs(body, 'aaa1111'), true, 'the screenshots of that commit differ');
    assert.equal(differs(body, 'bbb2222'), false, 'the older screenshots say nothing of this one');
    const later = merge(
      body,
      'screenshots',
      '### iOS screenshots: none of 12 flows differ',
      'bbb2222',
    );
    assert.equal(differs(later, 'bbb2222'), false);
    assert.equal(differs('', 'bbb2222'), false, 'no comment, nothing differs');
  });

  it('starts a comment for a difference, and for nothing else', () => {
    assert.equal(worth('### Native output: 3 of 92 screens changed\n'), true);
    assert.equal(worth('### iOS screenshots: 1 differ\n'), true);
    assert.equal(worth('### Native output: 0 of 92 screens changed\n'), false);
    assert.equal(worth('### iOS screenshots: none of 12 flows differ\n'), false);
    assert.equal(worth("### iOS screenshots\n\nNot compared: main's app is not cached"), false);
  });

  it('keeps a comparison that did not finish failing, whichever run reads the comment next', () => {
    const run = 'https://github.com/o/r/actions/runs/1';
    // CI's native comparison did not finish; Native builds then finds no screenshot differing.
    const missing = merge('', 'native-output', nativeMissing(run), 'abc1234');
    const later = merge(
      missing,
      'screenshots',
      '### iOS screenshots: none of 12 flows differ',
      'abc1234',
    );
    assert.equal(incomplete(later, 'abc1234'), true);
    assert.equal(differs(later, 'abc1234'), true, 'nor read as nothing differing');
    // A run of the same commit that compares it puts the native output right.
    const done = merge(
      later,
      'native-output',
      '### Native output: 0 of 92 screens changed',
      'abc1234',
    );
    assert.equal(incomplete(done, 'abc1234'), false);
    assert.equal(differs(done, 'abc1234'), false);
    // A screenshot comparison a flow stopped is the same, and starts a comment to say so.
    const stopped = screenshotSection({ flows: 12, compared: false, differ: [] }, '');
    assert.equal(worth(stopped), true);
    assert.equal(incomplete(merge('', 'screenshots', stopped, 'abc1234'), 'abc1234'), true);
    // And one with no app of the base's to compare with: nothing was compared, which is no pass.
    const skipped = screenshotSection({ skipped: 'no app of the base is cached' }, '');
    assert.match(skipped, /Not compared: no app of the base is cached\./);
    assert.equal(incomplete(merge('', 'screenshots', skipped, 'abc1234'), 'abc1234'), true);
    // Nor can an upload write the mark: what a run uploads is cleaned of the angle brackets it needs.
    assert.doesNotMatch(String(clean('<!-- incomplete -->')), /<!--/);
  });
});
